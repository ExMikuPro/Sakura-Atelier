import * as path from 'node:path';
import type { BackendHost } from '../../adapterTypes';
import { DeviceInfo, cleanName, normalizeDeviceId } from './model';
import type { DeviceProvider, ProviderResult } from './provider';
import { parseIoc } from '../stm32/ioc';

/**
 * STM32 devices, modelled apart from PlatformIO boards.
 *
 * Data sources and their limits
 * - ST publishes no documented, stable command or API that lists STM32 MCUs or boards. STM32CubeMX keeps an internal database
 *   under its install folder; that layout is private and version dependent, so it is deliberately not read here.
 *   STM32CubeProgrammer and the Arm tools offer no enumeration either.
 * - Sakura Atelier therefore does not ship, guess or invent an MCU list or chip parameters. Verifiable sources only:
 *   1. MCUs and boards named by `.ioc` files in the user's own workspace (written by STM32CubeMX), and
 *   2. names the user types, accepted only when they have the shape of an STM32 part or ST board (see `parseManualDevice`).
 *      Favorites keep such names, so a typed MCU can be starred once and reused.
 * - A vendor database (another MCU family, or ST data if ST ever documents an interface) plugs in as one more `DeviceProvider`
 *   through `DeviceCatalog.add`.
 */

/** `STM32G0B1RETx` -> series `STM32G0`. Only the series is derived from the name; pin count, memory and package are never decoded here. */
export function stm32Series(part: string): string | undefined {
  return part.toUpperCase().match(/^(STM32(?:[A-Z]\d|W[BL]|MP\d))/)?.[1];
}

export interface ManualDeviceResult { device?: DeviceInfo; error?: string }

/** Validates a name the user typed. A board name is never accepted as an MCU and the other way round. */
export function parseManualDevice(kind: 'stm32-mcu' | 'stm32-board', text: string): ManualDeviceResult {
  const id = normalizeDeviceId(kind, text);
  if (!id) { return { error: kind === 'stm32-mcu' ? 'This is not an STM32 part number such as STM32G0B1RETx.' : 'This is not a valid ST board name such as NUCLEO-G071RB.' }; }
  if (kind === 'stm32-board' && /^STM32[A-Z][A-Z0-9]{2,}[A-Za-z0-9()-]*$/.test(id) && !/DISCO|EVAL|NUCLEO/.test(id)) { return { error: 'This looks like an MCU part number, not a board. Add it as an MCU.' }; }
  return { device: kind === 'stm32-mcu' ? { kind, id, name: id, vendor: 'STMicroelectronics', family: stm32Series(id) } : { kind, id, name: id, vendor: 'STMicroelectronics' } };
}

const skip = new Set(['node_modules', '.git', 'build', 'out', 'dist', '.pio', '.venv']);

/** MCUs and boards named by `.ioc` files below `root`. Bounded depth and entry count; reads files only. */
export async function scanIocDevices(root: string, host: BackendHost, maxDepth = 3): Promise<DeviceInfo[]> {
  const found = new Map<string, DeviceInfo>(); let visited = 0;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > maxDepth || visited++ > 2000) { return; }
    for (const entry of await host.readDir(dir)) {
      if (/\.ioc$/i.test(entry)) {
        const info = parseIoc(await host.readText(path.join(dir, entry)) ?? '');
        if (info.mcu) { found.set(`mcu:${info.mcu.toUpperCase()}`, { kind: 'stm32-mcu', id: info.mcu, name: info.mcu, vendor: 'STMicroelectronics', family: stm32Series(info.mcu) }); }
        const board = info.board && info.board.toLowerCase() !== 'custom' ? normalizeDeviceId('stm32-board', info.board) : undefined;
        // The board and MCU are linked only when the same .ioc states both.
        if (board) { found.set(`board:${board}`, { kind: 'stm32-board', id: board, name: board, vendor: 'STMicroelectronics', ...(info.mcu ? { mcu: info.mcu } : {}) }); }
      } else if (!entry.startsWith('.') && !skip.has(entry) && !/\.[A-Za-z0-9]{1,5}$/.test(entry)) { await walk(path.join(dir, entry), depth + 1); }
    }
  };
  await walk(root, 0);
  return [...found.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** STM32 MCUs and ST boards that the user's workspaces already use. See the notes above for why this is not a full catalog. */
export class Stm32WorkspaceProvider implements DeviceProvider {
  readonly id = 'stm32-workspace'; readonly label = 'STM32 (workspace .ioc files)'; readonly kinds = ['stm32-mcu', 'stm32-board'] as const;
  constructor(private readonly roots: () => string[], private readonly host: BackendHost) {}
  async load(): Promise<ProviderResult> {
    const devices: DeviceInfo[] = [];
    for (const root of this.roots()) { for (const device of await scanIocDevices(root, this.host).catch(() => [])) { if (!devices.some(d => d.kind === device.kind && d.id.toUpperCase() === device.id.toUpperCase())) { devices.push({ ...device, name: cleanName(device.name, device.id) }); } } }
    // Being empty is normal (no .ioc yet): the user can still type a valid part number.
    return { devices, status: { state: 'ready', note: devices.length ? undefined : 'No .ioc files in the open workspaces. Enter an STM32 part number manually.' }, fetchedAt: Date.now() };
  }
}

/** The only PlatformIO board id source. An STM32 MCU or ST board is never converted into one by guessing. */
export function platformioBoardId(ref: { kind: string; id: string }): string | undefined { return ref.kind === 'pio-board' ? ref.id : undefined; }
