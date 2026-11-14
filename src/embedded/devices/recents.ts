import { DeviceInfo, DeviceRef, cleanName, deviceKey, normalizeRef } from './model';
import { SyncableStore, recentDevicesKey } from './store';

export interface RecentDevice extends DeviceRef { name: string; usedAt: number }
const limit = 20;

/** Devices used by a project that was actually created. Separate from favorites: clearing history never touches favorites. */
export class RecentDevices {
  constructor(private readonly store: SyncableStore, private readonly now: () => number = Date.now) {}

  /** Newest first. */
  list(): RecentDevice[] {
    const raw = this.store.get<unknown>(recentDevicesKey, []);
    const items = Array.isArray(raw) ? raw : (raw as { items?: unknown[] })?.items ?? [];
    const seen = new Set<string>(); const result: RecentDevice[] = [];
    for (const entry of items as Record<string, unknown>[]) {
      const ref = normalizeRef(entry); if (!ref || seen.has(deviceKey(ref))) { continue; }
      seen.add(deviceKey(ref));
      result.push({ ...ref, name: cleanName(entry.name, ref.id), usedAt: typeof entry.usedAt === 'number' && Number.isFinite(entry.usedAt) ? entry.usedAt : 0 });
    }
    return result.sort((a, b) => b.usedAt - a.usedAt).slice(0, limit);
  }

  /** Call only after a project was created successfully. Merely selecting or starring a device must not record it. */
  async record(info: DeviceInfo | DeviceRef): Promise<void> {
    const ref = normalizeRef(info); if (!ref) { return; }
    const items = this.list().filter(r => deviceKey(r) !== deviceKey(ref));
    items.unshift({ ...ref, name: cleanName((info as DeviceInfo).name, ref.id), usedAt: Math.max(this.now(), (items[0]?.usedAt ?? 0) + 1) });
    await this.store.update(recentDevicesKey, { version: 2, items: items.slice(0, limit) });
  }

  async clear(): Promise<void> { await this.store.update(recentDevicesKey, { version: 2, items: [] }); }
}
