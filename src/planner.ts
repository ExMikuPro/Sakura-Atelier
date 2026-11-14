import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Language, Mode, Project, RunPlan, RunnerError, Settings, Step } from './model';
import { contained, exists, readProjectFile } from './detect';
import { firstTool, resolveTool } from './tools';
export interface PlanContext { file: string; language: Language; mode: Mode; project?: Project; workspace?: string; cache: string; settings: Settings }
function plan(name: string, command: string, args: string[], cwd: string): RunPlan { return { name, steps: [{ command, args, cwd, label: name }] }; }
async function python(c: PlanContext, cwd: string): Promise<string> {
  if (c.settings.pythonPath) { return resolveTool(c.settings.pythonPath, cwd); }
  if (c.project) {
    for (const venv of ['.venv', 'venv']) {
      const executable = path.join(c.project.root, venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
      if (await exists(executable)) { return resolveTool(executable, cwd); }
    }
  }
  return firstTool(process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'], cwd);
}
export async function createPlans(c: PlanContext): Promise<RunPlan[]> {
  const project = c.mode === 'file' ? undefined : c.project;
  const cwd = project?.root ?? path.dirname(c.file);
  const make = (name: string, command: string, args: string[]) => [plan(name, command, args, cwd)];
  if (c.mode !== 'file') {
    const custom = c.settings.configurations.filter(x => x.language === c.language);
    if (custom.length) {
      const expand = (value: string) => value.replace(/\$\{(file|projectDir|workspaceFolder)\}/g, (_, key: string) => key === 'file' ? c.file : key === 'projectDir' ? cwd : c.workspace ?? cwd);
      const result: RunPlan[] = [];
      for (const entry of custom) {
        if (typeof entry.name !== 'string' || typeof entry.command !== 'string' || (entry.args !== undefined && (!Array.isArray(entry.args) || entry.args.some(x => typeof x !== 'string')))) { throw new RunnerError('Invalid Sakura Atelier configuration.', true); }
        result.push(plan(entry.name, expand(entry.command), (entry.args ?? []).map(expand), cwd));
      }
      return result;
    }
  }
  if (c.mode === 'project' && !project) { throw new RunnerError('No supported project found inside the current workspace. Use Run File or configure a project command.', true); }
  switch (c.language) {
    case 'python': return make(project ? 'Python project entry' : 'Python file', await python(c, cwd), [c.file]);
    case 'go': return make(project ? 'Go project' : 'Go file', 'go', ['run', project ? '.' : c.file]);
    case 'rust': {
      if (!project) {
        await fs.mkdir(c.cache, { recursive: true });
        const binary = path.join(c.cache, `program${process.platform === 'win32' ? '.exe' : ''}`);
        return [{ name: 'Rust file', steps: [{ command: 'rustc', args: [c.file, '-o', binary], cwd, label: 'Compile Rust' }, { command: binary, args: [], cwd, label: 'Run Rust' }] }];
      }
      const toml = await readProjectFile(cwd, 'Cargo.toml') ?? '';
      const bins = [...toml.matchAll(/\[\[bin\]\]([\s\S]*?)(?=\n\[|$)/g)].flatMap(m => { const name = m[1].match(/^\s*name\s*=\s*"([^"]+)"/m); return name ? [name[1]] : []; });
      const packageSection = toml.match(/\[package\]([\s\S]*?)(?=\n\[|$)/)?.[1] ?? '';
      const packageName = packageSection.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1];
      if (await exists(path.join(cwd, 'src/main.rs')) && packageName && !/autobins\s*=\s*false/.test(packageSection)) { bins.push(packageName); }
      const binDir = path.join(cwd, 'src/bin');
      if (await contained(cwd, binDir) && !/autobins\s*=\s*false/.test(packageSection)) {
        for (const entry of await fs.readdir(binDir, { withFileTypes: true })) {
          if (entry.isFile() && entry.name.endsWith('.rs')) { bins.push(entry.name.slice(0, -3)); }
          if (entry.isDirectory() && await exists(path.join(binDir, entry.name, 'main.rs'))) { bins.push(entry.name); }
        }
      }
      const distinct = [...new Set(bins)];
      return distinct.length ? distinct.map(bin => plan(`Cargo: ${bin}`, 'cargo', ['run', '--bin', bin], cwd)) : make('Cargo project', 'cargo', ['run']);
    }
    case 'javascript': case 'javascriptreact': case 'typescript': case 'typescriptreact': {
      if (project) {
        const source = await readProjectFile(cwd, 'package.json');
        const pkg = source ? JSON.parse(source) as { scripts?: Record<string, string> } : {};
        const scripts = c.settings.script ? [c.settings.script] : ['start', 'dev', 'run'].filter(key => typeof pkg.scripts?.[key] === 'string');
        if (c.settings.script && typeof pkg.scripts?.[c.settings.script] !== 'string') { throw new RunnerError(`package.json script "${c.settings.script}" does not exist.`, true); }
        if (scripts.length) {
          const node = await resolveTool('node', cwd);
          const npm = process.platform === 'win32' ? path.join(path.dirname(node), 'npm') : await resolveTool('npm', cwd);
          // Invoke npm's JS entry with node, avoiding Windows cmd quoting entirely.
          const realNpm = process.platform === 'win32' ? npm : await fs.realpath(npm);
          const cli = process.platform === 'win32' ? path.join(path.dirname(npm), 'node_modules/npm/bin/npm-cli.js') : realNpm;
          if (!await exists(cli)) { throw new RunnerError('npm CLI not found. Configure an existing VS Code task for your package manager.', true); }
          return scripts.map(script => plan(`npm: ${script}`, node, [cli, 'run', script], cwd));
        }
        if (c.mode === 'project') { throw new RunnerError('No project start/dev/run script. Set sakuraRunner.script, projectTask or configurations.', true); }
      }
      if (c.language === 'javascript') { return make('Node.js file', 'node', [c.file]); }
      if (c.language === 'javascriptreact') { throw new RunnerError('JSX requires a project script or configured runner.', true); }
      // Discover only a local tsx installation in this project/workspace, never npx download.
      const roots = [c.project?.root, path.dirname(c.file), c.workspace].filter((root): root is string => !!root);
      for (const root of [...new Set(roots)]) {
        const cli = path.join(root, 'node_modules/tsx/dist/cli.mjs');
        if (await exists(cli) && await contained(root, cli)) { return make('tsx file', 'node', [cli, c.file]); }
      }
      throw new RunnerError('TypeScript needs a project script, an installed local tsx, or an explicit run configuration. No runner is installed automatically.', true);
    }
    case 'c': case 'cpp': {
      if (project) { throw new RunnerError(`${project.marker} detected. Set sakuraRunner.projectTask to an existing CMake/Make run task, or add a run configuration.`, true); }
      const compiler = c.language === 'c' ? c.settings.cCompiler : c.settings.cppCompiler;
      const command = compiler || await firstTool(c.language === 'c' ? ['gcc', 'clang'] : ['g++', 'clang++'], cwd);
      await fs.mkdir(c.cache, { recursive: true });
      const binary = path.join(c.cache, `program${process.platform === 'win32' ? '.exe' : ''}`);
      const compile: Step = { command, args: [c.file, '-o', binary], cwd, label: `Compile ${c.language === 'c' ? 'C' : 'C++'}` };
      return [{ name: `${c.language} file`, steps: [compile, { command: binary, args: [], cwd, label: 'Run binary' }] }];
    }
    case 'csharp': {
      if (!project) { throw new RunnerError('C# requires a .csproj project or an explicit run configuration.', true); }
      const files = (await fs.readdir(cwd)).filter(x => x.endsWith('.csproj'));
      return files.map(file => plan(`dotnet: ${file}`, 'dotnet', ['run', '--project', path.join(cwd, file)], cwd));
    }
    case 'java': {
      if (project) { throw new RunnerError(`${project.marker} detected. Select an existing Maven/Gradle run task via sakuraRunner.projectTask, or configure its explicit command and main class.`, true); }
      return make('Java source file (JDK 11+)', c.settings.javaPath || (process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java'), [c.file]);
    }
  }
}
