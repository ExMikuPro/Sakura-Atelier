import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { DeviceInfo, deviceKey, normalizeDeviceId } from './model';
import type { DeviceProvider, ProviderResult } from './provider';
import { stm32Series } from './stm32Devices';

// These are version-dependent files in the user's installation, not a public ST API.
// Read names only, never execute XML entities or redistribute the vendor database.
const attribute = (tag: string, name: string): string | undefined => tag.match(new RegExp('(?:^|\\s)' + name + '=["\']([^"\']+)["\']'))?.[1];
async function readDatabase(file: string): Promise<string | undefined> {
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > 16 * 1024 * 1024) return undefined;
    return (await fs.readFile(file, 'utf8')).replace(/<!--[\s\S]*?-->/g, '');
  } catch { return undefined; }
}

/** Optional, read-only catalog from a locally installed STM32CubeMX. */
export class CubeMxDeviceProvider implements DeviceProvider {
  readonly id = 'stm32-cubemx'; readonly label = 'STM32CubeMX local database';
  readonly kinds = ['stm32-mcu', 'stm32-board'] as const;
  constructor(private readonly resolveExecutable: () => Promise<string | undefined>) {}

  async load(): Promise<ProviderResult> {
    const executable = await this.resolveExecutable();
    if (!executable) return { devices: [], status: { state: 'unavailable', reason: 'no-cli', detail: 'Locate STM32CubeMX to load its local device database.' } };
    const folder = path.dirname(executable);
    const roots = [...new Set([path.resolve(folder, '../Resources/db'), path.join(folder, 'db'), path.resolve(folder, '../db')])];
    for (const root of roots) {
      const families = await readDatabase(path.join(root, 'mcu/families.xml'));
      if (!families) continue;
      const found = new Map<string, DeviceInfo>();
      for (const match of families.matchAll(/<Mcu\b([^>]*)>/g)) {
        const id = normalizeDeviceId('stm32-mcu', attribute(match[1], 'RefName') ?? attribute(match[1], 'Name'));
        if (id) { const device: DeviceInfo = { kind: 'stm32-mcu', id, name: id, vendor: 'STMicroelectronics', family: stm32Series(id) }; found.set(deviceKey(device), device); }
      }
      if (!found.size) continue;
      const boardRoot = path.join(root, 'plugins/boardmanager');
      const files = await fs.readdir(boardRoot).catch(() => [] as string[]);
      for (const file of files.filter(name => name.endsWith('.pdsc')).slice(0, 100)) {
        const text = await readDatabase(path.join(boardRoot, file));
        if (!text) continue;
        for (const match of text.matchAll(/<board\b([^>]*)>([\s\S]*?)<\/board>/g)) {
          const id = normalizeDeviceId('stm32-board', attribute(match[1], 'name'));
          if (!id) continue;
          const mounted = match[2].match(/<mountedDevice\b([^>]*)>/)?.[1];
          const mcu = mounted && normalizeDeviceId('stm32-mcu', attribute(mounted, 'Dname'));
          const device: DeviceInfo = { kind: 'stm32-board', id, name: id, vendor: 'STMicroelectronics', ...(mcu ? { mcu } : {}) };
          found.set(deviceKey(device), device);
        }
      }
      return { devices: [...found.values()].sort((a, b) => a.id.localeCompare(b.id)), status: { state: 'ready', note: 'Read from the local STM32CubeMX database.' }, fetchedAt: Date.now() };
    }
    return { devices: [], status: { state: 'unavailable', reason: 'unsupported', detail: 'This STM32CubeMX database layout is unavailable or unsupported. Workspace .ioc files and manual names remain available.' } };
  }
}
