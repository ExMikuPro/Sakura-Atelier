import * as path from 'node:path';
import { RunnerError } from './model';
export function activationCommand(shell: string, prefix: string, platform = process.platform): string {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const name = p.basename(shell).toLowerCase().replace(/\.exe$/, '');
  const script = p.join(prefix, platform === 'win32' ? 'Scripts' : 'bin');
  const posixQuote = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
  if (['bash','zsh','sh'].includes(name)) { return `. ${posixQuote(p.join(script, 'activate'))}`; }
  if (name === 'fish') { return `source '${p.join(script, 'activate.fish').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`; }
  if (['pwsh','powershell'].includes(name)) { return `. '${p.join(script, 'Activate.ps1').replace(/'/g, "''")}'`; }
  if (name === 'cmd') {
    const file = p.join(script, 'activate.bat');
    if (/[%!^&|<>\r\n"]/.test(file)) { throw new RunnerError('This cmd activation path needs the official Python Environments extension because it contains cmd metacharacters.', true); }
    return `call "${file}"`;
  }
  throw new RunnerError(`Shell ${name} has no verified venv activation recipe. Install Python Environments or select bash/zsh/fish/PowerShell/cmd.`, true);
}
