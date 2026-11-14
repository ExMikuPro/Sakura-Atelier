import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { BoardCache, BoardCacheEntry, PioBoardProvider } from './pioBoards';
import { DeviceCatalog } from './provider';
import { createToolRegistry } from '../toolsCommand';
import { nodeRunner } from '../process';

/** Board list cache in the extension's global storage on the machine that runs the extension (the remote host in SSH, WSL and Dev Containers). */
export class FileBoardCache implements BoardCache {
  constructor(private readonly file: string) {}
  async read(): Promise<BoardCacheEntry | undefined> {
    try {
      const data = JSON.parse(await fs.readFile(this.file, 'utf8')) as BoardCacheEntry;
      return typeof data.source === 'string' && typeof data.fetchedAt === 'number' && Array.isArray(data.boards) ? data : undefined;
    } catch { return undefined; }
  }
  async write(entry: BoardCacheEntry): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(entry), 'utf8');
    await fs.rename(temporary, this.file);
  }
}

let catalog: DeviceCatalog | undefined;
/** One catalog per extension host. Providers are listed here; adding another platform means adding one provider. */
export function deviceCatalog(context: vscode.ExtensionContext): DeviceCatalog {
  catalog ??= new DeviceCatalog([
    new PioBoardProvider({
      resolvePio: () => createToolRegistry(context).resolve('platformio'),
      run: nodeRunner, cwd: context.globalStorageUri.fsPath,
      cache: new FileBoardCache(path.join(context.globalStorageUri.fsPath, 'pio-boards.json'))
    })
  ]);
  return catalog;
}

/** Manual "reload devices" action. Runs the official CLI, so it needs a trusted workspace. */
export async function reloadDevices(context: vscode.ExtensionContext): Promise<void> {
  const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Sakura Atelier: Reloading PlatformIO boards...' }, () => deviceCatalog(context).load(true));
  const pio = result.get('platformio');
  if (pio?.status.state === 'ready') { void vscode.window.showInformationMessage(`Sakura Atelier: ${pio.devices.length} PlatformIO boards loaded${pio.status.stale ? ' (kept the previous list: ' + (pio.status.note ?? 'refresh failed') + ')' : ''}.`); }
  else { void vscode.window.showWarningMessage(`Sakura Atelier: PlatformIO boards are unavailable (${pio?.status.state === 'unavailable' ? pio.status.reason : 'unknown'}). Locate PlatformIO Core with "Sakura Atelier: Embedded Tools...".`); }
}
