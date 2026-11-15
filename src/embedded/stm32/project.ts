import * as path from 'node:path';
import type { BackendHost, BackendProject, ProjectBackend } from '../../adapterTypes';
import { IocInfo, parseIoc } from './ioc';

export type Stm32BuildSystem = 'cmake' | 'make' | 'cubemx';
export interface Stm32Project {
  root: string; buildSystem: Stm32BuildSystem;
  ioc?: { file: string; info: IocInfo };
  /** CMake project name, which CubeMX uses as the ELF name. */
  projectName: string;
  presets: string[];
  existingBuildDirectories?: Record<string,string>;
  presetDirectories?: Record<string, string>;
  presetBuildTypes?: Record<string, string>;
  toolchainFile?: string;
  marker: string;
}

/** `project(name)`, or `project(${VAR})` resolved through `set(VAR name)`, which is how CubeMX writes it. */
function cmakeProjectName(text: string): string {
  const name = text.match(/^\s*project\s*\(\s*([^\s)]+)/im)?.[1] ?? '';
  const variable = name.match(/^\$\{([A-Za-z0-9_]+)\}$/)?.[1];
  if (!variable) { return name; }
  return text.match(new RegExp(`^\\s*set\\s*\\(\\s*${variable}\\s+([^\\s)]+)`, 'im'))?.[1] ?? '';
}

/** Parses CMakePresets.json leniently; configure preset names only. */
export function presetNames(json: string | undefined): string[] {
  if (!json) { return []; }
  try {
    const data = JSON.parse(json) as { configurePresets?: { name?: unknown; hidden?: unknown }[] };
    return (data.configurePresets ?? []).filter(p => typeof p.name === 'string' && !p.hidden).map(p => p.name as string);
  } catch { return []; }
}

const armHint = /arm-none-eabi|stm32cubemx|STM32|CMAKE_SYSTEM_PROCESSOR\s+arm/i;

export async function readStm32Project(root: string, host: BackendHost): Promise<Stm32Project | undefined> {
  const entries = await host.readDir(root);
  // PlatformIO owns any directory with platformio.ini, STM32 or not.
  if (entries.includes('platformio.ini')) { return undefined; }
  const iocName = entries.filter(e => /\.ioc$/i.test(e)).sort()[0];
  const ioc = iocName ? { file: path.join(root, iocName), info: parseIoc(await host.readText(path.join(root, iocName)) ?? '') } : undefined;
  if (!ioc && path.basename(root)==='stm32cubemx' && path.basename(path.dirname(root))==='cmake') return undefined;
  const cmakeText = entries.includes('CMakeLists.txt') ? await host.readText(path.join(root, 'CMakeLists.txt')) : undefined;
  const cmakeDir = entries.includes('cmake') ? await host.readDir(path.join(root, 'cmake')) : [];
  const toolchainName = cmakeDir.find(e => /(?:arm-none-eabi|gcc.*arm|arm.*gcc).*\.cmake$/i.test(e));
  const rootToolchain = entries.find(e=>/(?:arm-none-eabi|gcc.*arm|arm.*gcc).*\.cmake$/i.test(e));
  const isStmCmake = cmakeText !== undefined && (!!ioc || !!toolchainName || !!rootToolchain || cmakeDir.includes('stm32cubemx') || armHint.test(cmakeText));
  const presetData = await readPresetData(root, host);
  const presets = Object.keys(presetData.directories);
  const existingBuildDirectories: Record<string,string> = {};
  for (const relative of ['build/Debug','build/Release','Debug','Release','build']) {
    const directory=path.join(root,relative); const cache=await host.readText(path.join(directory,'CMakeCache.txt'));
    if (!cache) continue;
    const source=cache.match(/^CMAKE_HOME_DIRECTORY:INTERNAL=(.+)$/m)?.[1].trim();
    if (source && path.resolve(source) !== path.resolve(root)) continue;
    const type=cache.match(/^CMAKE_BUILD_TYPE:STRING=(.+)$/m)?.[1].trim();
    if(type) existingBuildDirectories[type]=directory;
  }
  if (isStmCmake) {
    return { root, buildSystem: 'cmake', ioc, projectName: cmakeProjectName(cmakeText!) || ioc?.info.projectName || '', presets, existingBuildDirectories, presetDirectories: presetData.directories, presetBuildTypes: presetData.types, toolchainFile: toolchainName ? path.join(root, 'cmake', toolchainName) : rootToolchain ? path.join(root,rootToolchain) : undefined, marker: 'CMakeLists.txt' };
  }
  if (ioc) { return { root, buildSystem: entries.includes('Makefile') ? 'make' : 'cubemx', ioc, projectName: ioc.info.projectName, presets: [], marker: path.basename(ioc.file) }; }
  return undefined;
}

/** Detection only reads files. It never starts STM32CubeMX or any other tool. */
export const stm32Backend: ProjectBackend = {
  id: 'stm32', label: 'STM32',
  async detect(root, host): Promise<BackendProject | undefined> {
    const project = await readStm32Project(root, host);
    if (!project) { return undefined; }
    return {
      backend: 'stm32', root, marker: project.marker, buildSystem: project.buildSystem === 'cubemx' ? 'cubemx' : project.buildSystem, languages: ['c', 'cpp'], runTargets: ['device'],
      details: { mcu: project.ioc?.info.mcu ?? '', board: project.ioc?.info.board ?? '', cubemx: project.ioc ? 'true' : 'false', project: project.projectName, presets: project.presets.join(',') }
    };
  }
};

/** Resolve include/inheritance and binaryDir without overriding the project's preset. */
async function readPresetData(root: string, host: BackendHost): Promise<{ directories: Record<string,string>; types: Record<string,string> }> {
  type Preset = { name: string; hidden?: boolean; inherits?: string | string[]; binaryDir?: string; environment?: Record<string,string|null>; cacheVariables?: Record<string,unknown> };
  const presets = new Map<string, Preset>(); const seen = new Set<string>();
  async function read(file: string): Promise<void> {
    if (seen.has(file) || seen.size > 32) return;
    seen.add(file);
    try {
      const data = JSON.parse(await host.readText(file) ?? '{}') as { include?: string[]; configurePresets?: Preset[] };
      for (const include of data.include ?? []) await read(path.resolve(path.dirname(file), include.replaceAll('${sourceDir}', root)));
      for (const preset of data.configurePresets ?? []) presets.set(preset.name, { ...preset, ...(preset.binaryDir ? {binaryDir:preset.binaryDir.replaceAll('${fileDir}',path.dirname(file))} : {}) });
    } catch { /* malformed files are left to CMake diagnostics */ }
  }
  await read(path.join(root, 'CMakePresets.json'));
  function resolve(name: string, chain = new Set<string>()): Preset | undefined {
    if (chain.has(name)) return undefined;
    chain.add(name); const preset = presets.get(name); if (!preset) return undefined;
    const parents = typeof preset.inherits === 'string' ? [preset.inherits] : preset.inherits ?? [];
    let base: Partial<Preset> = {};
    for (const parent of [...parents].reverse()) { const p = resolve(parent, new Set(chain)); if (p) base = { ...base, ...p, environment:{...base.environment,...p.environment}, cacheVariables: { ...base.cacheVariables, ...p.cacheVariables } }; }
    return { ...base, ...preset, environment:{...base.environment,...preset.environment}, cacheVariables: { ...base.cacheVariables, ...preset.cacheVariables } };
  }
  const directories: Record<string,string> = {}; const types: Record<string,string> = {};
  for (const [name, preset] of presets) {
    if (preset.hidden) continue;
    const resolved = resolve(name); if (!resolved) continue;
    let dir = (resolved.binaryDir ?? '${sourceDir}').replaceAll('${sourceDir}', root).replaceAll('${sourceParentDir}', path.dirname(root)).replaceAll('${sourceDirName}', path.basename(root)).replaceAll('${presetName}', name);
    for(let i=0;i<8;i++) { const expanded=dir.replace(/\$(p?env)\{([^}]+)\}/g,(_all,kind:string,key:string)=>kind==='penv' ? process.env[key] ?? '' : resolved.environment?.[key] ?? process.env[key] ?? '');if(expanded===dir)break;dir=expanded; }
    directories[name] = path.resolve(root, dir);
    const type = resolved.cacheVariables?.CMAKE_BUILD_TYPE;
    types[name] = typeof type === 'string' ? type : typeof type === 'object' && type ? String((type as {value?: unknown}).value ?? '') : '';
  }
  return { directories, types };
}
