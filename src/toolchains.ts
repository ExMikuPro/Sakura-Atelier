import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { LocalToolchain, RuntimeLanguage } from './configuration';
import { PythonEnvironments } from './pythonEnvironments';
import { resolveTool } from './tools';
import { RunnerError } from './model';
const exec = promisify(execFile);
export async function query(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  try { const r = await exec(command, args, { cwd, env, timeout: 20000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }); return r.stdout || r.stderr; }
  catch (error) { throw new RunnerError(`Tool query failed: ${path.basename(command)} ${args.join(' ')}. ${error instanceof Error ? error.message : String(error)}`, true); }
}
export function toolchainId(language: string, executable: string, variant = ''): string { return `${language}-${createHash('sha256').update(executable + variant).digest('hex').slice(0,16)}`; }
export class ToolchainDiscovery {
  constructor(readonly python: PythonEnvironments) {}
  async discover(language: RuntimeLanguage, folder: vscode.WorkspaceFolder): Promise<LocalToolchain[]> {
    if (!vscode.workspace.isTrusted) { throw new RunnerError('Trust the workspace before querying toolchains.'); }
    if (language === 'python') { return this.python.discover(folder); }
    const cwd = folder.uri.fsPath;
    const candidates: Record<RuntimeLanguage, string[]> = { python: [], go: ['go'], rust: ['cargo'], c: ['clang','gcc', ...(process.platform === 'win32' ? ['cl'] : [])], cpp: ['clang++','g++', ...(process.platform === 'win32' ? ['cl'] : [])], csharp: ['dotnet'], java: ['java'], javascript: ['node'], javascriptreact: ['node'], typescript: ['node'], typescriptreact: ['node'], node: ['node'] };
    const nodes = ['javascript','javascriptreact','typescript','typescriptreact','node'].includes(language);
    if (language === 'java' && process.env.JAVA_HOME) { candidates.java.unshift(path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')); }
    if (language === 'go' && process.env.GOROOT) { candidates.go.unshift(path.join(process.env.GOROOT, 'bin', process.platform === 'win32' ? 'go.exe' : 'go')); }
    if (nodes) {
      for (const key of ['NVM_BIN','FNM_MULTISHELL_PATH','VOLTA_HOME']) {
        const root = process.env[key]; if (root) { candidates[language].push(path.join(root, key === 'NVM_BIN' ? '' : 'bin', process.platform === 'win32' ? 'node.exe' : 'node')); }
      }
      // Restrict version enumeration to the manager root explicitly exported by nvm.
      if (process.env.NVM_DIR) {
        const versions = path.join(process.env.NVM_DIR, 'versions/node');
        try { for (const entry of (await fs.readdir(versions, { withFileTypes: true })).filter(e => e.isDirectory()).slice(0,50)) { candidates[language].push(path.join(versions, entry.name, 'bin/node')); } } catch { /* nvm may not use this layout. */ }
      }
    }
    const results: LocalToolchain[] = [];
    for (const candidate of candidates[language]) {
      try {
        let executable = await resolveTool(candidate, cwd);
        const canonical=await fs.realpath(executable);if(language!=='rust'&&path.basename(canonical)===path.basename(executable)){executable=canonical;}
        if (results.some(t => t.executable === executable)) { continue; }
        const isMsvc = /^cl(?:\.exe)?$/i.test(path.basename(executable));
        let details = '';
        let versionArgs=isMsvc ? ['/help'] : language === 'go' ? ['version'] : language === 'csharp' ? ['--list-sdks'] : ['--version'];
        if(language==='rust'){
          try{const rustup=await resolveTool('rustup',cwd);details=await query(rustup,['toolchain','list'],cwd);const installed=details.split(/\r?\n/).find(line=>line.trim()&&!line.includes('no installed'));if(!installed){continue;}versionArgs=['+'+installed.split(/\s+/)[0],'--version'];}catch{/* Standalone Cargo does not need rustup. */}
        }
        const version=(await query(executable,versionArgs,cwd,{...process.env,GOTOOLCHAIN:'local'})).split(/\r?\n/)[0].slice(0,250);
        if (language === 'go') { details = `GOROOT: ${(await query(executable, ['env','GOROOT'], cwd, { ...process.env, GOTOOLCHAIN: 'local' })).trim()}`; }
        if (language === 'csharp') { details = await query(executable, ['--list-sdks'], cwd); }
        const manager = executable.includes(process.env.NVM_DIR || '\0') ? 'nvm' : process.env.VOLTA_HOME && executable.includes(process.env.VOLTA_HOME) ? 'Volta' : process.env.FNM_MULTISHELL_PATH && executable.includes(process.env.FNM_MULTISHELL_PATH) ? 'fnm' : 'PATH / custom';
        if(language==='rust'&&details){for(const line of details.split(/\r?\n/).filter(Boolean)){const rustToolchain=line.split(/\s+/)[0];results.push({id:toolchainId(language,executable,rustToolchain),name:`Cargo · ${rustToolchain}`,language,executable,version,manager:'rustup',project:folder.uri.toString(),details,rustToolchain});}continue;}
        results.push({ id: toolchainId(language, executable), name: `${path.basename(executable)} ${version}`, language, executable, version, manager, project: folder.uri.toString(), details });
      } catch { /* Discovery is partial; manually configured paths are validated at execution. */ }
    }
    return results;
  }
}
