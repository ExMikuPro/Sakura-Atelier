import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import * as path from 'node:path';
import { RunnerError } from './model';
export async function resolveTool(command: string, cwd: string, env: NodeJS.ProcessEnv = process.env, platform = process.platform): Promise<string> {
  if (!command || /[\r\n\0]/.test(command)) { throw new RunnerError('Invalid executable name.', true); }
  const direct = path.isAbsolute(command) || command.includes('/') || command.includes('\\');
  const dirs = direct ? [''] : (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  const extensions = platform === 'win32' && !path.extname(command) ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';') : [''];
  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = direct ? path.resolve(cwd, command + ext) : path.resolve(dir, command + ext);
      try {
        if (!(await fs.stat(candidate)).isFile()) { continue; }
        await fs.access(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK);
        if (platform === 'win32' && /\.(cmd|bat)$/i.test(candidate)) {
          throw new RunnerError(`Windows wrapper ${command} requires an existing VS Code task. Set sakuraRunner.projectTask to its label.`, true);
        }
        return candidate;
      } catch (error) { if (error instanceof RunnerError) { throw error; } }
    }
  }
  throw new RunnerError(`Missing toolchain: ${command}. Install it yourself or configure its executable in Sakura Atelier settings.`, true);
}
export async function firstTool(commands: string[], cwd: string): Promise<string> {
  let last: unknown;
  for (const command of commands) { try { return await resolveTool(command, cwd); } catch (error) { last = error; } }
  throw last;
}
/** Windows treats environment keys case-insensitively, including per-process SDK PATH overrides. */
export function processEnvironment(overrides:Record<string,string>={},base:NodeJS.ProcessEnv=process.env,platform=process.platform):NodeJS.ProcessEnv{
  const environment={...base};
  for(const [key,value]of Object.entries(overrides)){
    if(platform==='win32'){for(const present of Object.keys(environment)){if(present.toLowerCase()===key.toLowerCase()&&present!==key){delete environment[present];}}}
    environment[key]=value;
  }
  return environment;
}
