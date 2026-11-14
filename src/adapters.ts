import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { AtelierConfiguration as Configuration, RuntimeLanguage, runtimeLanguages, newConfiguration, PreparedRun } from './configuration';
import { Step, RunnerError } from './model';
import { contained, exists, readProjectFile } from './detect';
import { firstTool, resolveTool } from './tools';
import { ToolchainDiscovery, query } from './toolchains';
import { ProjectRecord } from './projects';
import type { AdapterContext, DebugPlan, RuntimeAdapter } from './adapterTypes';
import { AdapterRegistry, registerBuiltinDescriptors } from './adapterRegistry';
export type { AdapterContext, DebugPlan, RuntimeAdapter } from './adapterTypes';
function resolveFrom(cwd: string, value: string): string { return path.isAbsolute(value) ? value : path.resolve(cwd, value); }
async function localFile(root: string, relative: string): Promise<string | undefined> {
  const directory = root;
  for (;;) {
    const file = path.join(directory, relative);
    if (await exists(file) && await contained(directory, file)) { return file; }
    const parent = path.dirname(directory); if (parent === directory) { return undefined; }
    // Tool discovery is restricted by the caller to the owning project; no ancestor disk scan.
    return undefined;
  }
}
function cargoArguments(c: Configuration, operation: string): string[] {
  const args = [...(c.rustToolchain ? [`+${c.rustToolchain}`] : []), operation];
  if (c.profile === 'release') { args.push('--release'); }
  if (c.package) { args.push('--package', c.package); }
  if (c.binary) { args.push('--bin', c.binary); }
  if (c.example) { args.push('--example', c.example); }
  if (c.features.length) { args.push('--features', c.features.join(',')); }
  if (c.cargoTarget) { args.push('--target', c.cargoTarget); }
  args.push(...c.buildArgs);
  return args;
}
async function packageScript(c: Configuration, ctx: AdapterContext, node: string): Promise<Step> {
  const source = await readProjectFile(ctx.root, 'package.json');
  const pkg = source ? JSON.parse(source) as { scripts?: Record<string,string> } : {};
  if (!c.script || !pkg.scripts?.[c.script]) { throw new RunnerError(`No package.json script named "${c.script}".`, true); }
  let cli: string | undefined;
  if (c.packageManager === 'npm') {
    if (process.platform === 'win32') { cli = path.join(path.dirname(node), 'node_modules/npm/bin/npm-cli.js'); }
    else {for(const candidate of [path.resolve(path.dirname(node),'../lib/node_modules/npm/bin/npm-cli.js'),path.join(path.dirname(node),'node_modules/npm/bin/npm-cli.js')]){if(await exists(candidate)){cli=candidate;break;}}if(!cli){cli=await fs.realpath(await resolveTool('npm',ctx.root));}}
  } else {
    try { cli = await fs.realpath(await resolveTool(c.packageManager, ctx.root)); }
    catch { throw new RunnerError(`${c.packageManager} is missing or is a Windows batch wrapper. Configure a native JS CLI path or an existing VS Code task.`, true); }
  }
  if (!cli || !await exists(cli)) { throw new RunnerError(`${c.packageManager} CLI entry was not found. Use an existing package-manager task.`, true); }
  // pnpm may be a standalone native executable, not a JavaScript CLI.
  const handle=await fs.open(cli,'r');let header:string;try{const bytes=Buffer.alloc(512);const read=await handle.read(bytes,0,bytes.length,0);header=bytes.subarray(0,read.bytesRead).toString('utf8');}finally{await handle.close();}
  const nodeScript=/\.[cm]?js$/i.test(cli)||/^#![^\n]*\bnode\b/.test(header);
  const args=['run', c.script, ...(c.args.length ? [...(c.packageManager==='npm'?['--']:[]), ...c.args] : [])];
  return { command: nodeScript?node:cli, args: nodeScript?[cli,...args]:args, cwd: ctx.root, label: `${c.packageManager}: ${c.script}`, env: ctx.environment, terminal: c.terminal };
}
async function build(c: Configuration, ctx: AdapterContext, debug = false): Promise<PreparedRun> {
  const cwd = c.cwd || ctx.root;
  const target = c.target || ctx.file;
  const step = (command: string, args: string[], label = c.name): Step => ({ command, args, cwd, label, env: ctx.environment, terminal: c.terminal });
  const single = (command: string, args: string[]): PreparedRun => ({ plan: { name: c.name, steps: [step(command, args)] } });
  const tool = ctx.toolchain;
  if (c.kind === 'executable') { return single(await resolveTool(tool || target, cwd), c.args); }
  switch (c.language) {
    case 'python': {
      const command = await resolveTool(tool || 'python3', cwd);
      const args = c.operation === 'test' ? ['-m','pytest', ...(target && target !== ctx.file ? [target] : []), ...c.args] : c.kind === 'module' || c.kind === 'project' ? ['-m', target, ...c.args] : [resolveFrom(cwd,target), ...c.args];
      return single(command, args);
    }
    case 'go': {
      const command = await resolveTool(tool || 'go', cwd);
      const operation = c.operation === 'test' ? 'test' : c.operation === 'build' || debug ? 'build' : 'run';
      const args = [operation, ...c.buildArgs];
      if (operation === 'build') { args.push('-o', c.output || path.join(ctx.cache, process.platform === 'win32' ? 'go-program.exe' : 'go-program')); }
      args.push(c.kind === 'file' ? resolveFrom(cwd,target) : target || (operation === 'test' ? './...' : '.'));
      if (operation === 'run') { args.push(...c.args); } else if (operation === 'test' && c.args.length) { args.push('-args', ...c.args); }
      return single(command,args);
    }
    case 'rust': {
      const command = await resolveTool(tool || 'cargo', cwd);
      if (c.rustToolchain) {
        const rustup = await resolveTool('rustup', cwd);
        const installed = await query(rustup, ['toolchain','list'], cwd);
        if (!installed.split(/\r?\n/).some(line => line.split(/\s/)[0] === c.rustToolchain || line.startsWith(c.rustToolchain + '-'))) { throw new RunnerError(`Rust toolchain ${c.rustToolchain} is not installed. Use SDK Manager; no toolchain was installed automatically.`, true); }
      }
      const args = cargoArguments(c, c.operation === 'test' ? 'test' : c.operation === 'build' || debug ? 'build' : 'run');
      const manifest=target.endsWith('Cargo.toml')?resolveFrom(cwd,target):path.join(resolveFrom(cwd,target),'Cargo.toml');
      if(await exists(manifest)){args.push('--manifest-path',manifest);}
      if (c.operation !== 'build' && !debug && c.args.length) { args.push('--', ...c.args); }
      return single(command,args);
    }
    case 'javascript': case 'javascriptreact': case 'typescript': case 'typescriptreact': case 'node': {
      const node = await resolveTool(tool || 'node', cwd);
      if (c.script) { return { plan: { name: c.name, steps: [await packageScript(c, ctx, node)] } }; }
      if (['typescript','typescriptreact'].includes(c.language)) {
        const roots = [...new Set([ctx.root, ctx.folder.uri.fsPath])];
        const relative = c.typescriptRunner === 'tsx' ? 'node_modules/tsx/dist/cli.mjs' : c.typescriptRunner === 'ts-node' ? 'node_modules/ts-node/dist/bin.js' : 'node_modules/typescript/bin/tsc';
        let cli: string | undefined;
        for (const root of roots) { cli = await localFile(root,relative); if (cli) { break; } }
        if (!cli) { throw new RunnerError(`Install ${c.typescriptRunner} as a project development dependency, or select an existing script/task. It is never installed automatically.`, true); }
        if (c.typescriptRunner !== 'tsc') { return single(node, [cli, ...c.buildArgs, resolveFrom(cwd,target), ...c.args]); }
        if (!c.output) { throw new RunnerError('tsc requires an explicit compiled JavaScript entry (Output executable/file), with sourceMap enabled in tsconfig.json.', true); }
        return { plan: { name: c.name, steps: [step(node,[cli,'--project', path.join(ctx.root,'tsconfig.json'),'--sourceMap', ...c.buildArgs], 'Compile TypeScript'), ...(c.operation === 'build' ? [] : [step(node,[resolveFrom(cwd,c.output), ...c.args])])] } };
      }
      if (c.language === 'javascriptreact') { throw new RunnerError('JSX requires a configured project script or build task.', true); }
      return single(node,[resolveFrom(cwd,target), ...c.args]);
    }
    case 'c': case 'cpp': {
      if (c.kind === 'project') {
        if(c.sources.length||c.includePaths.length||c.libraryPaths.length||c.linkArgs.length){throw new RunnerError('For CMake/Make projects, configure sources/includes/libraries in the existing build files or a VS Code task. These fields apply to direct compiler configurations.',true);}
        const marker = path.join(ctx.root, 'CMakeLists.txt');
        const steps:Step[]=[];
        if (await exists(marker)) {
          const cmake = await resolveTool('cmake', cwd);const directory=resolveFrom(cwd,target);
          if(directory===path.resolve(ctx.root)){throw new RunnerError('Choose a separate CMake build directory in Target. In-source build files will not be created automatically.',true);}
          const compiler=tool?await resolveTool(tool,cwd):undefined;
          const key=c.language==='c'?'CMAKE_C_COMPILER':'CMAKE_CXX_COMPILER';
          const cache=path.join(directory,'CMakeCache.txt');
          if(compiler&&await exists(cache)){const text=await fs.readFile(cache,'utf8');const configured=text.split(/\r?\n/).find(line=>line.startsWith(key+':'))?.split('=').slice(1).join('=');if(configured&&await fs.realpath(configured).catch(()=>configured)!==await fs.realpath(compiler)){throw new RunnerError('This CMake build directory is cached for another compiler. Choose a separate build directory; no user cache was deleted.',true);}}
          const configure=['-S',ctx.root,'-B',directory,`-DCMAKE_BUILD_TYPE=${c.profile==='release'?'Release':'Debug'}`,...(compiler?[`-D${key}=${compiler}`]:[])];
          if(c.standard){const standard=c.standard.match(/\d+/)?.[0];if(!standard){throw new RunnerError('Select a numeric C/C++ standard such as c11 or c++20.',true);}configure.push(`-D${c.language==='c'?'CMAKE_C_STANDARD':'CMAKE_CXX_STANDARD'}=${standard}`);}
          steps.push(step(cmake,configure,'Configure CMake target'),step(cmake,['--build',directory,'--config',c.profile==='release'?'Release':'Debug',...(c.binary?['--target',c.binary]:[]),...c.buildArgs],'Build CMake target'));
          if(c.operation==='test'){steps.push(step(await resolveTool('ctest',cwd),['--test-dir',directory,'--build-config',c.profile==='release'?'Release':'Debug',...c.args],'CTest'));return {plan:{name:c.name,steps}};}
        } else {
          if(c.standard){throw new RunnerError('Set the language standard in the Makefile or its native build task. Direct compiler configurations support the Standard field.',true);}
          steps.push(step(await resolveTool('make',cwd),['-C',resolveFrom(cwd,target),...(c.binary?[c.binary]:[]),...c.buildArgs,...(tool?[`${c.language==='c'?'CC':'CXX'}=${await resolveTool(tool,cwd)}`]:[])],'Build Make target'));
        }
        if(c.operation!=='build'&&!c.output){throw new RunnerError('Set the actual executable output for this build target, or choose an existing launch configuration.',true);}
        if(c.operation!=='build'){steps.push(step(resolveFrom(cwd,c.output),c.args));}
        return {plan:{name:c.name,steps}};
      }
      const command = tool ? await resolveTool(tool,cwd) : await firstTool(c.language === 'c' ? ['clang','gcc'] : ['clang++','g++'],cwd);
      const output = c.output ? resolveFrom(cwd,c.output) : path.join(ctx.cache, `program${process.platform === 'win32' ? '.exe' : ''}`);
      const sources = c.sources.length ? c.sources.map(p => resolveFrom(cwd,p)) : [resolveFrom(cwd,target)];
      const msvc = /^cl(?:\.exe)?$/i.test(path.basename(command));
      const includes = c.includePaths.flatMap(p => msvc ? [`/I${resolveFrom(cwd,p)}`] : ['-I',resolveFrom(cwd,p)]);
      const libraries = c.libraryPaths.flatMap(p => msvc ? [`/LIBPATH:${resolveFrom(cwd,p)}`] : ['-L',resolveFrom(cwd,p)]);
      const flags = msvc ? ['/nologo', c.language === 'c' ? '/TC' : '/TP', ...(debug || c.profile === 'debug' ? ['/Zi','/Od'] : ['/O2']), ...(c.standard ? [`/std:${c.standard}`] : []), ...includes, ...c.buildArgs, ...sources, `/Fo${ctx.cache}${path.sep}`, `/Fd${path.join(ctx.cache,'program.pdb')}`, `/Fe${output}`, '/link', ...libraries, ...c.linkArgs] : [...(debug || c.profile === 'debug' ? ['-g','-O0'] : ['-O2']), ...(c.standard ? [`-std=${c.standard}`] : []), ...includes, ...c.buildArgs, ...sources, '-o',output, ...libraries, ...c.linkArgs];
      return { plan: { name: c.name, steps: [step(command,flags,`Compile ${c.language}`), ...(c.operation === 'build' ? [] : [step(output,c.args)])] } };
    }
    case 'csharp': {
      const command = await resolveTool(tool || 'dotnet',cwd);
      const operation = c.operation;
      const args = [operation, ...(operation === 'run' ? ['--project',resolveFrom(cwd,target)] : [resolveFrom(cwd,target)]), '--configuration', c.profile === 'release' ? 'Release' : 'Debug', ...(c.framework ? ['--framework',c.framework] : []), ...(c.launchProfile && operation === 'run' ? ['--launch-profile',c.launchProfile] : []), ...c.buildArgs];
      if (c.args.length && operation === 'run') { args.push('--',...c.args); }
      return single(command,args);
    }
    case 'java': {
      const command = await resolveTool(tool || 'java',cwd);
      return single(command,[...(c.classPath.length ? ['--class-path',c.classPath.map(p=>resolveFrom(cwd,p)).join(path.delimiter)] : []), ...(c.modulePath.length ? ['--module-path',c.modulePath.map(p=>resolveFrom(cwd,p)).join(path.delimiter)] : []), ...c.buildArgs, c.kind === 'file' ? resolveFrom(cwd,target) : target, ...c.args]);
    }
  }
}
async function debugPlan(c: Configuration, ctx: AdapterContext, type: string): Promise<DebugPlan> {
  const cwd = c.cwd || ctx.root; const target = c.target || ctx.file;
  const configuration: vscode.DebugConfiguration = { ...(type==='lldb'?{terminal:c.terminal?'integrated':'console',sourceLanguages:c.language==='rust'?['rust']:['c','cpp']}:{}), name: c.name, type, request: 'launch', cwd, args: c.args, env: ctx.environment };
  if (c.operation !== 'run') { throw new RunnerError('Build/Test configurations require a dedicated debug launch configuration. Choose a runnable target.', true); }
  if (c.kind === 'executable') { return { configuration: { ...configuration, program: resolveFrom(cwd,target) }, build: [] }; }
  switch (c.language) {
    case 'python': return { configuration: { ...configuration, ...(c.kind === 'module' || c.kind === 'project' ? { module: target } : { program: resolveFrom(cwd,target) }), python: ctx.toolchain, console: c.terminal ? 'integratedTerminal' : 'internalConsole', justMyCode: true }, build: [] };
    case 'go': {
      const configured=vscode.workspace.getConfiguration('go',ctx.folder.uri).get<Record<string,string>>('alternateTools',{}).dlv;
      const candidates=[...(configured?[configured]:[]),'dlv'];
      const go=await resolveTool(ctx.toolchain||'go',cwd);const roots=(await query(go,['env','GOBIN','GOPATH'],cwd,{...process.env,GOTOOLCHAIN:'local'})).split(/\r?\n/);if(roots[0]){candidates.push(path.join(roots[0],process.platform==='win32'?'dlv.exe':'dlv'));}for(const root of (roots[1]||'').split(path.delimiter).filter(Boolean)){candidates.push(path.join(root,'bin',process.platform==='win32'?'dlv.exe':'dlv'));}
      let delve:string|undefined;for(const candidate of candidates){try{delve=await resolveTool(candidate,cwd);break;}catch{/* Try the official Go tool locations. */}}if(!delve){throw new RunnerError('Delve is missing. Use Go: Install/Update Tools to install dlv, or configure go.alternateTools.dlv. No debugger was installed automatically.',true);}
      return { configuration: { ...configuration, mode: 'auto', program: c.kind === 'file' ? resolveFrom(cwd,target) : resolveFrom(cwd,target || '.'), dlvToolPath:delve, buildFlags: c.buildArgs.map(a=>/\s/.test(a)?JSON.stringify(a):a).join(' '), goExecPath: go }, build: [] };
    }
    case 'javascript': case 'node': case 'javascriptreact': case 'typescript': case 'typescriptreact': {
      if (c.script) { throw new RunnerError('Debug a package script through an existing JavaScript launch configuration, so its actual entry and child-process behavior stay under user control.', true); }
      const base = { ...configuration, program: resolveFrom(cwd,target), runtimeExecutable: ctx.toolchain || await resolveTool('node',cwd), console: c.terminal ? 'integratedTerminal' : 'internalConsole', sourceMaps: true, skipFiles: ['<node_internals>/**'] };
      if (['typescript','typescriptreact'].includes(c.language)) {
        if (c.typescriptRunner === 'tsc') {
          const prepared = await build(c,ctx,true);
          return { configuration: { ...base, program: resolveFrom(cwd,c.output), outFiles: [path.join(ctx.root,'**/*.js')] }, build: prepared.plan.steps.slice(0,1) };
        }
        const pkgSource=await readProjectFile(ctx.root,'package.json');const esm=c.typescriptRunner==='ts-node'&&(target.endsWith('.mts')||(pkgSource&&JSON.parse(pkgSource).type==='module'));
        if(c.typescriptRunner==='tsx'){const version=await query(String(base.runtimeExecutable),['--version'],cwd);const parts=version.match(/v(\d+)\.(\d+)/);const major=Number(parts?.[1]);const minor=Number(parts?.[2]);if(!(major>20||major===20&&minor>=6||major===18&&minor>=19)){throw new RunnerError('tsx source-map debugging requires Node 18.19+, 20.6+, or a later LTS. Select a supported Node runtime or use tsc plus source maps.',true);}}
        const relative = c.typescriptRunner === 'tsx' ? 'node_modules/tsx/dist/loader.mjs' : esm?'node_modules/ts-node/esm.mjs':'node_modules/ts-node/register/index.js';
        const loader = await localFile(ctx.root,relative) || await localFile(ctx.folder.uri.fsPath,relative);
        if (!loader) { throw new RunnerError(`A local ${c.typescriptRunner} installation is required for TypeScript debugging.`,true); }
        return { configuration: { ...base, runtimeArgs: c.typescriptRunner === 'tsx' ? ['--import',pathToFileURL(loader).toString()] : esm?['--loader',pathToFileURL(loader).toString()]:['--require',loader], resolveSourceMapLocations: [path.join(ctx.root,'**'),'!**/node_modules/**'] }, build: [] };
      }
      return { configuration: base, build: [] };
    }
    case 'c': case 'cpp': {
      const prepared = await build({ ...c, operation: 'run' },ctx,true);
      const run = prepared.plan.steps[prepared.plan.steps.length - 1];
      const extras = type === 'cppdbg' ? { MIMode: 'gdb', miDebuggerPath: await resolveTool('gdb',cwd) } : {};
      return { configuration: { ...configuration, ...extras, program: run.command, ...(type === 'cppvsdbg' ? { console: c.terminal ? 'integratedTerminal' : 'internalConsole' } : {}) }, build: prepared.plan.steps.slice(0,-1) };
    }
    case 'rust': {
      const prepared = await build(c,ctx,true); const compile = prepared.plan.steps[0];
      const artifactFile = path.join(ctx.cache,'cargo-artifacts.json');
      const wrapper = path.join(__dirname,'cargoBuild.js');
      let host=await resolveTool('node',cwd).catch(()=>process.execPath);if(host===process.execPath&&process.platform==='darwin'){const bin=path.resolve(vscode.env.appRoot,'../../MacOS');host=path.join(bin,(await fs.readdir(bin))[0]);}
      return { configuration: { ...configuration, program: '${cargoArtifact}' }, build: [{ ...compile, command: host, args: [wrapper,compile.command,artifactFile, ...compile.args,'--message-format=json'], env: { ...ctx.environment,ELECTRON_RUN_AS_NODE: '1' } }], artifactFile };
    }
    case 'csharp': case 'java': throw new RunnerError(`${c.language} debugging needs an existing launch.json configuration to identify the built assembly/main class. Set Debug Configuration in this run configuration.`,true);
  }
}
async function propose(language: RuntimeLanguage, ctx: AdapterContext): Promise<Configuration[]> {
  const file = newConfiguration(language, `${language}: Current file`); file.id = randomUUID();
  const configs: Configuration[] = ['rust','csharp'].includes(language)?[]:[file];
  const project = newConfiguration(language,`${language}: Project`); project.id=randomUUID(); project.kind='project'; project.target='.'; project.cwd='${projectDir}';
  if (['go','rust','csharp'].includes(language)) { configs.push(project); }
  if (['go','rust','python','csharp'].includes(language)) { const test={...project,id:randomUUID(),name:`${language}: Test project`,operation:'test' as const,target:language==='go'?'./...':language==='python'?'':'.'};configs.push(test); }
  if (['javascript','typescript','node'].includes(language)) {
    const source=await readProjectFile(ctx.root,'package.json');
    if(source){const pkg=JSON.parse(source) as {scripts?:Record<string,string>;packageManager?:string};for(const script of Object.keys(pkg.scripts??{})){const entry={...project,id:randomUUID(),name:`${language}: ${script}`,script}; if(pkg.packageManager?.startsWith('pnpm')){entry.packageManager='pnpm';}else if(pkg.packageManager?.startsWith('yarn')){entry.packageManager='yarn';}configs.push(entry);}}
  }
  return configs;
}
function createAdapter(language: RuntimeLanguage): RuntimeAdapter { return {
  language, runtime: ['javascript','javascriptreact','typescript','typescriptreact','node'].includes(language) ? 'node' : language,
  detectProjects: (projects: ProjectRecord[]) => projects.filter(p => p.languages.includes(language)),
  discoverToolchains: (discovery: ToolchainDiscovery, folder: vscode.WorkspaceFolder) => discovery.discover(language, folder),
  detectRunTargets: (context: AdapterContext) => propose(language,context),
  proposeConfigurations: (context: AdapterContext) => propose(language,context),
  validateConfiguration: (c: Configuration) => {
    if(c.language!==language){throw new RunnerError('Configuration language does not match its adapter.');}
    if(c.language==='python'&&c.operation==='build'){throw new RunnerError('Python build actions require an explicit build task.',true);}
    if(c.binary&&c.example){throw new RunnerError('Choose a Cargo binary or example, not both.',true);}
    if(c.kind==='module'&&language!=='python'&&language!=='java'){throw new RunnerError('Module entry is supported for Python/Java; select a file or project for this language.',true);}
    if(c.language==='csharp'&&c.operation==='run'&&/\.slnx?$/.test(c.target)){throw new RunnerError('Choose a startup .csproj for dotnet run. Solutions are supported as build/test targets.',true);}
    if(c.kind==='file'&&['csharp','rust'].includes(language)){throw new RunnerError(`${language} managed configurations require a project or executable. Run Current File remains available through the original runner.`,true);}
  },
  buildRunPlan: (c: Configuration, context: AdapterContext) => build(c,context),
  buildDebugPlan: (c: Configuration, context: AdapterContext, type: string) => debugPlan(c,context,type),
  resolveTerminalEnvironment: (c: Configuration, context: AdapterContext) => {
    const environment={...context.environment};
    if(language==='go'){environment.GOTOOLCHAIN=c.goToolchain||process.env.GOTOOLCHAIN||'local';}
    if(language==='rust'&&c.rustToolchain){environment.RUSTUP_TOOLCHAIN=c.rustToolchain;}
    if(context.toolchain){const key=process.platform==='win32'?'Path':'PATH';const current=Object.entries(context.environment).find(([name])=>process.platform==='win32'?name.toLowerCase()==='path':name==='PATH')?.[1]||process.env[key]||process.env.PATH||'';if(process.platform==='win32'){for(const name of Object.keys(environment)){if(name.toLowerCase()==='path'){delete environment[name];}}}environment[key]=[path.dirname(context.toolchain),current].join(path.delimiter);if(language==='csharp'&&!environment.DOTNET_ROOT){environment.DOTNET_ROOT=path.dirname(context.toolchain);}}
    return environment;
  }
}; }
/** Single registry for languages, build systems, run targets and project backends. */
export const adapterRegistry = new AdapterRegistry();
registerBuiltinDescriptors(adapterRegistry);
for (const language of runtimeLanguages) { adapterRegistry.languages.register(language, createAdapter(language)); }
/** Language adapters keyed by language; kept for existing callers. */
export const adapters = adapterRegistry.languages;
