import { DeviceInfo, DeviceKind, DeviceRef, deviceKey } from './model';
import type { FavoriteDevice } from './favorites';
import type { RecentDevice } from './recents';
import { ProviderStatus, searchDevices } from './provider';

export const deviceSections = ['favorites', 'recent', 'pio-board', 'stm32-mcu', 'all'] as const;
export type DeviceSection = typeof deviceSections[number];

/** Why a device cannot be used right now. Favorites with a reason are still listed, never deleted. */
export type Availability = { state: 'ok' } | { state: 'toolchain-missing'; kind: DeviceKind } | { state: 'not-in-catalog' };
export interface DeviceRow { device: DeviceInfo; favorite: boolean; availability: Availability }

export interface DeviceListInput {
  devices: readonly DeviceInfo[]; status: ReadonlyMap<DeviceKind, ProviderStatus>;
  favorites: readonly FavoriteDevice[]; recents: readonly RecentDevice[];
  section?: DeviceSection; query?: string; limit?: number;
}

/** Favorites first, then recents, then PlatformIO boards. */
export function defaultSection(favorites: readonly unknown[], recents: readonly unknown[]): DeviceSection {
  return favorites.length ? 'favorites' : recents.length ? 'recent' : 'pio-board';
}

export function buildDeviceList(input: DeviceListInput): DeviceRow[] {
  const section = input.section ?? defaultSection(input.favorites, input.recents);
  const byKey = new Map(input.devices.map(d => [deviceKey(d), d]));
  const favoriteKeys = new Set(input.favorites.map(deviceKey));
  const availability = (ref: DeviceRef): Availability => {
    const status = input.status.get(ref.kind);
    if (status?.state === 'unavailable') { return { state: 'toolchain-missing', kind: ref.kind }; }
    return byKey.has(deviceKey(ref)) ? { state: 'ok' } : { state: 'not-in-catalog' };
  };
  const row = (ref: DeviceRef, fallbackName: string): DeviceRow => ({ device: byKey.get(deviceKey(ref)) ?? { ...ref, name: fallbackName }, favorite: favoriteKeys.has(deviceKey(ref)), availability: availability(ref) });
  let rows: DeviceRow[];
  if (section === 'favorites') { rows = input.favorites.map(f => row(f, f.name)); }
  else if (section === 'recent') { rows = input.recents.map(r => row(r, r.name)); }
  else {
    const pool = section === 'all' ? input.devices : input.devices.filter(d => d.kind === section);
    rows = pool.map(d => row(d, d.name));
  }
  const matched = new Set(searchDevices(rows.map(r => r.device), input.query ?? '', input.limit ?? 200).map(deviceKey));
  const limited = rows.filter(r => matched.has(deviceKey(r.device)));
  // Keep search ranking for queries; keep stored order for favorites and recents when there is no query.
  if (!(input.query ?? '').trim()) { return limited.slice(0, input.limit ?? 200); }
  const rank = new Map(searchDevices(rows.map(r => r.device), input.query ?? '', input.limit ?? 200).map((d, i) => [deviceKey(d), i]));
  return limited.sort((a, b) => rank.get(deviceKey(a.device))! - rank.get(deviceKey(b.device))!);
}
