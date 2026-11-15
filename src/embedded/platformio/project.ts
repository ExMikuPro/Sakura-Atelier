import * as path from 'node:path';
import type { BackendHost, BackendProject, ProjectBackend } from '../../adapterTypes';
import { PlatformioIni, defaultEnvironments, environmentNames, environmentOption, parsePlatformioIni } from './ini';

export type PlatformFamily = 'stm32' | 'native' | 'other';
export interface PlatformioEnvironment { name: string; platform: string; board: string; framework: string; family: PlatformFamily; options?: Record<string,string> }
export interface PlatformioProject { srcDir?: string; resolved?: boolean; root: string; ini: string; environments: PlatformioEnvironment[]; defaultEnvironments: string[] }

/** `ststm32`, `ststm32@^17`, or the platform's repository URL. */
export function platformFamily(platform: string): PlatformFamily {
  const value = platform.trim().toLowerCase();
  if (!value) { return 'other'; }
  if (value === 'native' || value.startsWith('native@') || /(?:^|\/)platform(?:io)?-?native(?:[.@#]|$)/.test(value) || value.startsWith('platformio/native')) { return 'native'; }
  if (/(^|[/])(platform-)?ststm32([@.#]|$)/.test(value) || value === 'ststm32') { return 'stm32'; }
  return 'other';
}

export function describeEnvironments(ini: PlatformioIni): PlatformioEnvironment[] {
  return environmentNames(ini).map(name => {
    const platform = environmentOption(ini, name, 'platform') ?? '';
    return { name, platform, board: environmentOption(ini, name, 'board') ?? '', framework: environmentOption(ini, name, 'framework') ?? '', family: platformFamily(platform), options: Object.fromEntries(['upload_protocol','upload_port','monitor_port','monitor_speed','monitor_filters','debug_tool','build_type','targets'].map(key=>[key, environmentOption(ini,name,key) ?? ''])) };
  });
}

export async function readPlatformioProject(root: string, host: BackendHost): Promise<PlatformioProject | undefined> {
  if (!(await host.readDir(root)).includes('platformio.ini')) { return undefined; }
  const text = await host.readText(path.join(root, 'platformio.ini'));
  if (text === undefined) { return undefined; }
  const ini = parsePlatformioIni(text);
  return { root, ini: 'platformio.ini', environments: describeEnvironments(ini), defaultEnvironments: defaultEnvironments(ini) };
}

/** Detection only reads platformio.ini. It never runs `pio`. */
export const platformioBackend: ProjectBackend = {
  id: 'platformio', label: 'PlatformIO',
  async detect(root, host): Promise<BackendProject | undefined> {
    const project = await readPlatformioProject(root, host);
    if (!project) { return undefined; }
    return {
      backend: 'platformio', root, marker: project.ini, buildSystem: 'platformio', languages: ['c', 'cpp'], runTargets: ['device'],
      details: {
        environments: project.environments.map(e => e.name).join(','),
        defaultEnvironments: project.defaultEnvironments.join(','),
        families: [...new Set(project.environments.map(e => e.family))].join(',')
      }
    };
  }
};

/** Nearest PlatformIO build entry wins over generated CMake/IOC files. Metadata only. */
export async function nearestPlatformioRoot(file: string, workspace: string, host: BackendHost): Promise<string | undefined> {
  for (let dir=path.dirname(file);;dir=path.dirname(dir)) {
    const relative=path.relative(workspace,dir);
    if (relative === '..' || relative.startsWith('..'+path.sep) || path.isAbsolute(relative)) return undefined;
    if ((await host.readDir(dir)).includes('platformio.ini')) return dir;
    if (dir === workspace || path.dirname(dir) === dir) return undefined;
  }
}
