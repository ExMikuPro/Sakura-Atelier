import { projectLanguages, runtimeForProject } from '../../projectScaffolds';
import type { DeviceFavorites } from '../devices/favorites';
import type { RecentDevices } from '../devices/recents';
import { DeviceInfo, DeviceKind, DeviceRef, cleanName, deviceKey, normalizeRef } from '../devices/model';
import type { PioBoardInfo } from '../devices/pioBoards';
import { buildDeviceList, defaultSection, DeviceSection, deviceSections } from '../devices/deviceList';
import type { ProviderStatus } from '../devices/provider';
import { parseManualDevice } from '../devices/stm32Devices';
import { CreationContext, CreationOptions, CreationPlan, planCreation, sanitizeOptions, validateProjectName } from './creation';
import { FavoriteTemplates, restoreFavoriteTemplate, RestoreProblem } from './favoriteTemplates';
import type { ProjectTemplate } from './template';
import { wizardLabelKeys, wizardText } from './wizardStrings';
import type { UiLanguage } from '../strings';

export interface WizardDeps {
  favorites: DeviceFavorites; recents: RecentDevices; templates: FavoriteTemplates;
  projectTemplates: { get(id: string): ProjectTemplate | undefined; values(): ProjectTemplate[] };
  snapshot(): { devices: DeviceInfo[]; status: ReadonlyMap<DeviceKind, ProviderStatus> };
  loaded(): boolean;
  creation(): Omit<CreationContext, 'template' | 'boards'>;
  language: UiLanguage;
}

/** Everything the user has chosen. Contains no secrets; `parentDir` is machine local and the draft is never synced. */
export interface WizardState {
  templateId: string; section?: DeviceSection; query: string;
  device?: DeviceRef & { name: string };
  framework: string; options: CreationOptions; name: string; parentDir: string;
  /** Set after "restore from favorite", for the notice. */
  restoredFrom?: string;
}

/** Drops keys whose value is undefined, so a state compares and serializes the same before and after a round trip. */
function prune(state: WizardState): WizardState { return Object.fromEntries(Object.entries(state).filter(([, v]) => v !== undefined)) as unknown as WizardState; }

export const emptyState = (templateId = 'platformio.board'): WizardState => ({ templateId, query: '', framework: '', options: {}, name: '', parentDir: '' });

/** Validates a stored or received draft. Unknown fields are dropped; paths are only accepted where a path belongs. */
export function sanitizeState(raw: unknown, known: (id: string) => boolean): WizardState {
  const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const templateId = typeof r.templateId === 'string' && known(r.templateId) ? r.templateId : 'platformio.board';
  const device = r.device ? normalizeRef(r.device) : undefined;
  const text = (v: unknown, max: number) => typeof v === 'string' && !/[\0\r\n]/.test(v) ? v.slice(0, max) : '';
  return {
    templateId, query: text(r.query, 100),
    ...((deviceSections as readonly unknown[]).includes(r.section) ? { section: r.section as DeviceSection } : {}),
    ...(device ? { device: { ...device, name: cleanName((r.device as { name?: unknown }).name, device.id) } } : {}),
    framework: /^[A-Za-z0-9][A-Za-z0-9_.+-]{0,63}$/.test(text(r.framework, 64)) ? text(r.framework, 64) : '',
    options: sanitizeOptions(r.options).options, name: text(r.name, 64), parentDir: text(r.parentDir, 1024)
  };
}

export type WizardMessage =
  | { type: 'ready' | 'browse' | 'create' | 'reload' | 'clearRecents' | 'toggleTemplateFavorite' | 'cancel' | 'locateTools' }
  | { type: 'selectTemplate' | 'applyFavorite' | 'removeFavoriteTemplate'; id: string }
  | { type: 'section'; id: DeviceSection } | { type: 'search' | 'framework' | 'name'; value: string }
  | { type: 'option'; key: string; value: string | boolean }
  | { type: 'toggleFavorite' | 'selectDevice'; ref: DeviceRef; name: string }
  | { type: 'addManual'; kind: 'stm32-mcu' | 'stm32-board'; text: string };

/** The webview is untrusted input: every message is shape-checked before it can change state. */
export function parseMessage(raw: unknown): WizardMessage | undefined {
  if (!raw || typeof raw !== 'object') { return undefined; }
  const m = raw as Record<string, unknown>; const str = (v: unknown, max = 200) => typeof v === 'string' && v.length <= max && !/[\0\r\n]/.test(v) ? v : undefined;
  switch (m.type) {
    case 'ready': case 'browse': case 'create': case 'reload': case 'clearRecents': case 'toggleTemplateFavorite': case 'cancel': case 'locateTools': return { type: m.type };
    case 'selectTemplate': case 'applyFavorite': case 'removeFavoriteTemplate': { const id = str(m.id, 80); return id ? { type: m.type, id } : undefined; }
    case 'section': return (deviceSections as readonly unknown[]).includes(m.id) ? { type: 'section', id: m.id as DeviceSection } : undefined;
    case 'search': case 'framework': case 'name': { const value = str(m.value, m.type === 'search' ? 100 : 64); return value !== undefined ? { type: m.type, value } : undefined; }
    case 'option': { const key = str(m.key, 40); return key && (typeof m.value === 'boolean' || str(m.value, 20) !== undefined) ? { type: 'option', key, value: m.value as string | boolean } : undefined; }
    case 'toggleFavorite': case 'selectDevice': { const ref = normalizeRef(m.ref); return ref ? { type: m.type, ref, name: cleanName(m.name, ref.id) } : undefined; }
    case 'addManual': return (m.kind === 'stm32-mcu' || m.kind === 'stm32-board') && str(m.text, 60) ? { type: 'addManual', kind: m.kind, text: m.text as string } : undefined;
    default: return undefined;
  }
}

export interface WizardView {
  language: UiLanguage; labels: Record<string, string>;
  needsDevice: boolean; projectFiles: string[]; description: string;
  templates: { id: string; label: string; description: string; icon: string; selected: boolean; category: 'general' | 'embedded' }[];
  favoriteTemplates: { id: string; name: string; problems: { text: string; fix: string }[] }[];
  sections: { id: DeviceSection; label: string; icon: string; count: number; selected: boolean }[];
  query: string; loading: boolean; listMessage: string;
  rows: { kind: DeviceKind; id: string; name: string; subtitle: string; favorite: boolean; selected: boolean; badge?: string; badgeKind?: 'warn' | 'ok' }[];
  device?: { kind: DeviceKind; id: string; name: string; subtitle: string };
  needsFramework: boolean; frameworks: string[]; framework: string;
  options: CreationOptions; generator: string[];
  tools: { label: string; found: boolean; path?: string }[];
  name: string; parentDir: string; steps: { label: string; done: boolean }[];
  blockers: string[]; warnings: string[]; preview: string[]; canCreate: boolean;
  templateFavorite: { saved: boolean; can: boolean }; notice?: string; manualKind?: 'stm32-mcu' | 'stm32-board';
  hasRecents: boolean;
}

const sectionIcons: Record<DeviceSection, string> = { favorites: 'star-full', recent: 'history', 'pio-board': 'circuit-board', 'stm32-mcu': 'chip', 'stm32-board': 'server-environment', all: 'library' };
const sectionLabels: Record<DeviceSection, string> = { favorites: 'My favorites', recent: 'Recently used', 'pio-board': 'PlatformIO boards', 'stm32-mcu': 'STM32 MCUs', 'stm32-board': 'STM32 boards', all: 'All devices' };

export class WizardModel {
  state: WizardState;
  constructor(private readonly deps: WizardDeps, initial?: unknown) { this.state = sanitizeState(initial, id => !!deps.projectTemplates.get(id)); }

  private template(): ProjectTemplate | undefined { return this.deps.projectTemplates.get(this.state.templateId); }
  private boards(): Map<string, PioBoardInfo> { return new Map(this.deps.snapshot().devices.filter((d): d is PioBoardInfo => d.kind === 'pio-board').map(d => [d.id, d])); }

  selectTemplate(id: string): void {
    const template = this.deps.projectTemplates.get(id); if (!template) { return; }
    this.state = prune({ ...this.state, templateId: id, section: undefined, query: '', restoredFrom: undefined, framework: '', options: {} });
    if (this.state.device && !template.deviceKinds.includes(this.state.device.kind)) { this.state = prune({ ...this.state, device: undefined }); }
  }
  setSection(section: DeviceSection): void { this.state = { ...this.state, section }; }
  setQuery(query: string): void { this.state = { ...this.state, query }; }
  setFramework(framework: string): void { this.state = { ...this.state, framework }; }
  setName(name: string): void { this.state = { ...this.state, name }; }
  setParentDir(parentDir: string): void { this.state = { ...this.state, parentDir }; }
  setOption(key: string, value: string | boolean): void { this.state = { ...this.state, options: sanitizeOptions({ ...this.state.options, [key]: value }).options }; }

  /** Selecting also fills the framework when only one is possible or one was chosen last time (`remembered`). */
  selectDevice(ref: DeviceRef, name: string, remembered?: string): void {
    const frameworks = ref.kind === 'pio-board' ? this.boards().get(ref.id)?.frameworks ?? [] : [];
    const framework = frameworks.length === 1 ? frameworks[0] : remembered && frameworks.includes(remembered) ? remembered : '';
    this.state = prune({ ...this.state, device: { ...ref, name }, framework, restoredFrom: undefined });
  }

  /** Star click: saved immediately by `DeviceFavorites`; no apply step. */
  toggleFavorite(ref: DeviceRef, name: string): Promise<boolean> { return this.deps.favorites.toggle({ ...ref, name }); }

  /** Adds a typed STM32 name. It is validated, starred (so it persists) and selected. */
  async addManual(kind: 'stm32-mcu' | 'stm32-board', text: string): Promise<string | undefined> {
    const parsed = parseManualDevice(kind, text);
    if (!parsed.device) { return parsed.error; }
    await this.deps.favorites.add(parsed.device);
    this.selectDevice(parsed.device, parsed.device.name);
    return undefined;
  }

  private templateInput() {
    const s = this.state;
    return { templateId: s.templateId, ...(s.device ? { device: { kind: s.device.kind, id: s.device.id, name: s.device.name } } : {}), framework: s.framework || undefined, options: s.options };
  }

  async toggleTemplateFavorite(): Promise<boolean> { return this.deps.templates.toggle(this.templateInput()); }

  /** Picks a favorite template. Returns the problems that stop it from being used as is; the choices are restored regardless. */
  applyFavorite(id: string): RestoreProblem[] {
    const favorite = this.deps.templates.list().find(f => f.id === id); if (!favorite) { return []; }
    const status = this.deps.snapshot().status.get('pio-board');
    const restored = restoreFavoriteTemplate(favorite, { templates: this.deps.projectTemplates, boards: this.boards(), boardsAvailable: status?.state !== 'unavailable' });
    if (this.deps.projectTemplates.get(restored.templateId)) { this.state = prune({ ...this.state, templateId: restored.templateId, section: undefined, query: '', device: favorite.device, framework: restored.framework ?? '', options: restored.options, restoredFrom: favorite.name }); }
    return restored.problems;
  }

  /** Called once a project was created: only now does the device count as "recently used". */
  async recordSuccess(): Promise<void> { if (this.state.device) { await this.deps.recents.record({ ...this.state.device }); } }

  /** The plan for the current choices. Pure: nothing is created or run. */
  plan(): Promise<CreationPlan> {
    const s = this.state;
    return planCreation({ templateId: s.templateId, device: s.device, framework: s.framework || undefined, name: s.name, parentDir: s.parentDir, options: s.options }, { ...this.deps.creation(), template: this.template(), boards: this.boards() });
  }

  async view(): Promise<WizardView> {
    const language = this.deps.language; const t = (m: string, ...a: unknown[]) => wizardText(language, m, ...a);
    const s = this.state; const template = this.template(); const snapshot = this.deps.snapshot();
    const favorites = this.deps.favorites.list(); const recents = this.deps.recents.list();
    const kinds = template?.deviceKinds ?? [];
    const accepts = (d: DeviceRef) => kinds.includes(d.kind);
    const section = s.section ?? defaultSection(favorites.filter(accepts), recents.filter(accepts));
    const visibleSections = deviceSections.filter(id => id === 'favorites' || id === 'recent' || id === 'all' || kinds.includes(id as DeviceKind));
    const common = { devices: snapshot.devices.filter(accepts), status: snapshot.status, favorites: favorites.filter(accepts), recents: recents.filter(accepts) };
    const rows = kinds.length ? buildDeviceList({ ...common, section: visibleSections.includes(section) ? section : 'all', query: s.query }) : [];
    const count = (id: DeviceSection) => buildDeviceList({ ...common, section: id, limit: 100000 }).length;
    const selectedKey = s.device ? deviceKey(s.device) : '';
    const subtitle = (d: DeviceInfo) => [d.vendor, d.mcu, d.platform ?? d.family].filter(Boolean).join(' · ');
    const boards = this.boards(); const board = s.device?.kind === 'pio-board' ? boards.get(s.device.id) : undefined;
    const ctx = this.deps.creation();
    const plan = await this.plan();
    // A pristine form does not complain about the name and location the user has not reached yet.
    const pristine = !s.name && !s.parentDir;
    const shown = plan.blockers.filter(b => !(pristine && (b.code === 'name' || b.code === 'parent')));
    const nameProblem = s.name ? validateProjectName(s.name) : undefined;
    const listMessage = !this.deps.loaded() ? t('Loading devices...') : rows.length ? '' : s.query ? t('No matching devices') : section === 'favorites' ? t('No favorites yet. Click the star next to a device.') : section === 'recent' ? t('No recent devices. Devices are recorded after a project is created.') : t('No matching devices');
    const hasDevice = !!s.device; const hasFramework = !template?.needsFramework || !!s.framework;
    const view: WizardView = {
      needsDevice: kinds.length > 0, projectFiles: template?.backend === 'general' ? plan.preview.slice(2) : [], description: t(template?.description ?? ''),
      language, labels: Object.fromEntries(wizardLabelKeys.map(k => [k, t(k)])),
      templates: this.deps.projectTemplates.values().map(p => ({ id: p.id, label: t(p.label), description: t(p.description), icon: p.icon, selected: p.id === s.templateId, category: p.backend === 'general' ? 'general' as const : 'embedded' as const })),
      favoriteTemplates: this.deps.templates.list().map(f => {
        const restored = restoreFavoriteTemplate(f, { templates: this.deps.projectTemplates, boards, boardsAvailable: snapshot.status.get('pio-board')?.state !== 'unavailable' });
        return { id: f.id, name: f.name, problems: restored.problems.map(p => ({ text: t(`problem.${p.code}`), fix: t(`fix.${p.code}`) })) };
      }),
      sections: (kinds.length ? visibleSections : []).map(id => ({ id, label: t(sectionLabels[id]), icon: sectionIcons[id], count: count(id), selected: id === (visibleSections.includes(section) ? section : 'all') })),
      query: s.query, loading: !this.deps.loaded(), listMessage,
      rows: rows.map(r => ({
        kind: r.device.kind, id: r.device.id, name: r.device.name, subtitle: subtitle(r.device), favorite: r.favorite, selected: deviceKey(r.device) === selectedKey,
        ...(r.availability.state === 'toolchain-missing' ? { badge: t('Toolchain not installed'), badgeKind: 'warn' as const } : r.availability.state === 'not-in-catalog' && r.device.kind === 'pio-board' ? { badge: t('Not in the current board list'), badgeKind: 'warn' as const }
          : (r.device as PioBoardInfo).installed === false ? { badge: t('Platform not installed yet') } : (r.device as PioBoardInfo).installed === true ? { badge: t('Installed'), badgeKind: 'ok' as const } : {})
      })),
      ...(s.device ? { device: { kind: s.device.kind, id: s.device.id, name: s.device.name, subtitle: [board?.vendor, board?.mcu, board?.platform].filter(Boolean).join(' · ') } } : {}),
      needsFramework: !!template?.needsFramework, frameworks: board?.frameworks ?? [], framework: s.framework,
      options: s.options, generator: template?.buildSystem === 'cubemx' ? ['cmake', 'makefile', 'cubeide'] : [],
      tools: [
        ...(template?.language ? [{ label: projectLanguages.find(p => p.language === template.language)?.sdk ?? template.language, found: !!ctx.tools.runtimes?.[runtimeForProject(template.language)], path: ctx.tools.runtimes?.[runtimeForProject(template.language)] }] : []),
        ...(template?.backend === 'platformio' ? [{ label: t('PlatformIO Core'), found: !!ctx.tools.pio, ...(ctx.tools.pio ? { path: ctx.tools.pio } : {}) }] : []),
        ...(template?.backend === 'stm32' ? [{ label: t('STM32CubeMX'), found: !!ctx.tools.cubemx, ...(ctx.tools.cubemx ? { path: ctx.tools.cubemx } : {}) }] : [])
      ],
      name: s.name, parentDir: s.parentDir,
      steps: [
        { label: t('Project type'), done: !!template }, ...(kinds.length ? [{ label: t('Choose a device'), done: hasDevice }] : []), { label: t('Framework and build system'), done: hasFramework },
        { label: t('Check the SDK and toolchain'), done: template?.language ? !!ctx.tools.runtimes?.[runtimeForProject(template.language)] : template?.backend === 'platformio' ? !!ctx.tools.pio : true },
        { label: t('Name and location'), done: !!s.name && !nameProblem && !!s.parentDir }, { label: t('Preview and create'), done: !plan.blockers.length && !!s.name && !!s.parentDir }
      ],
      blockers: shown.map(b => t(`blocker.${b.code}`)),
      warnings: plan.warnings.map(w => t(`warning.${w.code}`)), preview: plan.preview,
      canCreate: !plan.blockers.length && plan.steps.length > 0 && (template?.buildSystem === 'existing' || (!!s.name && !!s.parentDir)),
      templateFavorite: { saved: this.deps.templates.isFavorite(this.templateInput()), can: template?.backend === 'general' || (!!s.device && hasFramework) },
      ...(s.restoredFrom ? { notice: t('Restored from "{0}".', s.restoredFrom) } : {}),
      ...(template?.deviceKinds.includes('stm32-mcu') ? { manualKind: 'stm32-mcu' as const } : {}),
      hasRecents: recents.length > 0
    };
    return view;
  }
}
