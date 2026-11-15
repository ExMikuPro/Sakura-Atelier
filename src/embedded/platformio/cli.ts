import type { Runner } from '../process';
import { PlatformioIni } from './ini';

/** PlatformIO prints a promotional banner after JSON on some versions. Take the first line that parses. */
export function parseJsonOutput(output: string): unknown {
  const lines = output.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) { try { return JSON.parse(trimmed); } catch { /* keep looking */ } }
  }
  return JSON.parse(output);
}

/** `pio project config --json-output` returns [[section, [[key, value | value[]], ...]], ...]. Resolves extends and interpolation. Installs nothing. */
export function configFromJson(value: unknown): PlatformioIni {
  const sections = new Map<string, { name: string; options: Map<string, string> }>();
  if (!Array.isArray(value)) { throw new Error('Unexpected `pio project config` output.'); }
  for (const entry of value) {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !Array.isArray(entry[1])) { continue; }
    const options = new Map<string, string>();
    for (const pair of entry[1]) {
      if (!Array.isArray(pair) || typeof pair[0] !== 'string') { continue; }
      options.set(pair[0], Array.isArray(pair[1]) ? pair[1].map(String).join('\n') : String(pair[1] ?? ''));
    }
    sections.set(entry[0], { name: entry[0], options });
  }
  return { sections };
}

export async function readConfig(run: Runner, pio: string, root: string): Promise<PlatformioIni> {
  return configFromJson(parseJsonOutput(await run(pio, ['project', 'config', '-d', root, '--json-output'], root)));
}

export interface EnvironmentMetadata { progPath: string; gdbPath: string; compilerPath: string; svdPath?: string }

/**
 * `pio project metadata` evaluates the build script, which makes PlatformIO install the environment's platform and packages if they are missing.
 * Callers must ask the user first; discovery and detection never call this.
 */
export async function readMetadata(run: Runner, pio: string, root: string, env: string): Promise<EnvironmentMetadata | undefined> {
  const data = parseJsonOutput(await run(pio, ['project', 'metadata', '-d', root, '-e', env, '--json-output'], root, 15 * 60 * 1000));
  const entry = (data as Record<string, Record<string, unknown>> | undefined)?.[env];
  if (!entry || typeof entry !== 'object') { return undefined; }
  const text = (key: string) => typeof entry[key] === 'string' ? entry[key] as string : '';
  return { progPath: text('prog_path'), gdbPath: text('gdb_path'), compilerPath: text('cc_path'), ...(text('svd_path') ? { svdPath: text('svd_path') } : {}) };
}

export interface SerialPort { port: string; description: string }
export async function listPorts(run: Runner, pio: string, cwd: string): Promise<SerialPort[]> {
  const data = parseJsonOutput(await run(pio, ['device', 'list', '--json-output'], cwd));
  return Array.isArray(data) ? data.filter(d => d && typeof d.port === 'string').map(d => ({ port: d.port as string, description: String(d.description ?? '') })) : [];
}

export interface BoardDebugCapabilities { tools: string[]; defaultTool?: string; onboard: string[] }
/** Installed board manifests describe probe support; this query never installs a platform. */
export async function readBoardDebug(run: Runner, pio: string, root: string, board: string): Promise<BoardDebugCapabilities | undefined> {
  const data=parseJsonOutput(await run(pio,['boards','--installed','--json-output',board],root));
  if (!Array.isArray(data)) return undefined;
  const matches=data.filter(item=>item?.id===board);
  if (matches.length!==1) return undefined;
  const tools=matches[0].debug?.tools;
  if (!tools || typeof tools!=='object') return {tools:[],onboard:[]};
  const entries=Object.entries(tools) as [string,{default?:boolean;onboard?:boolean}][];
  return {tools:entries.map(([name])=>name),defaultTool:entries.find(([,info])=>info.default)?.[0],onboard:entries.filter(([,info])=>info.onboard).map(([name])=>name)};
}
