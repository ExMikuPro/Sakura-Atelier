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
  const cmakeText = entries.includes('CMakeLists.txt') ? await host.readText(path.join(root, 'CMakeLists.txt')) : undefined;
  const cmakeDir = entries.includes('cmake') ? await host.readDir(path.join(root, 'cmake')) : [];
  const toolchainName = cmakeDir.find(e => /arm-none-eabi.*\.cmake$/i.test(e));
  const isStmCmake = cmakeText !== undefined && (!!toolchainName || cmakeDir.includes('stm32cubemx') || armHint.test(cmakeText));
  const presets = presetNames(entries.includes('CMakePresets.json') ? await host.readText(path.join(root, 'CMakePresets.json')) : undefined);
  if (isStmCmake) {
    return { root, buildSystem: 'cmake', ioc, projectName: cmakeProjectName(cmakeText!) || ioc?.info.projectName || '', presets, toolchainFile: toolchainName ? path.join(root, 'cmake', toolchainName) : undefined, marker: 'CMakeLists.txt' };
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
