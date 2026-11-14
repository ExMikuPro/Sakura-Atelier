import * as path from 'node:path';
import type { DiscoveryHost } from '../../src/embedded/discoveryHost';

export interface FakeHostOptions { platform: NodeJS.Platform; files?: string[]; dirs?: string[]; env?: Record<string, string>; home?: string; versions?: Record<string, string> }
/** Virtual machine described by a list of files. Parent directories are implied. Records every executed version query. */
export function fakeHost(options: FakeHostOptions): DiscoveryHost & { executed: string[] } {
  const p = options.platform === 'win32' ? path.win32 : path.posix;
  const files = new Set((options.files ?? []).map(f => p.normalize(f)));
  const dirs = new Set<string>();
  for (const entry of [...files, ...(options.dirs ?? []).map(d => p.normalize(d))]) {
    let current = p.dirname(entry);
    if (options.dirs?.map(d => p.normalize(d)).includes(entry)) { dirs.add(entry); }
    while (!dirs.has(current)) { dirs.add(current); const parent = p.dirname(current); if (parent === current) { break; } current = parent; }
  }
  const executed: string[] = [];
  return {
    platform: options.platform, env: options.env ?? {}, home: options.home ?? (options.platform === 'win32' ? 'C:\\Users\\me' : '/home/me'), executed,
    async stat(file) { const n = p.normalize(file); return files.has(n) ? 'file' : dirs.has(n) ? 'dir' : undefined; },
    async readDir(directory) {
      const n = p.normalize(directory); const names = new Set<string>();
      for (const entry of [...files, ...dirs]) { if (p.dirname(entry) === n && entry !== n) { names.add(p.basename(entry)); } }
      return [...names];
    },
    async version(command) { executed.push(command); return options.versions?.[command]; }
  };
}
