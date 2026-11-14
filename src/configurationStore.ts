import { hostToolchains } from './environment/registryAccess';
import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ConfigurationFile, LocalToolchain, Selection, runtimeLanguages, portablePath, selectionKey, validateFile } from './configuration';
import { contained, exists } from './detect';
import { RunnerError } from './model';
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
export class ConfigurationStore {
  constructor(readonly context: vscode.ExtensionContext) {}
  private async location(folder: vscode.WorkspaceFolder): Promise<string> {
    const directory = path.join(folder.uri.fsPath, '.vscode');
    try { await fs.stat(directory); if (!await contained(folder.uri.fsPath, directory)) { throw new RunnerError('.vscode points outside the workspace.', true); } }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; } }
    return path.join(directory, 'sakura-atelier.json');
  }
  async read(folder: vscode.WorkspaceFolder): Promise<{ document: ConfigurationFile; revision: string }> {
    let file = await this.location(folder);
    if (!await exists(file)) { const legacy = path.join(path.dirname(file), 'sakura-runner.json'); if (await exists(legacy)) { file = legacy; } }
    if (!await exists(file)) { return { document: { version: 1, configurations: [] }, revision: '' }; }
    if (!await contained(folder.uri.fsPath, file)) { throw new RunnerError('Configuration points outside the workspace.', true); }
    const content = await fs.readFile(file, 'utf8');
    try { return { document: validateFile(JSON.parse(content)), revision: digest(content) }; }
    catch (error) { throw new RunnerError(`${path.basename(file)}: ${error instanceof Error ? error.message : String(error)}`, true); }
  }
  toolchains(folder?: vscode.WorkspaceFolder): LocalToolchain[] { const legacy=this.context.globalState.get<LocalToolchain[]>('atelier.toolchains', []).filter(t => !t.project || !folder || t.project === folder.uri.toString());const global=hostToolchains()?.asLocalToolchains(folder?.uri.toString()??'')??[];const visibleLegacy=hostToolchains()?.guard.environment.kind&&hostToolchains()!.guard.environment.kind!=='local'?[]:legacy;return [...new Map([...visibleLegacy,...global].map(t=>[t.id,t])).values()]; }
  async putToolchains(toolchains: LocalToolchain[], folder: vscode.WorkspaceFolder): Promise<void> {
    if (!Array.isArray(toolchains) || toolchains.length > 200) { throw new RunnerError('Invalid toolchain list.'); }
    for (const t of toolchains) {
      if (!t || typeof t.id !== 'string' || !/^[\w.-]+$/.test(t.id) || typeof t.executable !== 'string' || typeof t.name !== 'string' || !(runtimeLanguages as readonly unknown[]).includes(t.language) || typeof t.manager !== 'string' || typeof t.version !== 'string') { throw new RunnerError('Invalid toolchain entry.'); }
      t.project = t.project === '' ? '' : folder.uri.toString();
    }
    const others = this.context.globalState.get<LocalToolchain[]>('atelier.toolchains', []).filter(t => t.project && t.project !== folder.uri.toString());
    await this.context.globalState.update('atelier.toolchains', [...others, ...toolchains]);
    const registry=hostToolchains();if(registry){for(const tool of toolchains){await registry.add(tool,tool.manager==='custom');}}
  }
  defaultToolchain(language: string, folder: vscode.WorkspaceFolder): string {
    return this.context.workspaceState.get<string>(`atelier.sdk:${folder.uri.toString()}:${language}`) ?? this.context.globalState.get<string>(`atelier.sdk:${language}`, '');
  }
  async setDefaultToolchain(language: string, id: string, folder: vscode.WorkspaceFolder, global = false): Promise<void> {
    await (global ? this.context.globalState : this.context.workspaceState).update(global ? `atelier.sdk:${language}` : `atelier.sdk:${folder.uri.toString()}:${language}`, id);
  }
  selection(folder: vscode.WorkspaceFolder, root: string, document: ConfigurationFile): Selection {
    return this.context.workspaceState.get<Selection>(selectionKey(folder.uri.toString(), root)) ?? (document.default ? { kind: 'managed', id: document.default } : { kind: 'auto' });
  }
  async select(folder: vscode.WorkspaceFolder, root: string, selection: Selection): Promise<void> {
    await this.context.workspaceState.update(selectionKey(folder.uri.toString(), root), selection);
  }
  async save(folder: vscode.WorkspaceFolder, input: unknown, revision: string): Promise<{ document: ConfigurationFile; revision: string }> {
    const document = validateFile(input);
    const current = await this.read(folder);
    if (current.revision !== revision) { throw new RunnerError('Configuration changed on disk. Reload the editor before applying your changes.'); }
    const local = this.toolchains(folder);
    const paths=this.context.globalState.get<Record<string,string>>('atelier.paths',{});
    const portable=(value:string,id:string)=>{const relative=portablePath(value,folder.uri.fsPath);if(path.isAbsolute(relative)){paths[folder.uri.toString()+':'+id]=relative;return '$'+'{localPath:'+id+'}';}return relative;};
    for (const c of document.configurations) {
      for (const key of ['target','cwd','output'] as const) { c[key] = portable(c[key],`${c.id}-${key}`); }
      c.toolchain=portablePath(c.toolchain,folder.uri.fsPath);
      // External interpreter paths are machine-local; the project file gets a portable reference.
      if (path.isAbsolute(c.toolchain)) {
        const id = `local-${c.id}`;
        const previous = local.find(t => t.id === id);
        const entry: LocalToolchain = { id, name: `${c.name} SDK`, language: c.language, executable: c.toolchain, version: previous?.version ?? '', manager: 'custom', project: folder.uri.toString() };
        const index = local.findIndex(t => t.id === id); if (index >= 0) { local[index] = entry; } else { local.push(entry); }
        c.toolchain = `\${toolchain:${id}}`;
      }
      const selectedId=c.toolchain.match(/^\$\{toolchain:([^}]+)\}$/)?.[1];
      const selected=selectedId?local.find(t=>t.id===selectedId):undefined;
      if(selected&&selectedId!==`local-${c.id}`){const id=`local-${c.id}`;const alias={...selected,id,name:`${c.name} SDK`,project:folder.uri.toString()};const index=local.findIndex(t=>t.id===id);if(index>=0){local[index]=alias;}else{local.push(alias);}c.toolchain='$'+'{toolchain:'+id+'}';}
      for (const key of ['sources','includePaths','libraryPaths','classPath','modulePath'] as const) { c[key] = c[key].map((v,i) => portable(v,`${c.id}-${key}-${i}`)); }
    }
    await this.putToolchains(local, folder);
    await this.context.globalState.update('atelier.paths',paths);
    const file = await this.location(folder); await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = path.join(path.dirname(file), `.sakura-atelier-${randomUUID()}.tmp`);
    const content = JSON.stringify(document, null, 2) + '\n';
    try { await fs.writeFile(temporary, content, { flag: 'wx', mode: 0o600 }); if((await this.read(folder)).revision!==revision){throw new RunnerError('Configuration changed while saving. Reload before trying again.');} await fs.rename(temporary, file); }
    finally { await fs.rm(temporary, { force: true }); }
    return { document, revision: digest(content) };
  }
}
