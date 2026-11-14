import * as vscode from 'vscode';
import { activationCommand } from './activation';
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { LocalToolchain } from './configuration';
import { contained, exists } from './detect';
import { firstTool, resolveTool } from './tools';
import { RunnerError } from './model';
const exec = promisify(execFile);
export interface OfficialEnvironment { envId: { id: string; managerId: string }; name: string; displayName: string; version: string; environmentPath: vscode.Uri; execInfo: { run: { executable: string } }; sysPrefix: string; error?: string }
export interface EnvironmentsApi {
  getEnvironments(scope: vscode.Uri | 'all' | 'global'): Promise<OfficialEnvironment[]>;
  getEnvironment(scope: vscode.Uri): Promise<OfficialEnvironment | undefined>;
  resolveEnvironment(context: vscode.Uri): Promise<OfficialEnvironment | undefined>;
  setEnvironment(scope: vscode.Uri, environment: OfficialEnvironment): Promise<void>;
  createEnvironment?(scope:vscode.Uri,options?:{quickCreate?:boolean}):Promise<OfficialEnvironment|undefined>;
  createTerminal?(environment: OfficialEnvironment, options: vscode.TerminalOptions & { disableActivation?: boolean }): Promise<vscode.Terminal>;
}
interface LegacyEnvironment { path: string; executable?: { uri?: vscode.Uri; sysPrefix?: string }; environment?: { name?: string; type?: string }; tools?: string[]; version?: { major: number; minor: number; micro: number } }
interface PythonApi { environments?: {
  getActiveEnvironmentPath(resource?: vscode.Uri): { path: string };
  updateActiveEnvironmentPath?(environment: string, resource?: vscode.Uri): Promise<void>;
  readonly known?: readonly LegacyEnvironment[];
  refreshEnvironments?(options?: { forceRefresh?: boolean }): Promise<void>;
  resolveEnvironment(environment: string | { path: string }): Promise<LegacyEnvironment | undefined>;
} }
export class PythonEnvironments implements vscode.Disposable {
  mismatch = '';
  private terminals = new Map<string, vscode.Terminal>();
  async modern(): Promise<EnvironmentsApi | undefined> {
    const extension = vscode.extensions.getExtension<EnvironmentsApi>('ms-python.vscode-python-envs');
    if (!extension || !vscode.workspace.isTrusted) { return undefined; }
    const api = await extension.activate();
    return api && typeof api.getEnvironments === 'function' && typeof api.resolveEnvironment === 'function' ? api : undefined;
  }
  private async legacy(): Promise<PythonApi | undefined> {
    const extension = vscode.extensions.getExtension<PythonApi>('ms-python.python');
    return extension && vscode.workspace.isTrusted ? extension.activate() : undefined;
  }
  async current(resource: vscode.Uri): Promise<string | undefined> {
    const api = await this.modern();
    const current = await api?.getEnvironment(resource);
    if (current?.execInfo?.run.executable) { return current.execInfo.run.executable; }
    const legacy = (await this.legacy())?.environments;
    const active = legacy?.getActiveEnvironmentPath(resource);
    return active?.path ? (await legacy?.resolveEnvironment(active))?.executable?.uri?.fsPath : undefined;
  }
  async synchronize(executable: string, resource: vscode.Uri): Promise<void> {
    this.mismatch = '';
    try {
      const modern = await this.modern();
      if (modern) {
        const selected = await modern.resolveEnvironment(vscode.Uri.file(executable));
        if (!selected) { throw new Error('the official environment manager could not resolve this interpreter'); }
        await modern.setEnvironment(resource, selected);
      } else {
        const legacy = (await this.legacy())?.environments;
        if (!legacy?.updateActiveEnvironmentPath) { this.mismatch = 'Official Python selection is unavailable; Sakura Atelier will use the explicitly configured interpreter.'; return; }
        await legacy.updateActiveEnvironmentPath(executable, resource);
      }
      const actual = await this.current(resource);
      if (!actual || path.resolve(actual) !== path.resolve(executable)) { throw new Error(`official selection is ${actual ?? 'unknown'}`); }
    } catch (error) {
      this.mismatch = `Python selection mismatch: ${String(error)}. Run/Debug will use ${executable}.`;
      void vscode.window.showWarningMessage(`Sakura Atelier: ${this.mismatch}`);
    }
  }
  async discover(folder: vscode.WorkspaceFolder): Promise<LocalToolchain[]> {
    if (!vscode.workspace.isTrusted) { throw new RunnerError('Trust the workspace before discovering interpreters.'); }
    const results: LocalToolchain[] = [];
    const add = (executable: string, name: string, version = '', manager = 'system') => {
      if (!results.some(t => t.executable === executable)) { results.push({ id: `python-${createHash('sha256').update(executable).digest('hex').slice(0,16)}`, language: 'python', executable, name, version, manager, project: folder.uri.toString() }); }
    };
    const modern = await this.modern();
    if (modern) {
      for (const env of await modern.getEnvironments(folder.uri)) { if (!env.error && env.execInfo?.run.executable) { add(env.execInfo.run.executable, env.displayName, env.version, env.envId.managerId); } }
    } else {
      const legacy = (await this.legacy())?.environments;
      await legacy?.refreshEnvironments?.({ forceRefresh: false });
      for (const env of legacy?.known ?? []) {
        const version = env.version ? `${env.version.major}.${env.version.minor}.${env.version.micro}` : '';
        if (env.executable?.uri) { add(env.executable.uri.fsPath, env.environment?.name ?? path.basename(path.dirname(env.path)), version, env.tools?.join(', ') || env.environment?.type || 'official Python'); }
      }
    }
    const candidates: string[] = process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'];
    for (const dir of ['.venv', 'venv']) {
      const config = path.join(folder.uri.fsPath, dir, 'pyvenv.cfg');
      if (await exists(config) && await contained(folder.uri.fsPath, config)) { candidates.push(path.join(folder.uri.fsPath, dir, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')); }
    }
    for (const candidate of candidates) {
      try {
        const executable = await resolveTool(candidate, folder.uri.fsPath);
        const { stdout, stderr } = await exec(executable, ['--version'], { timeout: 5000, maxBuffer: 65536 });
        const local = executable.includes(`${path.sep}.venv${path.sep}`) || executable.includes(`${path.sep}venv${path.sep}`);
        add(executable, local ? path.basename(path.dirname(path.dirname(executable))) : 'System Python', (stdout || stderr).trim(), local ? 'venv' : 'system');
      } catch { /* Other registered interpreters remain available. */ }
    }
    return results;
  }
  async interpreter(explicit: string, folder: vscode.WorkspaceFolder, project: string): Promise<string> {
    if (explicit) { const executable = await resolveTool(explicit, project); await this.synchronize(executable, folder.uri); return executable; }
    const current = await this.current(folder.uri);
    if (current) { return resolveTool(current, project); }
    for (const name of ['.venv','venv']) {
      const executable = path.join(project, name, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
      if (await exists(executable)) { return resolveTool(executable, project); }
    }
    return firstTool(process.platform === 'win32' ? ['python','python3'] : ['python3','python'], project);
  }
  async createTerminal(executable: string, folder: vscode.WorkspaceFolder, cwd: string, activate: boolean): Promise<vscode.Terminal> {
    if (!vscode.workspace.isTrusted) { throw new RunnerError('Trust the workspace before creating a Python terminal.'); }
    const key = `${folder.uri.toString()}:${executable}:${cwd}:${activate}`;
    const existing = this.terminals.get(key);
    if (existing && vscode.window.terminals.includes(existing)) { existing.show(); return existing; }
    const modern = await this.modern();
    let terminal: vscode.Terminal;
    await this.synchronize(executable, folder.uri);
    const modernSetting=vscode.workspace.getConfiguration('sakuraAtelier',folder.uri).inspect<boolean>('python.autoActivateTerminal');
    const globalActivation = modernSetting?.workspaceFolderValue??modernSetting?.workspaceValue??modernSetting?.globalValue??vscode.workspace.getConfiguration('sakuraRunner', folder.uri).get<boolean>('python.autoActivateTerminal', true);
    const options: vscode.TerminalOptions = { name: `Sakura Atelier: ${path.basename(path.dirname(executable))}`, cwd };
    if (modern?.createTerminal) {
      const environment = await modern.resolveEnvironment(vscode.Uri.file(executable));
      if (!environment) { throw new RunnerError('Python Environments could not resolve the configured interpreter.', true); }
      terminal = await modern.createTerminal(environment, { ...options, disableActivation: !activate || !globalActivation });
    } else if (vscode.extensions.getExtension('ms-python.python')) {
      // Ordinary terminal activation stays under the installed official extension's control.
      terminal = vscode.window.createTerminal(options);
      const mode = vscode.workspace.getConfiguration('python-envs', folder.uri).get<string>('terminal.autoActivationType');
      const legacy = vscode.workspace.getConfiguration('python', folder.uri).get<boolean>('terminal.activateEnvironment', true);
      if (activate && globalActivation && (mode === 'off' || (!mode && !legacy))) {
        void vscode.window.showInformationMessage('Python terminal auto-activation is off in the official extension settings. No duplicate activation command was injected. Run/Debug still use the selected interpreter.');
      }
    } else if (activate && globalActivation) {
      const prefix = path.dirname(path.dirname(executable));
      if (!await exists(path.join(prefix, 'pyvenv.cfg'))) {
        const conda=await fs.stat(path.join(prefix,'conda-meta')).then(s=>s.isDirectory()).catch(()=>false);
        if(conda){throw new RunnerError('Conda activation requires the official Python Environments extension. No partial activation was attempted.',true);}
        terminal=vscode.window.createTerminal(options);this.terminals.set(key,terminal);terminal.show();return terminal;
      }
      const platformKey = process.platform === 'darwin' ? 'osx' : process.platform === 'win32' ? 'windows' : 'linux';
      const settings = vscode.workspace.getConfiguration('terminal.integrated', folder.uri);
      const profile = settings.get<string>(`defaultProfile.${platformKey}`);
      const profiles = settings.get<Record<string, { path?: string | string[] }>>(`profiles.${platformKey}`, {});
      const configured = profile ? profiles[profile]?.path : undefined;
      const shell = (Array.isArray(configured) ? configured[0] : configured) || (process.platform === 'win32' ? process.env.COMSPEC || 'cmd.exe' : process.env.SHELL || '/bin/sh');
      const command = activationCommand(shell, prefix);
      terminal = vscode.window.createTerminal({ ...options, shellPath: shell });
      terminal.sendText(command, true);
    } else { terminal = vscode.window.createTerminal(options); }
    this.terminals.set(key, terminal); terminal.show(); return terminal;
  }
  dispose(): void { for (const terminal of this.terminals.values()) { terminal.dispose(); } this.terminals.clear(); }
}
