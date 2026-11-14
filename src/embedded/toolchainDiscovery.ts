import type { DiscoveryHost } from './discoveryHost';
import { pathApi } from './discoveryHost';

export const embeddedToolIds = ['platformio', 'stm32cubemx', 'stm32cubecli', 'stm32cubeclt', 'arm-gcc', 'arm-gdb', 'cmake', 'ninja', 'stm32programmer', 'stlink-gdbserver'] as const;
export type EmbeddedToolId = typeof embeddedToolIds[number];
/** `manual` entries come from the user's registry. `hint` entries come from scanning common locations and are only accepted after their layout is validated. */
export type ToolSource = 'manual' | 'env' | 'path' | 'cubeclt' | 'sibling' | 'hint';
export interface DiscoveredTool { id: EmbeddedToolId; path: string; source: ToolSource; version?: string }
export interface ToolStatus { id: EmbeddedToolId; label: string; selected?: DiscoveredTool; candidates: DiscoveredTool[]; staleManual?: string }
export type ManualPaths = Partial<Record<EmbeddedToolId, string>>;

interface ToolSpec {
  label: string;
  /** Executable base names (no extension). For `cubeclt` this is empty: it is a directory. */
  names: (platform: NodeJS.Platform) => string[];
  /** Arguments for a safe version query, or undefined when the tool must not be executed (GUI applications, ST tools). */
  versionArgs?: string[];
  /** Directories that may contain the executable. Only trusted after the executable is found there. */
  hints: (host: DiscoveryHost) => Promise<string[]>;
}

/** CubeCLT bundles each tool in its own folder; these are the sub-folders whose `bin` holds that tool. */
const cltLayout: Partial<Record<EmbeddedToolId, string[]>> = {
  'arm-gcc': ['GNU-tools-for-STM32/bin'], 'arm-gdb': ['GNU-tools-for-STM32/bin'],
  cmake: ['CMake/bin'], ninja: ['Ninja/bin'],
  stm32programmer: ['STM32CubeProgrammer/bin'], 'stlink-gdbserver': ['STLink-gdb-server/bin']
};

function exe(host: DiscoveryHost, name: string): string { return host.platform === 'win32' ? `${name}.exe` : name; }
async function children(host: DiscoveryHost, root: string, pattern: RegExp): Promise<string[]> {
  const p = pathApi(host.platform);
  return (await host.readDir(root)).filter(name => pattern.test(name)).sort().reverse().map(name => p.join(root, name));
}

const specs: Record<EmbeddedToolId, ToolSpec> = {
  platformio: {
    label: 'PlatformIO Core', names: () => ['pio', 'platformio'], versionArgs: ['--version'],
    async hints(host) {
      const p = pathApi(host.platform);
      const core = host.env.PLATFORMIO_CORE_DIR || p.join(host.home, '.platformio');
      return [p.join(core, 'penv', host.platform === 'win32' ? 'Scripts' : 'bin')];
    }
  },
  stm32cubemx: {
    label: 'STM32CubeMX', names: () => ['STM32CubeMX'],
    async hints(host) {
      const p = pathApi(host.platform);
      if (host.platform === 'darwin') { return ['/Applications/STM32CubeMX.app/Contents/MacOS', p.join(host.home, 'Applications/STM32CubeMX.app/Contents/MacOS')]; }
      if (host.platform === 'win32') {
        const roots = [host.env.ProgramFiles, host.env['ProgramFiles(x86)'], host.env.ProgramW6432].filter((r): r is string => !!r);
        return roots.map(r => p.join(r, 'STMicroelectronics', 'STM32Cube', 'STM32CubeMX'));
      }
      return [p.join(host.home, 'STM32CubeMX'), '/usr/local/STMicroelectronics/STM32Cube/STM32CubeMX'];
    }
  },
  stm32cubecli: { label: 'STM32Cube CLI', names: () => ['cube'], hints: async () => [] },
  stm32cubeclt: {
    label: 'STM32CubeCLT', names: () => [],
    async hints(host) {
      const p = pathApi(host.platform);
      const containers = host.platform === 'win32' ? ['C:\\ST', ...[host.env.ProgramFiles].filter((r): r is string => !!r).map(r => p.join(r, 'STMicroelectronics'))] : ['/opt/st', '/opt/ST', p.join(host.home, 'st')];
      const found: string[] = [];
      for (const container of containers) {
        for (const candidate of await children(host, container, /^stm32cubeclt/i)) {
          found.push(candidate);
          // Some installers nest the tools one level deeper (STM32CubeCLT/STM32CubeCLT_x.y.z).
          found.push(...await children(host, candidate, /^stm32cubeclt/i));
        }
      }
      return found;
    }
  },
  'arm-gcc': {
    label: 'Arm GNU Toolchain (arm-none-eabi-gcc)', names: () => ['arm-none-eabi-gcc'], versionArgs: ['--version'],
    async hints(host) {
      const p = pathApi(host.platform);
      const found: string[] = [];
      const roots = host.platform === 'win32' ? [host.env['ProgramFiles(x86)'], host.env.ProgramFiles].filter((r): r is string => !!r) : ['/opt', '/usr/local', p.join(host.home, 'opt')];
      for (const root of roots) {
        for (const dir of await children(host, root, /^(arm-gnu-toolchain|gcc-arm-none-eabi|Arm GNU Toolchain)/i)) {
          found.push(p.join(dir, 'bin'));
          for (const sub of await children(host, dir, /./)) { found.push(p.join(sub, 'bin')); }
        }
      }
      if (host.platform === 'darwin') {
        for (const version of await children(host, '/Applications/ArmGNUToolchain', /./)) { found.push(p.join(version, 'arm-none-eabi', 'bin')); }
      }
      // Bundle layout used by newer STM32Cube tooling.
      for (const bundle of await children(host, p.join(host.home, '.local/share/stm32cube/bundles/gnu-tools-for-stm32'), /./)) { found.push(p.join(bundle, 'bin')); }
      return found;
    }
  },
  'arm-gdb': { label: 'Arm GDB (arm-none-eabi-gdb)', names: () => ['arm-none-eabi-gdb', 'gdb-multiarch'], versionArgs: ['--version'], hints: async () => [] },
  cmake: { label: 'CMake', names: () => ['cmake'], versionArgs: ['--version'], hints: async () => [] },
  ninja: { label: 'Ninja', names: () => ['ninja'], versionArgs: ['--version'], hints: async () => [] },
  stm32programmer: { label: 'STM32CubeProgrammer CLI', names: () => ['STM32_Programmer_CLI'], hints: async () => [] },
  'stlink-gdbserver': { label: 'ST-LINK GDB server', names: () => ['ST-LINK_gdbserver'], hints: async () => [] }
};

export function toolLabel(id: EmbeddedToolId): string { return specs[id].label; }

/** Turns what a user picked in a file dialog into the executable to run: a macOS `.app` bundle, a tool folder, or the file itself. */
export async function normalizeManualPath(id: EmbeddedToolId, picked: string, host: DiscoveryHost): Promise<string | undefined> {
  const p = pathApi(host.platform);
  const kind = await host.stat(picked);
  if (!kind) { return undefined; }
  if (id === 'stm32cubeclt') { return kind === 'dir' && Object.keys(await cltComponents(picked, host)).length > 0 ? picked : undefined; }
  if (kind === 'file') { return picked; }
  if (id === 'stm32cubemx' && /\.app$/i.test(picked)) {
    for (const name of specs[id].names(host.platform)) { const inner = p.join(picked, 'Contents', 'MacOS', name); if (await host.stat(inner) === 'file') { return inner; } }
    return undefined;
  }
  for (const name of specs[id].names(host.platform)) {
    for (const folder of [picked, p.join(picked, 'bin')]) { const candidate = p.join(folder, exe(host, name)); if (await host.stat(candidate) === 'file') { return candidate; } }
  }
  return undefined;
}

/** Which bundled tools a CubeCLT folder actually contains. Missing components are simply absent. */
export async function cltComponents(root: string, host: DiscoveryHost): Promise<Partial<Record<EmbeddedToolId, string>>> {
  const p = pathApi(host.platform);
  const result: Partial<Record<EmbeddedToolId, string>> = {};
  for (const [id, folders] of Object.entries(cltLayout) as [EmbeddedToolId, string[]][]) {
    for (const folder of folders) {
      for (const name of specs[id].names(host.platform)) {
        const candidate = p.join(root, ...folder.split('/'), exe(host, name));
        if (await host.stat(candidate) === 'file') { result[id] = candidate; break; }
      }
      if (result[id]) { break; }
    }
  }
  return result;
}

async function onPath(name: string, host: DiscoveryHost): Promise<string[]> {
  const p = pathApi(host.platform);
  const raw = host.env.PATH ?? host.env.Path ?? '';
  const extensions = host.platform === 'win32' ? ['.exe'] : [''];
  const found: string[] = [];
  for (const dir of raw.split(p.delimiter).filter(Boolean)) {
    for (const ext of extensions) { const candidate = p.join(dir, name + ext); if (await host.stat(candidate) === 'file') { found.push(candidate); } }
  }
  return found;
}

/** Finds every tool. Order of trust: the user's manual path, PATH, tools bundled in a CubeCLT, siblings of the Arm compiler, then validated hint locations. */
export async function discoverEmbeddedTools(host: DiscoveryHost, manual: ManualPaths = {}): Promise<Record<EmbeddedToolId, ToolStatus>> {
  const p = pathApi(host.platform);
  const result = {} as Record<EmbeddedToolId, ToolStatus>;
  for (const id of embeddedToolIds) { result[id] = { id, label: specs[id].label, candidates: [] }; }
  const add = (id: EmbeddedToolId, file: string, source: ToolSource) => {
    const list = result[id].candidates;
    if (!list.some(t => t.path === file)) { list.push({ id, path: file, source }); }
  };

  // CubeCLT first: its components feed the other tools.
  const cltRoots: [string, ToolSource][] = [];
  if (manual.stm32cubeclt) {
    if (Object.keys(await cltComponents(manual.stm32cubeclt, host)).length) { cltRoots.push([manual.stm32cubeclt, 'manual']); } else { result.stm32cubeclt.staleManual = manual.stm32cubeclt; }
  }
  for (const hint of await specs.stm32cubeclt.hints(host)) { if (Object.keys(await cltComponents(hint, host)).length) { cltRoots.push([hint, 'hint']); } }
  for (const [root, source] of cltRoots) { add('stm32cubeclt', root, source); }

  for (const id of embeddedToolIds) {
    if (id === 'stm32cubeclt') { continue; }
    const spec = specs[id];
    const configured = manual[id];
    if (configured) {
      if (await host.stat(configured) === 'file') { add(id, configured, 'manual'); } else { result[id].staleManual = configured; }
    }
    for (const name of spec.names(host.platform)) { for (const file of await onPath(name, host)) { add(id, file, 'path'); } }
    for (const [root] of cltRoots) { const file = (await cltComponents(root, host))[id]; if (file) { add(id, file, 'cubeclt'); } }
    if (id === 'arm-gdb') {
      for (const gcc of result['arm-gcc'].candidates) {
        for (const name of spec.names(host.platform)) { const sibling = p.join(p.dirname(gcc.path), exe(host, name)); if (await host.stat(sibling) === 'file') { add(id, sibling, 'sibling'); } }
      }
    }
    for (const dir of await spec.hints(host)) {
      for (const name of spec.names(host.platform)) { const candidate = p.join(dir, exe(host, name)); if (await host.stat(candidate) === 'file') { add(id, candidate, 'hint'); } }
    }
  }
  // Version queries run only for tools that are safe to execute, and only for the selected candidate.
  for (const id of embeddedToolIds) {
    const status = result[id]; status.selected = status.candidates[0];
    const args = specs[id].versionArgs;
    if (status.selected && args) { status.selected.version = await host.version(status.selected.path, args); }
  }
  return result;
}
