import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';

/** Everything discovery needs from the machine. Injected so tests can describe Windows, Linux and macOS layouts. */
export interface DiscoveryHost {
  readonly platform: NodeJS.Platform;
  readonly env: Record<string, string | undefined>;
  readonly home: string;
  stat(file: string): Promise<'file' | 'dir' | undefined>;
  readDir(directory: string): Promise<string[]>;
  /** Runs a trusted, non-interactive version query. Resolves to the first output line, or undefined on failure. */
  version(command: string, args: string[]): Promise<string | undefined>;
}

export function pathApi(platform: NodeJS.Platform): path.PlatformPath { return platform === 'win32' ? path.win32 : path.posix; }

export function nodeHost(): DiscoveryHost {
  return {
    platform: process.platform, env: process.env, home: os.homedir(),
    async stat(file) { try { const s = await fs.stat(file); return s.isDirectory() ? 'dir' : s.isFile() ? 'file' : undefined; } catch { return undefined; } },
    async readDir(directory) { try { return await fs.readdir(directory); } catch { return []; } },
    version(command, args) {
      return new Promise(resolve => {
        execFile(command, args, { timeout: 8000, windowsHide: true, maxBuffer: 1 << 20 }, (error, stdout, stderr) => {
          const text = (stdout || stderr || '').split(/\r?\n/).find(line => line.trim());
          resolve(error && !text ? undefined : text?.trim().slice(0, 200));
        });
      });
    }
  };
}
