import * as path from 'node:path';
import { newConfiguration } from '../../configuration';
import { openocdArguments, recommendedTarget, tclString } from './configurations';
import type { Step } from '../../model';
import type { EmbeddedPlan } from '../plan';
import type { EmbeddedToolId } from '../toolchainDiscovery';
import type { Stm32Project } from './project';

/** Low-level plans; managed Run composes an incremental Build and OpenOCD Flash in workflow.ts. */
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
  interfaceConfig?: string;
  targetConfig?: string;
  runToMain?: boolean;
  loadBeforeDebug?: boolean;
  cortexDebugInstalled?: boolean;
  extraArgs?: string[];
  remote?: boolean;
}

/** Programmer options that erase or change protection. They are never passed through; Flash only programs and verifies. */
const forbiddenProgrammerArg = /^-{1,2}(e|erase|mcuerase|fullerase|chiperase|ob|optionbytes|rdu|rdp|rdpcheck|mcurst)$/i;
export function forbiddenFlashArgument(args: readonly string[]): string | undefined { return args.find(a => forbiddenProgrammerArg.test(a.split('=')[0]) || /^erase/i.test(a)); }

const outputName = (project: Stm32Project) => project.projectName || path.basename(project.root);
export function buildDirectory(project: Stm32Project, profile: 'Debug' | 'Release', preset?: string): string { return (preset && project.presetDirectories?.[preset]) || (!preset && project.existingBuildDirectories?.[profile]) || path.join(project.root, 'build', preset || profile); }
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
  const step = (command: string, args: string[], stepLabel: string): Step => ({ command, args, cwd: project.root, label: stepLabel, terminal: true, problemMatchers: ['$gcc'], ...(env ? { env } : {}) });

  const buildSteps = (): Step[] => {
    if (project.buildSystem === 'make') {
      return [step('make', [...(input.extraArgs ?? [])], 'STM32 — 编译')];
    }
    if (project.buildSystem !== 'cmake') { blockers.push('请先使用经典 STM32CubeMX 为 .ioc 生成 CMake 工程。'); return []; }
    if (!tools.cmake) { blockers.push('未找到 CMake，请在嵌入式工具管理中配置。'); }
    if (!tools['arm-gcc']) { blockers.push('未找到 arm-none-eabi-gcc，请配置 ARM GCC 或 STM32CubeCLT。'); }
    const cmake = tools.cmake ?? 'cmake';
    const preset = input.preset && project.presets.includes(input.preset) ? input.preset : undefined;
    if (input.preset && !preset) { blockers.push(`CMake preset "${input.preset}" is not defined.`); }
    if (preset) {
      // A configure preset need not have a corresponding build preset.
      const dir = buildDirectory(project, profile, preset);
      return [step(cmake, ['--preset', preset, '-DCMAKE_EXPORT_COMPILE_COMMANDS=ON'], 'Configure'), step(cmake, ['--build', dir, ...(input.extraArgs ?? [])], 'Build')];
    }
    const dir = buildDirectory(project, profile);
    const configure = ['-S', project.root, '-B', dir, '-DCMAKE_EXPORT_COMPILE_COMMANDS=ON', `-DCMAKE_BUILD_TYPE=${profile}`, ...(tools.ninja && !project.existingBuildDirectories?.[profile] ? ['-G', 'Ninja'] : []), ...(project.toolchainFile ? [`-DCMAKE_TOOLCHAIN_FILE=${project.toolchainFile}`] : [])];
    return [step(cmake, configure, 'Configure'), step(cmake, ['--build', dir, ...(input.extraArgs ?? [])], 'Build')];
  };

  if (operation === 'build') { return { ...base, risk: 'safe', steps: buildSteps() }; }

  if (operation === 'flash') {
    const flash = input.flash;
    if (!tools.openocd) { blockers.push('未找到 OpenOCD，请配置本机路径或确认后通过 Homebrew 安装：brew install open-ocd'); }
    if (!flash) { blockers.push('烧录需要明确选择 firmware、probe 和 device。'); }
    const bad = forbiddenFlashArgument(input.extraArgs ?? []);
    if (bad) { blockers.push(`"${bad}" erases or changes protection and is not allowed. Flash only programs and verifies.`); }
    if (flash) {
      if (!flash.firmware || !/\.(elf|hex|bin|srec)$/i.test(flash.firmware)) { blockers.push('Choose a firmware image (.elf, .hex or .bin).'); }
      if (/\.bin$/i.test(flash.firmware) && !/^0x[0-9a-f]+$/i.test(flash.address ?? '')) { blockers.push('A .bin image has no load address. Enter the start address explicitly (for example 0x08000000).'); }
      if (!flash.device.trim()) { blockers.push('Confirm the target MCU before flashing.'); }
      if (flash.probe.serial !== undefined && !/^[A-Za-z0-9]{4,40}$/.test(flash.probe.serial)) { blockers.push('The ST-LINK serial number is not valid.'); }
    }
    const c = { ...newConfiguration('c'), stm32Probe:'stlink', stm32Interface:input.interfaceConfig || 'interface/stlink.cfg', stm32Target:input.targetConfig || recommendedTarget(flash?.device || ''), stm32Transport:flash?.probe.interface.toLowerCase() || 'swd' };
    let connection: string[] = [];
    try { connection = openocdArguments(c); } catch (error) { blockers.push(String(error)); }
    const args = flash ? [...connection, ...(flash.probe.serial ? ['-c',`adapter serial ${tclString(flash.probe.serial)}`] : []), '-c', `program ${tclString(flash.firmware)} verify reset exit${flash.address && /\.bin$/i.test(flash.firmware) ? ' ' + flash.address : ''}`] : [];
    return {
      ...base, risk: 'writes-device',
      confirm: flash ? `Write ${path.basename(flash.firmware)} to ${flash.device} through ST-LINK (${flash.probe.interface}${flash.probe.serial ? `, ${flash.probe.serial}` : ', the first probe found'})${input.remote ? ', attached to the remote machine' : ''}? The program is verified and the chip is reset. No full-chip erase is requested.` : undefined,
      steps: flash ? [step(tools.openocd ?? 'openocd', args, '烧录、校验并复位')] : []
    };
  }

  // debug: build first, then hand a launch configuration to Cortex-Debug. Starting the session loads the firmware onto the target.
  const steps = buildSteps();
  const device = input.device || project.ioc?.info.mcu || '';
  if (!input.cortexDebugInstalled) { blockers.push(`缺少 Cortex-Debug 调试器，请安装 ${cortexDebugExtension}。`); }
  if (!tools['arm-gdb']) { blockers.push('未找到 ARM GDB（arm-none-eabi-gdb），请在本机工具链中配置。'); }
  if (!tools.openocd) { blockers.push('未找到 OpenOCD，请在本机工具链中配置。'); }
  const target = input.targetConfig || recommendedTarget(device);
  if (!target) { blockers.push('无法确定芯片 Target 配置，请手动选择。'); }
  if (!device) { blockers.push('The target MCU is unknown. Enter it explicitly.'); }
  const elf = expectedElf(project, profile, input.preset);
  return {
    ...base, risk: 'writes-device', steps,
    confirm: `Starting the debug session loads ${path.basename(elf)} onto ${device || 'the target'} through ST-LINK${input.remote ? ' attached to the remote machine' : ''}. Continue?`,
    debug: {
      extension: cortexDebugExtension,
      configuration: {
        type: 'cortex-debug', request: 'launch', name: `STM32 Debug (${outputName(project)})`, servertype: 'openocd', cwd: project.root,
        executable: elf, device, ...(input.runToMain === false ? {breakAfterReset:true} : {runToEntryPoint:'main'}), configFiles:[input.interfaceConfig || 'interface/stlink.cfg', target], ...(input.loadBeforeDebug === false ? {loadFiles:[]} : {}),
        ...(tools['arm-gdb'] ? { gdbPath: tools['arm-gdb'], armToolchainPath: path.dirname(tools['arm-gdb']) } : {}),
        ...(tools.openocd ? { serverpath: tools.openocd } : {}),
        ...(input.svdFile ? { svdFile: input.svdFile } : {})
      }
    }
  };
}
