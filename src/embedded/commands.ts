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
import { describeEnvironments, platformioBackend, readPlatformioProject, PlatformioProject } from './platformio/project';
import { buildPlatformioPlan, chooseEnvironment, platformioIdeExtension, PlatformioOperation } from './platformio/plans';
import { listPorts, readConfig, readMetadata, EnvironmentMetadata } from './platformio/cli';
import { defaultEnvironments } from './platformio/ini';

export const embeddedCommandNames = [
  'manageTools', 'platformio.selectEnvironment', 'platformio.build', 'platformio.clean', 'platformio.upload',
  'platformio.debug', 'platformio.monitor', 'platformio.test', 'platformio.testOnDevice'
] as const;
export type EmbeddedCommandName = typeof embeddedCommandNames[number];

const host: BackendHost = {
  async readDir(directory) { try { return await fs.readdir(directory); } catch { return []; } },
  async readText(file) { try { return await fs.readFile(file, 'utf8'); } catch { return undefined; } }
};

function ensureBackends(): void { if (!adapterRegistry.backends.has(platformioBackend.id)) { adapterRegistry.backends.register(platformioBackend.id, platformioBackend); } }

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

async function pickProject(): Promise<{ folder: vscode.WorkspaceFolder; project: BackendProject }> {
  ensureBackends();
  const found: { folder: vscode.WorkspaceFolder; project: BackendProject }[] = [];
  for (const { folder, root } of await candidateRoots()) {
    for (const project of await adapterRegistry.detectBackendProjects(root, host)) { if (project.backend === 'platformio') { found.push({ folder, project }); } }
  }
  if (!found.length) { throw new RunnerError('No platformio.ini found in this workspace.'); }
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
  if (plan.debug) {
    if (!vscode.extensions.getExtension(plan.debug.extension)) { throw new RunnerError(`Install ${plan.debug.extension} to debug.`); }
    if (!await vscode.debug.startDebugging(folder, plan.debug.configuration as vscode.DebugConfiguration)) { throw new RunnerError('The debug session did not start. See the Debug Console.'); }
    return;
  }
  const ran = await executor.exclusive(() => executor.run({ name: plan.label, steps: plan.steps }, folder));
  if (!ran) { throw new RunnerError('Another Sakura Atelier run is in progress.'); }
}

async function platformio(name: string, context: vscode.ExtensionContext, executor: TaskExecutor): Promise<void> {
  const { folder, project: backendProject } = await pickProject();
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

export async function runEmbeddedCommand(name: EmbeddedCommandName, context: vscode.ExtensionContext, executor: TaskExecutor): Promise<void> {
  if (!vscode.workspace.isTrusted) { await vscode.window.showWarningMessage('Sakura Atelier: Trust this workspace before using embedded tools; they run local programs.'); return; }
  if (name === 'manageTools') { await manageEmbeddedTools(createToolRegistry(context)); return; }
  await platformio(name, context, executor);
}
