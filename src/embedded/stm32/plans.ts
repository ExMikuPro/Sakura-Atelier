import * as path from 'node:path';
import type { Step } from '../../model';
import type { EmbeddedPlan } from '../plan';
import type { EmbeddedToolId } from '../toolchainDiscovery';
import type { Stm32Project } from './project';

/** There is deliberately no `run` operation: running a program on a board is never an implicit side effect of Build or Run. */
export const stm32Operations = ['build', 'flash', 'debug'] as const;
export type Stm32Operation = typeof stm32Operations[number];
export const cortexDebugExtension = 'marus25.cortex-debug';
export type ToolPaths = Partial<Record<EmbeddedToolId, string>>;

export interface FlashTarget {
  /** Firmware image the user picked. */
  firmware: string;
  /** Required for `.bin` images, which carry no load address. */
  address?: string;
  /** Debug probe interface. ST-LINK only. */
  probe: { interface: 'SWD' | 'JTAG'; serial?: string };
  /** MCU the user confirmed the board carries. Used for the confirmation text. */
  device: string;
}

export interface Stm32PlanInput {
  operation: Stm32Operation;
  project: Stm32Project;
  tools: ToolPaths;
  platform?: NodeJS.Platform;
  profile?: 'Debug' | 'Release';
  preset?: string;
  flash?: FlashTarget;
  /** MCU for debugging; defaults to the `.ioc` value. */
  device?: string;
  svdFile?: string;
  cortexDebugInstalled?: boolean;
  extraArgs?: string[];
  remote?: boolean;
}

/** Programmer options that erase or change protection. They are never passed through; Flash only programs and verifies. */
const forbiddenProgrammerArg = /^-{1,2}(e|erase|mcuerase|fullerase|chiperase|ob|optionbytes|rdu|rdp|rdpcheck|mcurst)$/i;
export function forbiddenFlashArgument(args: readonly string[]): string | undefined { return args.find(a => forbiddenProgrammerArg.test(a.split('=')[0]) || /^erase/i.test(a)); }

const outputName = (project: Stm32Project) => project.projectName || path.basename(project.root);
export function buildDirectory(project: Stm32Project, profile: 'Debug' | 'Release', preset?: string): string { return path.join(project.root, 'build', preset || profile); }
export function expectedElf(project: Stm32Project, profile: 'Debug' | 'Release' = 'Debug', preset?: string): string { return path.join(buildDirectory(project, profile, preset), `${outputName(project)}.elf`); }

function toolEnv(tools: ToolPaths, platform: NodeJS.Platform): Record<string, string> | undefined {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const dirs = [tools['arm-gcc'], tools.cmake, tools.ninja].filter((t): t is string => !!t).map(t => p.dirname(t));
  if (!dirs.length) { return undefined; }
  const key = platform === 'win32' ? 'Path' : 'PATH';
  // Only this step's environment is changed; the user's global environment is not touched.
  return { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string')), [key]: [...new Set(dirs), process.env[key] ?? process.env.PATH ?? ''].join(p.delimiter) };
}

export function buildStm32Plan(input: Stm32PlanInput): EmbeddedPlan {
  const { operation, project, tools } = input;
  const platform = input.platform ?? process.platform;
  const profile = input.profile ?? 'Debug';
  const blockers: string[] = [];
  const label = `STM32 ${operation === 'build' ? 'Build' : operation === 'flash' ? 'Flash' : 'Debug'} · ${outputName(project)}`;
  const base = { backend: 'stm32', operation, label, blockers };
  const env = toolEnv(tools, platform);
  const step = (command: string, args: string[], stepLabel: string): Step => ({ command, args, cwd: project.root, label: stepLabel, terminal: true, ...(env ? { env } : {}) });

  const buildSteps = (): Step[] => {
    if (project.buildSystem === 'make') {
      blockers.push('This CubeMX project uses a Makefile; build it with its Makefile or regenerate it for CMake in STM32CubeMX.');
      return [];
    }
    if (project.buildSystem !== 'cmake') { blockers.push('This is a CubeMX project without a build system. Generate code for CMake in STM32CubeMX first; Sakura Atelier does not generate code.'); return []; }
    if (!tools.cmake) { blockers.push('CMake was not found. Locate it with "Sakura Atelier: Embedded Tools...".'); }
    if (!tools['arm-gcc']) { blockers.push('arm-none-eabi-gcc was not found. Locate the Arm GNU Toolchain or STM32CubeCLT with "Sakura Atelier: Embedded Tools...".'); }
    const cmake = tools.cmake ?? 'cmake';
    const preset = input.preset && project.presets.includes(input.preset) ? input.preset : undefined;
    if (input.preset && !preset) { blockers.push(`CMake preset "${input.preset}" is not defined.`); }
    if (preset) { return [step(cmake, ['--preset', preset], 'Configure'), step(cmake, ['--build', '--preset', preset, ...(input.extraArgs ?? [])], 'Build')]; }
    const dir = buildDirectory(project, profile);
    const configure = ['-S', project.root, '-B', dir, `-DCMAKE_BUILD_TYPE=${profile}`, ...(tools.ninja ? ['-G', 'Ninja'] : []), ...(project.toolchainFile ? [`-DCMAKE_TOOLCHAIN_FILE=${project.toolchainFile}`] : [])];
    return [step(cmake, configure, 'Configure'), step(cmake, ['--build', dir, ...(input.extraArgs ?? [])], 'Build')];
  };

  if (operation === 'build') { return { ...base, risk: 'safe', steps: buildSteps() }; }

  if (operation === 'flash') {
    const flash = input.flash;
    if (!tools.stm32programmer) { blockers.push('STM32CubeProgrammer CLI was not found. Locate it with "Sakura Atelier: Embedded Tools...".'); }
    if (!flash) { blockers.push('Flash needs an explicit firmware file, a debug probe and the target device. None was chosen.'); }
    const bad = forbiddenFlashArgument(input.extraArgs ?? []);
    if (bad) { blockers.push(`"${bad}" erases or changes protection and is not allowed. Flash only programs and verifies.`); }
    if (flash) {
      if (!flash.firmware || !/\.(elf|hex|bin|srec)$/i.test(flash.firmware)) { blockers.push('Choose a firmware image (.elf, .hex or .bin).'); }
      if (/\.bin$/i.test(flash.firmware) && !/^0x[0-9a-f]+$/i.test(flash.address ?? '')) { blockers.push('A .bin image has no load address. Enter the start address explicitly (for example 0x08000000).'); }
      if (!flash.device.trim()) { blockers.push('Confirm the target MCU before flashing.'); }
      if (flash.probe.serial !== undefined && !/^[A-Za-z0-9]{4,40}$/.test(flash.probe.serial)) { blockers.push('The ST-LINK serial number is not valid.'); }
    }
    const programmer = tools.stm32programmer ?? 'STM32_Programmer_CLI';
    const connect = flash ? ['-c', `port=${flash.probe.interface}`, ...(flash.probe.serial ? [`sn=${flash.probe.serial}`] : [])] : [];
    const args = flash ? [...connect, '-w', flash.firmware, ...(/\.bin$/i.test(flash.firmware) && flash.address ? [flash.address] : []), '-v', '-rst', ...(input.extraArgs ?? [])] : [];
    return {
      ...base, risk: 'writes-device',
      confirm: flash ? `Write ${path.basename(flash.firmware)} to ${flash.device} through ST-LINK (${flash.probe.interface}${flash.probe.serial ? `, ${flash.probe.serial}` : ', the first probe found'})${input.remote ? ', attached to the remote machine' : ''}? The program is verified and the chip is reset. No full-chip erase is requested.` : undefined,
      steps: flash ? [step(programmer, args, 'Flash')] : []
    };
  }

  // debug: build first, then hand a launch configuration to Cortex-Debug. Starting the session loads the firmware onto the target.
  const steps = buildSteps();
  const device = input.device || project.ioc?.info.mcu || '';
  if (!input.cortexDebugInstalled) { blockers.push(`Debugging uses the Cortex-Debug extension (${cortexDebugExtension}). Install it; Sakura Atelier does not implement a debugger.`); }
  if (!tools['arm-gdb']) { blockers.push('arm-none-eabi-gdb was not found. Locate it with "Sakura Atelier: Embedded Tools...".'); }
  if (!tools['stlink-gdbserver']) { blockers.push('ST-LINK GDB server was not found. It ships with STM32CubeCLT; locate it with "Sakura Atelier: Embedded Tools...".'); }
  if (!device) { blockers.push('The target MCU is unknown. Enter it explicitly.'); }
  const elf = expectedElf(project, profile, input.preset);
  return {
    ...base, risk: 'writes-device', steps,
    confirm: `Starting the debug session loads ${path.basename(elf)} onto ${device || 'the target'} through ST-LINK${input.remote ? ' attached to the remote machine' : ''}. Continue?`,
    debug: {
      extension: cortexDebugExtension,
      configuration: {
        type: 'cortex-debug', request: 'launch', name: `STM32 Debug (${outputName(project)})`, servertype: 'stlink', cwd: project.root,
        executable: elf, device, runToEntryPoint: 'main',
        ...(tools['arm-gdb'] ? { gdbPath: tools['arm-gdb'], armToolchainPath: path.dirname(tools['arm-gdb']) } : {}),
        ...(tools['stlink-gdbserver'] ? { serverpath: tools['stlink-gdbserver'] } : {}),
        ...(input.svdFile ? { svdFile: input.svdFile } : {})
      }
    }
  };
}
