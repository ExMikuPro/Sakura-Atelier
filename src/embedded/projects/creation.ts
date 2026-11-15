import { initializedScaffold } from '../../languageProjects/scaffolds';
import { languageOption, javaOptionError, LanguageProjectOptions, ProjectSdk } from '../../languageProjects/options';
import type { InitializationRequest } from '../../languageProjects/initialize';
import { projectScaffold, runtimeForProject } from '../../projectScaffolds';
import type { RuntimeLanguage } from '../../configuration';
import * as path from 'node:path';
import { DeviceRef, normalizeRef } from '../devices/model';
import type { PioBoardInfo } from '../devices/pioBoards';
import type { ProjectTemplate } from './template';
import { createCubeMxScript, type CubeMxGeneration } from '../stm32/cubeMxScript';

export interface CreationRequest {
  templateId: string; device?: DeviceRef; framework?: string;
  /** Folder name of the new project. */
  name: string;
  /** Existing folder that will contain it (for `stm32.import`, the project folder itself). */
  parentDir: string;
  options?: CreationOptions;
}
/** The only tunables. Values are validated, and none of them can carry a path. */
export interface CreationOptions extends LanguageProjectOptions { monitorSpeed?: string; sampleCode?: boolean; generator?: 'cmake' | 'makefile' | 'cubeide'; cliMode?: 'quiet' | 'script' }

export interface CreationContext {
  template: ProjectTemplate | undefined;
  /** Tools as found right now; never stored with a template. */
  sdkChoices?: ProjectSdk[];
  tools: { uv?:string; npm?:string; pnpm?:string; maven?:string; gradle?:string; pio?: string; cubemx?: string; cmake?: string; armGcc?: string; ninja?: string; runtimes?: Partial<Record<RuntimeLanguage, string>> };
  /** Boards known to PlatformIO right now, by id. */
  boards: ReadonlyMap<string, PioBoardInfo>;
  fs: { exists(file: string): Promise<boolean>; isDirectory(file: string): Promise<boolean> };
  isStm32Project(folder: string): Promise<boolean>;
  remote?: boolean; platform?: NodeJS.Platform;
}

export type BlockerCode = 'template' | 'name' | 'parent' | 'exists' | 'device-required' | 'device-kind' | 'board-unknown' | 'framework' | 'option' | 'no-pio' | 'not-stm32' | 'no-cubemx' | 'remote-cubemx' | 'cubemx-path' | 'initialization';
export interface Blocker { code: BlockerCode; message: string }
export type CreationStep =
  | { kind: 'initialize'; request: InitializationRequest }
  | { kind: 'mkdir'; path: string }
  | { kind: 'run'; command: string; args: string[]; cwd: string; label: string }
  | { kind: 'generate-cubemx'; job: CubeMxGeneration }
  | { kind: 'write'; path: string; content: string }
  | { kind: 'arduino-entry'; path: string }
  | { kind: 'open'; path: string };

export interface PlanWarning { code: 'remote-cubemx' | 'no-cubemx' | 'no-runtime' | 'project-dependencies'; message: string }
export interface CreationPlan { target: string; steps: CreationStep[]; blockers: Blocker[]; warnings: PlanWarning[]; preview: string[] }

const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
/** One path segment: no separators, no leading dot or dash, no trailing dot, no Windows device names. */
export function validateProjectName(name: string): string | undefined {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name) || name.endsWith('.') || reserved.test(name)) { return 'Use 1 to 64 letters, digits, dots, hyphens or underscores, starting with a letter or digit.'; }
  return undefined;
}

export function sanitizeOptions(raw: unknown): { options: CreationOptions; invalid: string[] } {
  const options: CreationOptions = {}; const invalid: string[] = [];
  for (const [key, value] of Object.entries(raw && typeof raw === 'object' ? raw as Record<string, unknown> : {})) {
    if (languageOption(key,value)) { Object.assign(options,{[key]:value}); }
    else if (key === 'monitorSpeed' && typeof value === 'string' && /^\d{3,7}$/.test(value)) { options.monitorSpeed = value; }
    else if (key === 'sampleCode' && typeof value === 'boolean') { options.sampleCode = value; }
    else if (key === 'generator' && (value === 'cmake' || value === 'makefile' || value === 'cubeide')) { options.generator = value; }
    else if (key === 'cliMode' && (value === 'quiet' || value === 'script')) { options.cliMode = value; }
    else { invalid.push(key); }
  }
  return { options, invalid };
}

/** Builds the steps without touching the disk or running anything. An existing target is always a blocker: nothing is merged or overwritten. */
export async function planCreation(request: CreationRequest, context: CreationContext): Promise<CreationPlan> {
  const { template } = context;
  const blockers: Blocker[] = []; const warnings: PlanWarning[] = []; const steps: CreationStep[] = []; const preview: string[] = [];
  const block = (code: BlockerCode, message: string) => { blockers.push({ code, message }); };
  const target = path.join(request.parentDir, request.name);
  if (!template) { block('template', 'The project template is not available.'); return { target, steps, blockers, warnings, preview }; }
  const { options, invalid } = sanitizeOptions(request.options);
  for (const key of invalid) { block('option', `Option "${key}" is not supported.`); }

  if (template.buildSystem === 'existing') {
    if (!await context.fs.isDirectory(request.parentDir)) { block('parent', 'Choose an existing project folder.'); }
    else if (!await context.isStm32Project(request.parentDir)) { block('not-stm32', 'This folder has no .ioc file and no STM32 CMake project.'); }
    else { steps.push({ kind: 'open', path: request.parentDir }); preview.push(`Open ${request.parentDir}`); }
    return { target: request.parentDir, steps, blockers, warnings, preview };
  }

  const nameProblem = validateProjectName(request.name);
  if (nameProblem) { block('name', nameProblem); }
  if (!path.isAbsolute(request.parentDir) || !await context.fs.isDirectory(request.parentDir)) { block('parent', 'The save location must be an existing folder.'); }
  else if (!nameProblem && await context.fs.exists(target)) { block('exists', `"${request.name}" already exists in this folder. Choose another name; existing files are never overwritten.`); }

  if (template.backend === 'general') {
    const language=template.language;
    const initializes=language==='python'||language==='typescript'||language==='java';
    const runtime=language ? runtimeForProject(language) : undefined;
    const selected=options.sdkId ? context.sdkChoices?.find(t=>t.id===options.sdkId && t.language===runtime)?.executable : runtime ? context.tools.runtimes?.[runtime] : undefined;
    if(initializes && !selected)block('initialization','请选择可用 SDK 后创建项目；初始化不会静默跳过。');
    if(language==='java'){const problem=javaOptionError(options);if(problem)block('initialization',problem);}
    if(language==='python' && options.pythonManager==='uv' && !context.tools.uv)block('initialization','未找到 uv，请选择 pip 或先安装 uv。');
    if(language==='typescript' && options.nodeManager==='pnpm' && !context.tools.pnpm)block('initialization','未找到 pnpm，请选择 npm 或先安装 pnpm。');
    const files = language && language!=='java' ? (initializes ? initializedScaffold(language,request.name || 'my-project',options) : projectScaffold(language, request.name || 'my-project')) : [];
    if (template.language && !initializes && !context.tools.runtimes?.[runtimeForProject(template.language)]) warnings.push({ code: 'no-runtime', message: 'The project can be created; configure its SDK before Run or Debug.' });
    if (!blockers.length) {
      steps.push({ kind: 'mkdir', path: target });
      const directories = new Set<string>();
      for (const file of files) {
        let dir = path.dirname(file.path);
        while (dir !== '.') { directories.add(dir); dir = path.dirname(dir); }
      }
      for (const dir of [...directories].sort((a, b) => a.split(path.sep).length - b.split(path.sep).length)) steps.push({ kind: 'mkdir', path: path.join(target, dir) });
      for (const file of files) steps.push({ kind: 'write', path: path.join(target, file.path), content: file.content });
      if(initializes && selected)steps.push({kind:'initialize',request:{language:language as 'python'|'typescript'|'java',root:target,name:request.name,sdk:selected,options,tools:{uv:context.tools.uv,maven:context.tools.maven,gradle:context.tools.gradle}}});
      steps.push({ kind: 'open', path: target });
    }
    preview.push(template.label, target, ...files.map(file => file.path), ...(initializes?['初始化依赖并验证环境，完成后才提示可用']:[]));
    return { target, steps, blockers, warnings, preview };
  }

  const device = normalizeRef(request.device);
  if (!device) { block('device-required', 'Choose a device first.'); }
  else if (!template.deviceKinds.includes(device.kind)) { block('device-kind', `This template needs ${template.deviceKinds.join(' or ')}, not ${device.kind}. An STM32 MCU or ST board name is never used as a PlatformIO board id.`); }

  if (template.backend === 'platformio') {
    const board = device?.kind === 'pio-board' ? context.boards.get(device.id) : undefined;
    if (device?.kind === 'pio-board' && !board) { block('board-unknown', `PlatformIO does not list the board "${device.id}". Reload the boards or choose another.`); }
    if (template.needsFramework && board) {
      if (!request.framework) { block('framework', 'Choose a framework.'); }
      else if (!board.frameworks?.includes(request.framework)) { block('framework', `"${board.name}" does not support the framework "${request.framework}".`); }
    }
    if (!context.tools.pio) { block('no-pio', 'PlatformIO Core was not found. Locate it with "Sakura Atelier: Embedded Tools...".'); }
    if (!blockers.length && device && context.tools.pio) {
      steps.push({ kind: 'mkdir', path: target });
      const args = ['project', 'init', '-d', target, '--board', device.id, '--project-option', `framework=${request.framework}`, ...(options.monitorSpeed ? ['--project-option', `monitor_speed=${options.monitorSpeed}`] : []), ...(options.sampleCode && request.framework !== 'arduino' ? ['--sample-code'] : []), '--no-install-dependencies'];
      steps.push({ kind: 'run', command: context.tools.pio, args, cwd: request.parentDir, label: 'pio project init' });
      if (request.framework === 'arduino') { steps.push({kind:'arduino-entry',path:path.join(target,'src')}); preview.push('src/main.cpp — Arduino.h / setup() / loop()'); }
      steps.push({ kind: 'open', path: target });
    }
    preview.push(`PlatformIO · ${board?.name ?? device?.id ?? ''} (${device?.id ?? ''})`, `framework = ${request.framework ?? ''}`, `${target}`);
    return { target, steps, blockers, warnings, preview };
  }

  // Classic STM32CubeMX owns .ioc serialization and all generated source/build files.
  if (context.remote) block('remote-cubemx', 'Open the project locally to generate with classic STM32CubeMX.');
  if (!context.tools.cubemx) block('no-cubemx', 'Locate classic STM32CubeMX 6.x before creating the project.');
  let job: CubeMxGeneration | undefined;
  if (device && device.kind !== 'pio-board' && context.tools.cubemx && !nameProblem && request.parentDir) {
    try {
      const toolchain = options.generator === 'makefile' ? 'Makefile' : options.generator === 'cubeide' ? 'STM32CubeIDE' : 'CMake';
      job = { executable: context.tools.cubemx, root: target, ...createCubeMxScript(device, request.name, target, toolchain), toolchain, mode: options.cliMode === 'script' ? '-s' : '-q', device };
    } catch (error) { block('cubemx-path', error instanceof Error ? error.message : String(error)); }
  }
  if (!blockers.length) {
    steps.push({ kind: 'mkdir', path: target });
    if (job) steps.push({ kind: 'generate-cubemx', job });
    steps.push({ kind: 'open', path: target });
  }
  preview.push(`STM32CubeMX 6.x · ${device?.id ?? ''}`, `${options.generator ?? 'cmake'} · ${job?.mode ?? '-q'}`, target, ...(job ? [job.ioc, job.script] : []));
  return { target, steps, blockers, warnings, preview };
}

export interface CreationDeps {
  /** Must fail when the folder exists (not recursive), so a folder created after planning is never reused. */
  mkdir(folder: string): Promise<void>;
  run(command: string, args: string[], cwd: string): Promise<void>;
  /** Must use exclusive creation; never overwrite an existing file. */
  writeFile?(file: string, content: string): Promise<void>;
  initializeProject?(request:InitializationRequest):Promise<void>;
  cancelled?():boolean;
  ensureArduinoEntry?(directory: string): Promise<unknown>;
  generateCubeMx?(job: CubeMxGeneration): Promise<void>;
}
export interface CreationResult { target: string; open?: string; launched: boolean }

/** Executes a plan with no blockers. Stops at the first failure and leaves whatever exists in place; nothing is deleted. */
export async function executeCreation(plan: CreationPlan, deps: CreationDeps): Promise<CreationResult> {
  if (plan.blockers.length) { throw new Error(plan.blockers.map(b => b.message).join(' ')); }
  let launched = false; let open: string | undefined;
  for (const step of plan.steps) {
    if(deps.cancelled?.())throw new Error('创建已取消，工程文件已保留。');
    if (step.kind === 'initialize') {if(!deps.initializeProject)throw new Error('项目初始化器不可用。');await deps.initializeProject(step.request);}
    else if (step.kind === 'mkdir') { await deps.mkdir(step.path); }
    else if (step.kind === 'write') { if (!deps.writeFile) throw new Error('Project file writer is unavailable.'); await deps.writeFile(step.path, step.content); }
    else if (step.kind === 'arduino-entry') { if (!deps.ensureArduinoEntry) throw new Error('Arduino source writer is unavailable.'); await deps.ensureArduinoEntry(step.path); }
    else if (step.kind === 'run') { await deps.run(step.command, step.args, step.cwd); }
    else if (step.kind === 'generate-cubemx') { if (!deps.generateCubeMx) throw new Error('CubeMX generator is unavailable.'); await deps.generateCubeMx(step.job); launched = true; }
    else { open = step.path; }
  }
  return { target: plan.target, open, launched };
}
