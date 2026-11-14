import type { DeviceInfo, DeviceKind } from './model';

export type ProviderStatus =
  | { state: 'ready'; stale?: boolean; note?: string }
  | { state: 'unavailable'; reason: 'no-cli' | 'cli-failed' | 'bad-output' | 'empty' | 'unsupported'; detail?: string };

export interface ProviderResult { devices: DeviceInfo[]; status: ProviderStatus; fetchedAt?: number }

/** A source of devices. Each provider owns one vendor or tool; none of them knows about the others. */
export interface DeviceProvider {
  readonly id: string; readonly label: string; readonly kinds: readonly DeviceKind[];
  /** Cheap when cached. `refresh` forces a new query. Must never throw. */
  load(options?: { refresh?: boolean }): Promise<ProviderResult>;
}

/** Case-insensitive token search across the fields users actually type: id, name, vendor, MCU, platform, family, frameworks. In memory only. */
export function searchDevices<T extends DeviceInfo>(devices: readonly T[], query: string, limit = 200): T[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) { return devices.slice(0, limit); }
  const scored: { device: T; score: number }[] = [];
  for (const device of devices) {
    const id = device.id.toLowerCase(); const name = device.name.toLowerCase();
    const haystack = [id, name, device.vendor, device.mcu, device.platform, device.family, ...(device.frameworks ?? [])].filter(Boolean).join(' ').toLowerCase();
    if (!tokens.every(token => haystack.includes(token))) { continue; }
    const first = tokens[0];
    scored.push({ device, score: id === first ? 100 : id.startsWith(first) ? 50 : name.startsWith(first) ? 30 : 10 });
  }
  return scored.sort((a, b) => b.score - a.score || a.device.name.localeCompare(b.device.name)).slice(0, limit).map(s => s.device);
}

/** Merges providers. Loading is cached per provider, so typing in a search box never reaches an external tool. */
export class DeviceCatalog {
  private results = new Map<string, ProviderResult>();
  constructor(private readonly providers: readonly DeviceProvider[]) {}

  async load(refresh = false): Promise<Map<string, ProviderResult>> {
    if (refresh || !this.results.size) {
      const loaded = await Promise.all(this.providers.map(async p => [p.id, await p.load({ refresh }).catch((error: unknown): ProviderResult => ({ devices: [], status: { state: 'unavailable', reason: 'cli-failed', detail: error instanceof Error ? error.message : String(error) } }))] as const));
      this.results = new Map(loaded);
    }
    return this.results;
  }

  /** Current snapshot without any I/O. */
  snapshot(): { devices: DeviceInfo[]; status: Map<DeviceKind, ProviderStatus> } {
    const status = new Map<DeviceKind, ProviderStatus>(); const devices: DeviceInfo[] = [];
    for (const provider of this.providers) {
      const result = this.results.get(provider.id);
      for (const kind of provider.kinds) { status.set(kind, result?.status ?? { state: 'unavailable', reason: 'cli-failed', detail: 'not loaded' }); }
      devices.push(...(result?.devices ?? []));
    }
    return { devices, status };
  }
}
