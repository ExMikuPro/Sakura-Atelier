import { execFile } from 'node:child_process';

/** Runs a command without a shell and resolves to its stdout. Used for official CLI queries only. */
export type Runner = (command: string, args: string[], cwd: string, timeoutMs?: number) => Promise<string>;

export const nodeRunner: Runner = (command, args, cwd, timeoutMs = 30000) => new Promise((resolve, reject) => {
  execFile(command, args, { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, PLATFORMIO_NO_ANSI: 'true' } }, (error, stdout, stderr) => {
    if (error) { reject(new Error(`${command} ${args.join(' ')} failed: ${(stderr || error.message).trim().split(/\r?\n/).slice(-3).join(' ')}`)); } else { resolve(stdout); }
  });
});
