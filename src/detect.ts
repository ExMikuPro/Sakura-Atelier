import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Language, Project } from './model';
export async function exists(file: string): Promise<boolean> { try { return (await fs.stat(file)).isFile(); } catch { return false; } }
export function within(root: string, file: string): boolean { const rel = path.relative(root, file); return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel)); }
/** Resolve symlinks before traversing; never read project metadata outside a workspace. */
export async function contained(root: string, file: string): Promise<boolean> {
  try { return within(await fs.realpath(root), await fs.realpath(file)); } catch { return false; }
}
export async function findProject(file: string, workspace: string | undefined, language: Language): Promise<Project | undefined> {
  if (!workspace || !await contained(workspace, file)) { return undefined; }
  const boundary = await fs.realpath(workspace);
  let dir = path.dirname(await fs.realpath(file));
  while (within(boundary, dir)) {
    const markers: Partial<Record<Language, string[]>> = {
      rust: ['Cargo.toml'], go: ['go.mod','go.work'], python: ['pyproject.toml', 'Pipfile', 'setup.py', 'requirements.txt', '.venv/pyvenv.cfg', 'venv/pyvenv.cfg'],
      javascript: ['package.json'], javascriptreact: ['package.json'], typescript: ['package.json', 'tsconfig.json'], typescriptreact: ['package.json', 'tsconfig.json'],
      c: ['CMakeLists.txt', 'Makefile'], cpp: ['CMakeLists.txt', 'Makefile'], java: ['pom.xml', 'build.gradle', 'build.gradle.kts']
    };
    let names = markers[language] ?? [];
    if (language === 'csharp') { names = (await fs.readdir(dir)).filter(n => /\.(csproj|sln|slnx)$/.test(n)).sort(); }
    for (const name of names) {
      const marker = path.join(dir, name);
      if (await exists(marker) && await contained(boundary, marker)) { return { root: dir, marker: name }; }
    }
    if (dir === boundary) { break; }
    dir = path.dirname(dir);
  }
  return undefined;
}
export async function readProjectFile(root: string, relative: string): Promise<string | undefined> {
  const file = path.join(root, relative);
  if (!await exists(file)) { return undefined; }
  if (!await contained(root, file)) { throw new Error(`Project metadata escapes project directory: ${relative}`); }
  return fs.readFile(file, 'utf8');
}
