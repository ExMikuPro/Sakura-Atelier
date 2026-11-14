import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { adapterRegistry } from '../adapters';
import type { BackendHost, BackendProject } from '../adapterTypes';
import { RunnerError } from '../model';
import type { TaskExecutor } from '../executor';
import { createToolRegistry, manageEmbeddedTools } from './toolsCommand';
import { nodeRunner } from './process';
import type { EmbeddedPlan } from './plan';
import { stm32Backend, readStm32Project } from './stm32/project';
import { buildStm32Plan, expectedElf, FlashTarget, Stm32Operation, ToolPaths } from './stm32/plans';
import { embeddedToolIds } from './toolchainDiscovery';
import { describeEnvironments, platformioBackend, readPlatformioProject, PlatformioProject } from './platformio/project';
import { buildPlatformioPlan, chooseEnvironment, platformioIdeExtension, PlatformioOperation } from './platformio/plans';
import { listPorts, readConfig, readMetadata, EnvironmentMetadata } from './platformio/cli';
import { defaultEnvironments } from './platformio/ini';

export const embeddedCommandNames = [
  'manageTools', 'platformio.selectEnvironment', 'platformio.build', 'platformio.clean', 'platformio.upload',
  'platformio.debug', 'platformio.monitor', 'platformio.test', 'platformio.testOnDevice',
  'stm32.build', 'stm32.flash', 'stm32.debug', 'reloadDevices', 'newProject'
] as const;
export type EmbeddedCommandName = typeof embeddedCommandNames[number];

const host: BackendHost = {
  async readDir(directory) { try { return await fs.readdir(directory); } catch { return []; } },
  async readText(file) { try { return await fs.readFile(file, 'utf8'); } catch { return undefined; } }
};

function ensureBackends(): void { for (const backend of [platformioBackend, stm32Backend]) { if (!adapterRegistry.backends.has(backend.id)) { adapterRegistry.backends.register(backend.id, backend); } } }

/** Project roots worth checking: the active file's ancestors inside the workspace, each workspace folder, and its direct children. */
async function candidateRoots(): Promise<{ folder: vscode.WorkspaceFolder; root: string }[]> {
  const result: { folder: vscode.WorkspaceFolder; root: string }[] = [];
  const add = (folder: vscode.WorkspaceFolder, root: string) => { if (!result.some(r => r.root === root)) { result.push({ folder, root }); } };
  const active = vscode.window.activeTextEditor?.document.uri;
  const activeFolder = active?.scheme === 'file' ? vscode.workspace.getWorkspaceFolder(active) : undefined;
  if (active && activeFolder) {
    for (let dir = path.dirname(active.fsPath); dir.startsWith(activeFolder.uri.fsPath); dir = path.dirname(dir)) { add(activeFolder, dir); if (dir === activeFolder.uri.fsPath) { break; } }
  }
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    if (folder.uri.scheme !== 'file') { continue; }
    add(folder, folder.uri.fsPath);
    for (const entry of await fs.readdir(folder.uri.fsPath, { withFileTypes: true }).catch(() => [])) { if (entry.isDirectory() && !entry.isSymbolicLink() && !/^(\.|node_modules$)/.test(entry.name)) { add(folder, path.join(folder.uri.fsPath, entry.name)); } }
  }
  return result;
}

async function pickProject(backend: 'platformio' | 'stm32'): Promise<{ folder: vscode.WorkspaceFolder; project: BackendProject }> {
  ensureBackends();
  const found: { folder: vscode.WorkspaceFolder; project: BackendProject }[] = [];
  for (const { folder, root } of await candidateRoots()) {
    for (const project of await adapterRegistry.detectBackendProjects(root, host)) { if (project.backend === backend) { found.push({ folder, project }); } }
  }
  if (!found.length) { throw new RunnerError(backend === 'platformio' ? 'No platformio.ini found in this workspace.' : 'No STM32 CMake or STM32CubeMX (.ioc) project found in this workspace.'); }
  if (found.length === 1) { return found[0]; }
  const picked = await vscode.window.showQuickPick(found.map(f => ({ label: path.basename(f.project.root), description: f.project.root, f })), { title: 'Select PlatformIO project' });
  if (!picked) { throw new RunnerError('Run stopped.'); }
  return picked.f;
}

/** Prefers the official CLI's resolved configuration (extends, interpolation); falls back to reading the file. */
async function loadProject(root: string, pio: string | undefined): Promise<PlatformioProject> {
  const fromFile = await readPlatformioProject(root, host);
  if (!fromFile) { throw new RunnerError('platformio.ini could not be read.'); }
  if (!pio) { return fromFile; }
  try {
    const ini = await readConfig(nodeRunner, pio, root);
    return { ...fromFile, environments: describeEnvironments(ini), defaultEnvironments: defaultEnvironments(ini) };
  } catch (error) { console.error('Sakura Atelier: pio project config failed; using platformio.ini directly.', error); return fromFile; }
}

async function selectEnvironment(context: vscode.ExtensionContext, project: PlatformioProject, force: boolean): Promise<string> {
  const key = `sakuraAtelier.pio.env:${project.root}`;
  const remembered = context.workspaceState.get<string>(key);
  const choice = force ? { kind: 'choose' as const, choices: project.environments.map(e => e.name) } : chooseEnvironment(project, remembered);
  if (choice.kind === 'none') { throw new RunnerError('platformio.ini defines no [env:NAME] environment.'); }
  if (choice.kind === 'selected') { return choice.env; }
  const picked = await vscode.window.showQuickPick(choice.choices.map(name => { const e = project.environments.find(x => x.name === name); return { label: name, description: [e?.board, e?.platform].filter(Boolean).join(' · '), picked: name === remembered }; }), { title: 'Select PlatformIO environment' });
  if (!picked) { throw new RunnerError('Run stopped.'); }
  await context.workspaceState.update(key, picked.label);
  return picked.label;
}

async function pickPort(pio: string | undefined, root: string): Promise<string | undefined> {
  if (!pio) { return undefined; }
  const ports = await listPorts(nodeRunner, pio, root).catch(() => []);
  if (ports.length < 2) { return undefined; }
  const picked = await vscode.window.showQuickPick([{ label: 'Use platformio.ini settings', port: undefined as string | undefined }, ...ports.map(p => ({ label: p.port, description: p.description, port: p.port as string | undefined }))], { title: 'Serial / upload port' });
  if (!picked) { throw new RunnerError('Run stopped.'); }
  return picked.port;
}

async function execute(plan: EmbeddedPlan, folder: vscode.WorkspaceFolder, executor: TaskExecutor): Promise<void> {
  if (plan.blockers.length) { throw new RunnerError(plan.blockers.join(' '), true); }
  if (plan.risk === 'writes-device' && await vscode.window.showWarningMessage(plan.confirm ?? 'This writes to a device. Continue?', { modal: true }, 'Continue') !== 'Continue') { return; }
  if (plan.debug && !vscode.extensions.getExtension(plan.debug.extension)) { throw new RunnerError(`Install ${plan.debug.extension} to debug.`); }
  if (plan.steps.length) {
    const ran = await executor.exclusive(() => executor.run({ name: plan.label, steps: plan.steps }, folder));
    if (!ran) { throw new RunnerError('Another Sakura Atelier run is in progress.'); }
  }
  if (plan.debug && !await vscode.debug.startDebugging(folder, plan.debug.configuration as vscode.DebugConfiguration)) { throw new RunnerError('The debug session did not start. See the Debug Console.'); }
}

async function platformio(name: string, context: vscode.ExtensionContext, executor: TaskExecutor): Promise<void> {
  const { folder, project: backendProject } = await pickProject('platformio');
  const tools = createToolRegistry(context);
  const pio = await tools.resolve('platformio');
  const project = await loadProject(backendProject.root, pio);
  const env = await selectEnvironment(context, project, name === 'platformio.selectEnvironment');
  if (name === 'platformio.selectEnvironment') { void vscode.window.showInformationMessage(`PlatformIO environment: ${env}`); return; }
  const operation = name.slice('platformio.'.length) as PlatformioOperation;
  let metadata: EnvironmentMetadata | undefined;
  if (operation === 'debug' && pio) {
    const load = await vscode.window.showWarningMessage(`Debugging needs the build details of "${env}". PlatformIO may download this environment's platform and tools if they are missing.`, { modal: true }, 'Load details');
    if (load !== 'Load details') { return; }
    metadata = await readMetadata(nodeRunner, pio, project.root, env);
  }
  const port = operation === 'monitor' || operation === 'upload' || operation === 'testOnDevice' ? await pickPort(pio, project.root) : undefined;
  const plan = buildPlatformioPlan({ operation, pio, project, env, port, metadata, ideExtensionInstalled: !!vscode.extensions.getExtension(platformioIdeExtension), remote: !!vscode.env.remoteName });
  await execute(plan, folder, executor);
}

async function toolPaths(context: vscode.ExtensionContext): Promise<ToolPaths> {
  const statuses = await createToolRegistry(context).discover();
  return Object.fromEntries(embeddedToolIds.map(id => [id, statuses[id].selected?.path]).filter(e => e[1])) as ToolPaths;
}

async function pickFlashTarget(project: NonNullable<Awaited<ReturnType<typeof readStm32Project>>>): Promise<FlashTarget | undefined> {
  const picked = await vscode.window.showOpenDialog({ canSelectMany: false, defaultUri: vscode.Uri.file(path.dirname(expectedElf(project))), filters: { Firmware: ['elf', 'hex', 'bin', 'srec'] }, title: 'Select the firmware to flash', openLabel: 'Select firmware' });
  if (!picked?.[0]) { return undefined; }
  const firmware = picked[0].fsPath;
  let address: string | undefined;
  if (/\.bin$/i.test(firmware)) { address = await vscode.window.showInputBox({ title: 'Load address of the .bin image', prompt: 'A .bin file has no address. Enter it explicitly, for example 0x08000000.', validateInput: v => /^0x[0-9a-fA-F]+$/.test(v) ? undefined : 'Use a hexadecimal address such as 0x08000000.' }); if (!address) { return undefined; } }
  const probe = await vscode.window.showQuickPick([{ label: 'ST-LINK over SWD (first probe found)', serial: undefined as string | undefined, ask: false }, { label: 'ST-LINK over SWD (choose by serial number)', serial: undefined as string | undefined, ask: true }], { title: 'Select the debug probe' });
  if (!probe) { return undefined; }
  let serial = probe.serial;
  if (probe.ask) { serial = await vscode.window.showInputBox({ title: 'ST-LINK serial number', prompt: 'Printed by STM32CubeProgrammer or shown in the ST-LINK firmware tool.' }); if (!serial) { return undefined; } }
  const device = await vscode.window.showInputBox({ title: 'Target MCU', prompt: 'Confirm the MCU on the board you are flashing.', value: project.ioc?.info.mcu ?? '', ignoreFocusOut: true });
  if (!device) { return undefined; }
  return { firmware, address, probe: { interface: 'SWD', ...(serial ? { serial } : {}) }, device };
}

async function stm32(name: string, context: vscode.ExtensionContext, executor: TaskExecutor): Promise<void> {
  const { folder, project: found } = await pickProject('stm32');
  const project = await readStm32Project(found.root, host);
  if (!project) { throw new RunnerError('The STM32 project could not be read.'); }
  const operation = name.slice('stm32.'.length) as Stm32Operation;
  const tools = await toolPaths(context);
  let preset: string | undefined; let flash: FlashTarget | undefined; let device: string | undefined;
  if (operation !== 'flash' && project.presets.length) { preset = (await vscode.window.showQuickPick(project.presets, { title: 'CMake preset' })); if (!preset) { return; } }
  if (operation === 'flash') { flash = await pickFlashTarget(project); if (!flash) { return; } }
  if (operation === 'debug' && !project.ioc?.info.mcu) { device = await vscode.window.showInputBox({ title: 'Target MCU', prompt: 'The MCU is not stated in a .ioc file. Enter it explicitly.' }); if (!device) { return; } }
  const plan = buildStm32Plan({ operation, project, tools, preset, flash, device, cortexDebugInstalled: !!vscode.extensions.getExtension('marus25.cortex-debug'), remote: !!vscode.env.remoteName });
  await execute(plan, folder, executor);
}

export async function runEmbeddedCommand(name: EmbeddedCommandName, context: vscode.ExtensionContext, executor: TaskExecutor): Promise<void> {
  if (!vscode.workspace.isTrusted) { await vscode.window.showWarningMessage('Sakura Atelier: Trust this workspace before using embedded tools; they run local programs.'); return; }
  if (name === 'manageTools') { await manageEmbeddedTools(createToolRegistry(context)); return; }
  if (name === 'newProject') { await (await import('./projects/wizardPanel')).openNewProject(context); return; }
  if (name === 'reloadDevices') { await (await import('./devices/service')).reloadDevices(context); return; }
  if (name.startsWith('stm32.')) { await stm32(name, context, executor); return; }
  await platformio(name, context, executor);
}
