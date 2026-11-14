import { DeviceInfo, DeviceRef, cleanName, deviceKey, normalizeDeviceId, normalizeRef } from './model';
import { SyncableStore, favoriteDevicesKey } from './store';

export interface FavoriteDevice extends DeviceRef { name: string; addedAt: number }
interface Stored { version: 2; items: FavoriteDevice[] }
const limit = 500;

/** Version 1 stored plain strings, optionally prefixed (`pio:`, `mcu:`, `board:`). Unprefixed STM32 part names are MCUs, everything else a PlatformIO board id. */
export function migrateLegacy(value: string): DeviceRef | undefined {
  const text = value.trim();
  const [, prefix, rest] = text.match(/^(pio|platformio|mcu|stm32|board|stm32board):(.+)$/i) ?? [];
  const kind = !prefix ? (/^STM32[A-Za-z0-9]/i.test(text) ? 'stm32-mcu' : 'pio-board')
    : /^(pio|platformio)$/i.test(prefix) ? 'pio-board' : /^(mcu|stm32)$/i.test(prefix) ? 'stm32-mcu' : 'stm32-board';
  const id = normalizeDeviceId(kind, prefix ? rest : text);
  return id ? { kind, id } : undefined;
}

/** Saves a favorite the moment it is toggled. Lives in `globalState`: shared by every workspace, never written into a project. */
export class DeviceFavorites {
  constructor(private readonly store: SyncableStore, private readonly now: () => number = Date.now) {}

  /** Reads, validates, migrates and de-duplicates. Unknown or corrupt entries are dropped; nothing throws. */
  list(): FavoriteDevice[] {
    const raw = this.store.get<unknown>(favoriteDevicesKey, undefined);
    const entries: unknown[] = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as Stored).items) ? (raw as Stored).items : [];
    const seen = new Set<string>(); const result: FavoriteDevice[] = [];
    for (const entry of entries) {
      let ref: DeviceRef | undefined; let name: string | undefined; let addedAt = 0;
      if (typeof entry === 'string') { ref = migrateLegacy(entry); name = ref?.id; }
      else { ref = normalizeRef(entry); const e = entry as Record<string, unknown>; name = ref ? cleanName(e?.name, ref.id) : undefined; addedAt = typeof e?.addedAt === 'number' && Number.isFinite(e.addedAt) ? e.addedAt : 0; }
      if (!ref || seen.has(deviceKey(ref))) { continue; }
      seen.add(deviceKey(ref)); result.push({ ...ref, name: name ?? ref.id, addedAt });
    }
    return result.slice(0, limit);
  }

  isFavorite(ref: DeviceRef): boolean { const key = deviceKey(ref); return this.list().some(f => deviceKey(f) === key); }

  private async write(items: FavoriteDevice[]): Promise<void> { await this.store.update(favoriteDevicesKey, { version: 2, items } satisfies Stored); }

  /** Rewrites a legacy or corrupt value in the current format. Safe to call at every activation. */
  async migrate(): Promise<void> {
    const raw = this.store.get<unknown>(favoriteDevicesKey, undefined);
    if (raw !== undefined && !(raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as Stored).version === 2)) { await this.write(this.list()); }
  }

  async add(info: DeviceInfo | DeviceRef): Promise<void> {
    const ref = normalizeRef(info); if (!ref) { throw new Error('This is not a valid device identifier.'); }
    const items = this.list();
    if (items.some(f => deviceKey(f) === deviceKey(ref))) { return; }
    items.unshift({ ...ref, name: cleanName((info as DeviceInfo).name, ref.id), addedAt: this.now() });
    await this.write(items.slice(0, limit));
  }

  async remove(ref: DeviceRef): Promise<void> {
    const key = deviceKey(ref);
    const items = this.list();
    const next = items.filter(f => deviceKey(f) !== key);
    if (next.length !== items.length) { await this.write(next); }
  }

  /** Returns the new state. Used by the star button: one click saves or removes, no Apply step. */
  async toggle(info: DeviceInfo | DeviceRef): Promise<boolean> {
    const ref = normalizeRef(info); if (!ref) { throw new Error('This is not a valid device identifier.'); }
    if (this.isFavorite(ref)) { await this.remove(ref); return false; }
    await this.add(info); return true;
  }
}
