import * as path from 'node:path';
import type { BackendHost, BackendProject, ProjectBackend } from '../../adapterTypes';
import { PlatformioIni, defaultEnvironments, environmentNames, environmentOption, parsePlatformioIni } from './ini';

export type PlatformFamily = 'stm32' | 'native' | 'other';
export interface PlatformioEnvironment { name: string; platform: string; board: string; framework: string; family: PlatformFamily }
export interface PlatformioProject { root: string; ini: string; environments: PlatformioEnvironment[]; defaultEnvironments: string[] }

/** `ststm32`, `ststm32@^17`, or the platform's repository URL. */
export function platformFamily(platform: string): PlatformFamily {
  const value = platform.trim().toLowerCase();
  if (!value) { return 'other'; }
  if (value === 'native' || value.startsWith('native@')) { return 'native'; }
  if (/(^|[/])(platform-)?ststm32([@.#]|$)/.test(value) || value === 'ststm32') { return 'stm32'; }
  return 'other';
}

export function describeEnvironments(ini: PlatformioIni): PlatformioEnvironment[] {
  return environmentNames(ini).map(name => {
    const platform = environmentOption(ini, name, 'platform') ?? '';
    return { name, platform, board: environmentOption(ini, name, 'board') ?? '', framework: environmentOption(ini, name, 'framework') ?? '', family: platformFamily(platform) };
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
