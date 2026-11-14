import { isStm32Part } from '../stm32/ioc';

/**
 * Kinds are separate entities and never interchangeable:
 * - `pio-board`: a PlatformIO board id (`nucleo_g071rb`), the only thing that may be written to `board =` in platformio.ini.
 * - `stm32-mcu`: an STM32 part (`STM32G0B1RETx`). Not a PlatformIO board.
 * - `stm32-board`: an ST board (`NUCLEO-G071RB`). Not a PlatformIO board id, even though PlatformIO has a similarly named one.
 */
export const deviceKinds = ['pio-board', 'stm32-mcu', 'stm32-board'] as const;
export type DeviceKind = typeof deviceKinds[number];
export interface DeviceRef { kind: DeviceKind; id: string }

/** What a provider knows about a device. Free of machine-specific data, so it can be synced and shown without any tool installed. */
export interface DeviceInfo extends DeviceRef {
  name: string; vendor?: string; mcu?: string; platform?: string; family?: string;
  frameworks?: string[];
}

/** Identity of a device. STM32 names compare case-insensitively (ST writes the wildcard suffix as `x`); the id itself keeps its original case. */
export function deviceKey(ref: DeviceRef): string { return `${ref.kind}:${ref.kind === 'pio-board' ? ref.id : ref.id.toUpperCase()}`; }

/** Canonical id for a kind, or undefined when the value cannot be one. Rejects paths, control characters and anything oversized. */
export function normalizeDeviceId(kind: DeviceKind, value: unknown): string | undefined {
  if (typeof value !== 'string') { return undefined; }
  const id = value.trim();
  if (kind === 'pio-board') { return /^[A-Za-z0-9][A-Za-z0-9_.+-]{0,63}$/.test(id) ? id : undefined; }
  if (kind === 'stm32-mcu') { const upper = id.toUpperCase(); return isStm32Part(upper) && upper.length <= 40 ? (id === id.toLowerCase() ? upper : id) : undefined; }
  const upper = id.toUpperCase();
  return /^[A-Z0-9][A-Z0-9-]{2,40}$/.test(upper) ? upper : undefined;
}

export function normalizeRef(raw: unknown): DeviceRef | undefined {
  if (!raw || typeof raw !== 'object') { return undefined; }
  const { kind, id } = raw as Record<string, unknown>;
  if (!(deviceKinds as readonly unknown[]).includes(kind)) { return undefined; }
  const normalized = normalizeDeviceId(kind as DeviceKind, id);
  return normalized ? { kind: kind as DeviceKind, id: normalized } : undefined;
}

/** Display names are cosmetic; keep them short and single-line. */
export function cleanName(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.replace(/[\r\n\0]/g, ' ').trim().slice(0, 120) : fallback;
}
