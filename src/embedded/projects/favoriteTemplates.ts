import { createHash } from 'node:crypto';
import { DeviceRef, cleanName, deviceKey, normalizeRef } from '../devices/model';
import type { SyncableStore } from '../devices/store';
import { favoriteTemplatesKey } from '../devices/store';
import type { CreationOptions } from './creation';
import { sanitizeOptions } from './creation';
import type { ProjectTemplate } from './template';
import type { PioBoardInfo } from '../devices/pioBoards';

/** A saved combination: device + framework + build system + common options. Never a path, name or location. */
export interface FavoriteTemplate {
  id: string; name: string; templateId: string;
  device?: DeviceRef & { name: string };
  framework?: string; options: CreationOptions; addedAt: number;
}
export interface FavoriteTemplateInput { templateId: string; device?: DeviceRef & { name?: string }; framework?: string; options?: unknown; name?: string }
interface Stored { version: 1; items: FavoriteTemplate[] }
const limit = 200;

const safeText = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.+-]{0,63}$/.test(value) ? value : undefined;

/** Stable identity of a combination, so the same one cannot be stored twice. */
export function templateFingerprint(input: { templateId: string; device?: DeviceRef; framework?: string; options?: CreationOptions }): string {
  const options = Object.entries(input.options ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return createHash('sha256').update(JSON.stringify([input.templateId, input.device ? deviceKey(input.device) : '', input.framework ?? '', options])).digest('hex').slice(0, 16);
}

export class FavoriteTemplates {
  constructor(private readonly store: SyncableStore, private readonly now: () => number = Date.now) {}

  list(): FavoriteTemplate[] {
    const raw = this.store.get<unknown>(favoriteTemplatesKey, undefined);
    const items = raw && typeof raw === 'object' && Array.isArray((raw as Stored).items) ? (raw as Stored).items : [];
    // Stored data is untrusted; validate every field below.
    const seen = new Set<string>(); const result: FavoriteTemplate[] = [];
    for (const entry of items as unknown as Record<string, unknown>[]) {
      const templateId = safeText(entry?.templateId); if (!templateId) { continue; }
      const ref = entry.device ? normalizeRef(entry.device) : undefined;
      if (entry.device && !ref) { continue; }
      const framework = entry.framework === undefined ? undefined : safeText(entry.framework); if (entry.framework !== undefined && !framework) { continue; }
      const { options } = sanitizeOptions(entry.options);
      const id = templateFingerprint({ templateId, device: ref, framework, options });
      if (seen.has(id)) { continue; }
      seen.add(id);
      result.push({ id, name: cleanName(entry.name, templateId), templateId, ...(ref ? { device: { ...ref, name: cleanName((entry.device as { name?: unknown }).name, ref.id) } } : {}), ...(framework ? { framework } : {}), options, addedAt: typeof entry.addedAt === 'number' ? entry.addedAt : 0 });
    }
    return result.slice(0, limit);
  }

  private async write(items: FavoriteTemplate[]): Promise<void> { await this.store.update(favoriteTemplatesKey, { version: 1, items } satisfies Stored); }

  /** Rejects anything that is not a plain combination. Returns the stored entry. */
  async add(input: FavoriteTemplateInput): Promise<FavoriteTemplate> {
    const templateId = safeText(input.templateId); if (!templateId) { throw new Error('Invalid template.'); }
    const ref = input.device ? normalizeRef(input.device) : undefined; if (input.device && !ref) { throw new Error('Invalid device.'); }
    const framework = input.framework === undefined || input.framework === '' ? undefined : safeText(input.framework); if (input.framework && !framework) { throw new Error('Invalid framework.'); }
    const { options, invalid } = sanitizeOptions(input.options); if (invalid.length) { throw new Error(`Unsupported option: ${invalid.join(', ')}`); }
    const id = templateFingerprint({ templateId, device: ref, framework, options });
    const items = this.list();
    const existing = items.find(i => i.id === id); if (existing) { return existing; }
    const entry: FavoriteTemplate = { id, name: cleanName(input.name, [input.device?.name ?? ref?.id, framework, templateId].filter(Boolean).join(' + ')), templateId, ...(ref ? { device: { ...ref, name: cleanName(input.device?.name, ref.id) } } : {}), ...(framework ? { framework } : {}), options, addedAt: this.now() };
    await this.write([entry, ...items].slice(0, limit));
    return entry;
  }

  async remove(id: string): Promise<void> { const items = this.list(); const next = items.filter(i => i.id !== id); if (next.length !== items.length) { await this.write(next); } }
  isFavorite(input: FavoriteTemplateInput): boolean {
    const ref = input.device ? normalizeRef(input.device) : undefined;
    const { options } = sanitizeOptions(input.options);
    const id = templateFingerprint({ templateId: input.templateId, device: ref, framework: input.framework || undefined, options });
    return this.list().some(i => i.id === id);
  }
  async toggle(input: FavoriteTemplateInput): Promise<boolean> {
    const ref = input.device ? normalizeRef(input.device) : undefined; const { options } = sanitizeOptions(input.options);
    const id = templateFingerprint({ templateId: input.templateId, device: ref, framework: input.framework || undefined, options });
    if (this.list().some(i => i.id === id)) { await this.remove(id); return false; }
    await this.add(input); return true;
  }
}

export interface RestoreProblem { code: 'template-missing' | 'device-unavailable' | 'device-unknown' | 'framework-unsupported'; message: string; fix: string }
export interface RestoreContext {
  templates: { get(id: string): ProjectTemplate | undefined };
  boards: ReadonlyMap<string, PioBoardInfo>;
  /** Whether the provider for PlatformIO boards could be loaded now. */
  boardsAvailable: boolean;
}
export interface RestoredTemplate { templateId: string; device?: DeviceRef; framework?: string; options: CreationOptions; problems: RestoreProblem[] }

/**
 * Turns a favorite back into wizard choices. Only the saved combination is restored; the toolchain is resolved again at creation time,
 * and if something is not available now the reason and a fix are reported instead of silently dropping it.
 */
export function restoreFavoriteTemplate(favorite: FavoriteTemplate, context: RestoreContext): RestoredTemplate {
  const problems: RestoreProblem[] = [];
  const template = context.templates.get(favorite.templateId);
  if (!template) { problems.push({ code: 'template-missing', message: `The template "${favorite.templateId}" is not available in this version.`, fix: 'Update Sakura Atelier or choose another template.' }); }
  if (favorite.device && template?.backend === 'platformio') {
    if (!context.boardsAvailable) { problems.push({ code: 'device-unavailable', message: 'PlatformIO boards cannot be listed right now, so the saved board cannot be checked.', fix: 'Locate PlatformIO Core in "Embedded Tools..." or reload the boards.' }); }
    else {
      const board = context.boards.get(favorite.device.id);
      if (!board) { problems.push({ code: 'device-unknown', message: `PlatformIO does not list the board "${favorite.device.id}" any more.`, fix: 'Reload the boards, or pick a similar board and save the combination again.' }); }
      else if (favorite.framework && !board.frameworks?.includes(favorite.framework)) { problems.push({ code: 'framework-unsupported', message: `"${board.name}" no longer supports the framework "${favorite.framework}".`, fix: `Choose one of: ${(board.frameworks ?? []).join(', ') || 'none listed'}.` }); }
    }
  }
  return { templateId: favorite.templateId, ...(favorite.device ? { device: { kind: favorite.device.kind, id: favorite.device.id } } : {}), ...(favorite.framework ? { framework: favorite.framework } : {}), options: { ...favorite.options }, problems };
}
