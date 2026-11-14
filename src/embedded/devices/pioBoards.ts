import type { Runner } from '../process';
import { DeviceInfo, cleanName, normalizeDeviceId } from './model';
import type { DeviceProvider, ProviderResult } from './provider';

export interface PioBoardInfo extends DeviceInfo {
  kind: 'pio-board';
  /** Whether PlatformIO already has this board's platform installed. Undefined when that could not be queried. */
  installed?: boolean;
  fcpu?: number; ram?: number; rom?: number;
}

/** `pio boards --json-output`: an array of { id, name, platform, mcu, fcpu, ram, rom, frameworks[], vendor, url, debug }. Ids come from PlatformIO, never from display names. */
export function parseBoards(output: string): PioBoardInfo[] {
  let data: unknown;
  // The CLI may append a promotional banner after the JSON line.
  const candidates = [output.trim(), output.split(/\r?\n/).find(line => /^\s*\[/.test(line)) ?? ''];
  for (const text of candidates) { try { data = JSON.parse(text); break; } catch { /* try the next form */ } }
  if (data === undefined) { throw new Error('PlatformIO returned a board list that is not valid JSON.'); }
  if (!Array.isArray(data)) { throw new Error('PlatformIO returned an unexpected board list format.'); }
  const seen = new Set<string>(); const boards: PioBoardInfo[] = [];
  for (const raw of data as Record<string, unknown>[]) {
    const id = normalizeDeviceId('pio-board', raw?.id);
    if (!id || seen.has(id)) { continue; }
    seen.add(id);
    const text = (value: unknown) => typeof value === 'string' && value ? cleanName(value, '') : undefined;
    const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    boards.push({
      kind: 'pio-board', id, name: cleanName(raw.name, id), vendor: text(raw.vendor), mcu: text(raw.mcu), platform: text(raw.platform),
      frameworks: Array.isArray(raw.frameworks) ? raw.frameworks.filter((f): f is string => typeof f === 'string') : [],
      fcpu: number(raw.fcpu), ram: number(raw.ram), rom: number(raw.rom)
    });
  }
  return boards;
}

export interface BoardCacheEntry { source: string; fetchedAt: number; boards: PioBoardInfo[] }
export interface BoardCache { read(): Promise<BoardCacheEntry | undefined>; write(entry: BoardCacheEntry): Promise<void> }

export interface PioBoardProviderOptions {
  /** Absolute path of the PlatformIO CLI, or undefined when it is not installed. */
  resolvePio(): Promise<string | undefined>;
  run: Runner; cache: BoardCache; cwd: string;
  now?: () => number; ttlMs?: number;
  /** Called when a background refresh finished with new data. */
  onUpdate?: (result: ProviderResult) => void;
}

/**
 * Boards from the official CLI, cached so the wizard does not query PlatformIO on every open.
 * A fresh cache is used as is; an expired cache is shown at once and refreshed in the background;
 * a failed refresh keeps the old data. `refresh: true` is the manual reload.
 */
export class PioBoardProvider implements DeviceProvider {
  readonly id = 'platformio'; readonly label = 'PlatformIO'; readonly kinds = ['pio-board'] as const;
  private inflight?: Promise<ProviderResult>;
  constructor(private readonly options: PioBoardProviderOptions) {}
  private now() { return (this.options.now ?? Date.now)(); }

  async load(options: { refresh?: boolean } = {}): Promise<ProviderResult> {
    const pio = await this.options.resolvePio();
    const cached = await this.options.cache.read().catch(() => undefined);
    const usable = cached && cached.source === pio ? cached : undefined;
    const fresh = usable && this.now() - usable.fetchedAt < (this.options.ttlMs ?? 7 * 24 * 3600 * 1000);
    if (!pio) {
      // Without a CLI the last known list (from any earlier installation) is still better than nothing.
      return cached?.boards.length ? { devices: cached.boards, fetchedAt: cached.fetchedAt, status: { state: 'ready', stale: true, note: 'PlatformIO Core was not found; showing the last known list.' } } : { devices: [], status: { state: 'unavailable', reason: 'no-cli' } };
    }
    if (usable && fresh && !options.refresh) { return { devices: usable.boards, fetchedAt: usable.fetchedAt, status: { state: 'ready' } }; }
    if (usable && !options.refresh) {
      void this.refresh(pio, usable).then(result => { if (result.status.state === 'ready' && !result.status.stale) { this.options.onUpdate?.(result); } });
      return { devices: usable.boards, fetchedAt: usable.fetchedAt, status: { state: 'ready', stale: true, note: 'Refreshing in the background.' } };
    }
    return this.refresh(pio, usable);
  }

  /** One query at a time; concurrent callers share it. */
  private refresh(pio: string, previous: BoardCacheEntry | undefined): Promise<ProviderResult> {
    this.inflight ??= this.query(pio, previous).finally(() => { this.inflight = undefined; });
    return this.inflight;
  }

  private async query(pio: string, previous: BoardCacheEntry | undefined): Promise<ProviderResult> {
    try {
      const boards = parseBoards(await this.options.run(pio, ['boards', '--json-output'], this.options.cwd, 120000));
      if (!boards.length) { return { devices: previous?.boards ?? [], status: previous ? { state: 'ready', stale: true, note: 'PlatformIO returned no boards; kept the previous list.' } : { state: 'unavailable', reason: 'empty' } }; }
      try {
        const installed = new Set(parseBoards(await this.options.run(pio, ['boards', '--installed', '--json-output'], this.options.cwd, 60000)).map(b => b.id));
        for (const board of boards) { board.installed = installed.has(board.id); }
      } catch { /* Installed state stays unknown; the list itself is still valid. */ }
      const entry = { source: pio, fetchedAt: this.now(), boards };
      await this.options.cache.write(entry).catch(() => undefined);
      return { devices: boards, fetchedAt: entry.fetchedAt, status: { state: 'ready' } };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const bad = /valid JSON|unexpected board list/.test(detail);
      if (previous) { return { devices: previous.boards, fetchedAt: previous.fetchedAt, status: { state: 'ready', stale: true, note: detail } }; }
      return { devices: [], status: { state: 'unavailable', reason: bad ? 'bad-output' : 'cli-failed', detail } };
    }
  }
}
