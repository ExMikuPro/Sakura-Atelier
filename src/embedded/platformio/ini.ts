/** Minimal reader for platformio.ini. The official CLI (`pio project config`) stays the source of truth; this is the offline fallback. */
export interface IniSection { name: string; options: Map<string, string> }
export interface PlatformioIni { sections: Map<string, IniSection> }

export function parsePlatformioIni(text: string): PlatformioIni {
  const sections = new Map<string, IniSection>();
  let current: IniSection | undefined; let lastKey: string | undefined;
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    if (/^\s*[;#]/.test(raw) || !raw.trim()) { continue; }
    const header = raw.match(/^\[([^\]]+)\]\s*$/);
    if (header) { current = sections.get(header[1]) ?? { name: header[1], options: new Map() }; sections.set(header[1], current); lastKey = undefined; continue; }
    if (!current) { continue; }
    if (/^\s/.test(raw) && lastKey) { current.options.set(lastKey, `${current.options.get(lastKey) ?? ''}\n${raw.trim()}`.replace(/^\n/, '')); continue; }
    const pair = raw.match(/^([^=:\s][^=:]*?)\s*[=:]\s*(.*)$/);
    if (pair) { lastKey = pair[1].trim(); current.options.set(lastKey, pair[2].trim()); }
  }
  return { sections };
}

export function listValue(value: string | undefined): string[] {
  return (value ?? '').split(/[\n,]/).map(v => v.trim()).filter(Boolean);
}

export function environmentNames(ini: PlatformioIni): string[] {
  return [...ini.sections.keys()].filter(name => name.startsWith('env:')).map(name => name.slice(4)).filter(Boolean);
}

export function defaultEnvironments(ini: PlatformioIni): string[] {
  const configured = listValue(ini.sections.get('platformio')?.options.get('default_envs'));
  const known = new Set(environmentNames(ini));
  return configured.filter(name => known.has(name));
}

/** Option lookup with `extends` (cycle-safe) and the shared `[env]` section. `${...}` interpolation is left to the official CLI. */
export function environmentOption(ini: PlatformioIni, env: string, key: string): string | undefined {
  const seen = new Set<string>();
  const visit = (section: string): string | undefined => {
    if (seen.has(section)) { return undefined; }
    seen.add(section);
    const entry = ini.sections.get(section);
    const own = entry?.options.get(key);
    if (own !== undefined) { return own; }
    for (const parent of listValue(entry?.options.get('extends'))) {
      const found = visit(ini.sections.has(parent) ? parent : `env:${parent}`);
      if (found !== undefined) { return found; }
    }
    return undefined;
  };
  return visit(`env:${env}`) ?? ini.sections.get('env')?.options.get(key);
}
