import * as path from 'node:path';
import { languages, Language, RunnerError, RunPlan } from './model';
export const runtimeLanguages = [...languages, 'node'] as const;
export type RuntimeLanguage = Language | 'node';
export type ConfigurationKind = 'file' | 'project' | 'module' | 'executable' | 'task' | 'launch';
export interface AtelierConfiguration {
  id: string; name: string; language: RuntimeLanguage; kind: ConfigurationKind;
  target: string; cwd: string; toolchain: string; args: string[]; buildArgs: string[];
  env: Record<string, string>; preLaunchTask: string; terminal: boolean; autoActivate: boolean;
  operation: 'run' | 'build' | 'test'; profile: 'debug' | 'release'; standard: string;
  sources: string[]; includePaths: string[]; libraryPaths: string[]; linkArgs: string[]; output: string;
  package: string; binary: string; example: string; features: string[]; rustToolchain: string; cargoTarget: string;
  packageManager: 'npm' | 'pnpm' | 'yarn'; script: string; typescriptRunner: 'tsx' | 'ts-node' | 'tsc';
  framework: string; launchProfile: string; goToolchain: string; debugName: string; debugType: string;
  classPath: string[]; modulePath: string[];
}
export interface ConfigurationFile { version: 1; default?: string; configurations: AtelierConfiguration[] }
export interface LocalToolchain { id: string; name: string; language: RuntimeLanguage; executable: string; version: string; manager: string; project: string; details?: string; rustToolchain?:string }
export interface PreparedRun { plan: RunPlan; debug?: Record<string, unknown> }
export type Selection = { kind: 'auto' | 'file' | 'project' | 'managed' | 'launch' | 'task' | 'test'; id?: string };
const scalar = ['id','name','target','cwd','toolchain','preLaunchTask','standard','output','package','binary','example','rustToolchain','cargoTarget','script','framework','launchProfile','goToolchain','debugName','debugType'] as const;
const arrays = ['args','buildArgs','sources','includePaths','libraryPaths','linkArgs','features','classPath','modulePath'] as const;
const fields = new Set<string>([...scalar, ...arrays, 'language','kind','env','terminal','autoActivate','operation','profile','packageManager','typescriptRunner']);
export function newConfiguration(language: RuntimeLanguage, name = `${language} application`): AtelierConfiguration {
  return { id: '', name, language, kind: 'file', target: '${file}', cwd: '${workspaceFolder}', toolchain: '', args: [], buildArgs: [], env: {}, preLaunchTask: '', terminal: true, autoActivate: true, operation: 'run', profile: 'debug', standard: '', sources: [], includePaths: [], libraryPaths: [], linkArgs: [], output: '', package: '', binary: '', example: '', features: [], rustToolchain: '', cargoTarget: '', packageManager: 'npm', script: '', typescriptRunner: 'tsx', framework: '', launchProfile: '', goToolchain: '', debugName: '', debugType: '', classPath: [], modulePath: [] };
}
export function validateFile(value: unknown): ConfigurationFile {
  const fail = (text: string): never => { throw new RunnerError(`Configuration: ${text}`, true); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) { return fail('expected a JSON object.'); }
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some(k => !['version','default','configurations'].includes(k))) { return fail('unknown top-level field.'); }
  if (raw.version !== 1 || !Array.isArray(raw.configurations) || raw.configurations.length > 200) { return fail('version must be 1 and configurations must be an array of at most 200 items.'); }
  const ids = new Set<string>();
  const configurations = raw.configurations.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { return fail(`item ${index + 1} must be an object.`); }
    const item = entry as Record<string, unknown>;
    if (Object.keys(item).some(k => !fields.has(k))) { return fail(`item ${index + 1}: unknown field.`); }
    if (!(runtimeLanguages as readonly unknown[]).includes(item.language)) { return fail(`item ${index + 1}: unsupported language.`); }
    const merged = { ...newConfiguration(item.language as RuntimeLanguage), ...item } as AtelierConfiguration;
    for (const key of scalar) { if (typeof merged[key] !== 'string' || merged[key].length > 8192 || /\0/.test(merged[key])) { return fail(`${key} must be a bounded string.`); } }
    if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(merged.id) || ids.has(merged.id)) { return fail(`item ${index + 1}: id must be unique and contain only letters, digits, dots, underscores or hyphens.`); }
    ids.add(merged.id);
    if (!merged.name.trim()) { return fail('name is required.'); }
    for (const key of arrays) { if (!Array.isArray(merged[key]) || merged[key].length > 500 || merged[key].some(v => typeof v !== 'string' || v.length > 8192 || v.includes('\0'))) { return fail(`${key} must be a string array.`); } }
    const enums = { kind: ['file','project','module','executable','task','launch'], operation: ['run','build','test'], profile: ['debug','release'], packageManager: ['npm','pnpm','yarn'], typescriptRunner: ['tsx','ts-node','tsc'] };
    for (const [key, values] of Object.entries(enums)) { if (!values.includes(String(merged[key as keyof AtelierConfiguration]))) { return fail(`invalid ${key}.`); } }
    if (typeof merged.terminal !== 'boolean' || typeof merged.autoActivate !== 'boolean') { return fail('terminal and autoActivate must be booleans.'); }
    if (!merged.env || typeof merged.env !== 'object' || Array.isArray(merged.env)) { return fail('env must be an object of environment/secret references.'); }
    for (const [key, ref] of Object.entries(merged.env)) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key) || typeof ref !== 'string' || !/^\$\{(?:env|secret):[a-zA-Z_][a-zA-Z0-9_.-]*\}$/.test(ref)) { return fail(`env.${key}: use a reference such as \${env:API_TOKEN} or \${secret:API_TOKEN}; plaintext values are not stored.`); }
    }
    for (const arg of [...merged.args, ...merged.buildArgs]) { if (/^--?(?:password|token|api[-_]key|secret)=.+/i.test(arg) && !arg.includes('${')) { return fail('pass sensitive arguments through environment or secret references.'); } }
    return merged;
  });
  if (raw.default !== undefined && (typeof raw.default !== 'string' || !ids.has(raw.default))) { return fail('default must refer to an existing configuration id.'); }
  return { version: 1, ...(raw.default ? { default: raw.default as string } : {}), configurations };
}
export function portablePath(value: string, workspace: string, platform = process.platform): string {
  const p = platform === 'win32' ? path.win32 : path.posix;
  if (!p.isAbsolute(value)) { return value; }
  const rel = p.relative(workspace, value);
  if (!rel || (!rel.startsWith(`..${p.sep}`) && rel !== '..' && !p.isAbsolute(rel))) { return '${workspaceFolder}' + (rel ? '/' + rel.split(p.sep).join('/') : ''); }
  return value;
}
export function selectionKey(folder: string, project: string): string { return `atelier.selection:${folder}::${project}`; }
export interface Variables { workspace: string; project: string; file: string; cache: string; env: NodeJS.ProcessEnv; secret(name: string): PromiseLike<string | undefined>; toolchain(id: string): string | undefined; localPath?(id:string):string|undefined }
export async function expand(value: string, variables: Variables): Promise<string> {
  const matches = [...value.matchAll(/\$\{([^}]+)\}/g)];
  let result = value;
  for (const match of matches) {
    const key = match[1];
    let replacement: string | undefined;
    if (key === 'workspaceFolder') { replacement = variables.workspace; }
    else if (key === 'projectDir') { replacement = variables.project; }
    else if (key === 'file') { replacement = variables.file; }
    else if (key === 'fileDirname') { replacement = path.dirname(variables.file); }
    else if (key === 'fileBasenameNoExtension') { replacement = path.basename(variables.file, path.extname(variables.file)); }
    else if (key === 'cacheDir') { replacement = variables.cache; }
    else if (key.startsWith('env:')) { replacement = variables.env[key.slice(4)]; }
    else if (key.startsWith('secret:')) { replacement = await variables.secret(key.slice(7)); }
    else if (key.startsWith('localPath:')) { replacement = variables.localPath?.(key.slice(10)); }
    else if (key.startsWith('toolchain:')) { replacement = variables.toolchain(key.slice(10)); }
    if (replacement === undefined) { throw new RunnerError(`Unresolved variable: \${${key}}. Configure it before running.`, true); }
    result = result.replace(match[0], () => replacement!);
  }
  return result;
}
