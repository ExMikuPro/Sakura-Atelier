import * as fs from 'node:fs/promises';
import type { BackendHost } from '../../src/adapterTypes';
export const fsHost: BackendHost = {
  async readDir(directory) { try { return await fs.readdir(directory); } catch { return []; } },
  async readText(file) { try { return await fs.readFile(file, 'utf8'); } catch { return undefined; } }
};
