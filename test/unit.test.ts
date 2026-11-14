import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { findProject, within } from '../src/detect';
import { createPlans, PlanContext } from '../src/planner';
import { languages, Settings, supports } from '../src/model';
import { resolveTool } from '../src/tools';
const settings: Settings = { script: '', pythonPath: '', cCompiler: '', cppCompiler: '', configurations: [] };
async function fixture(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sakura unit 空格 & $-'));
  try { await fn(dir); } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
function context(dir: string, extra: Partial<PlanContext> = {}): PlanContext { return { file: path.join(dir, 'main.go'), language: 'go', mode: 'auto', workspace: dir, cache: path.join(dir, 'cache'), settings, ...extra }; }
test('manifest registers real commands and native language-gated editor button', async () => {
  const manifest = JSON.parse(await fs.readFile(path.resolve(__dirname, '../../package.json'), 'utf8'));
  assert.equal(manifest.engines.vscode, '^1.85.0');
  const button = manifest.contributes.menus['editor/title'][0];
  assert.equal(button.group, 'navigation@1'); assert.equal(button.command, 'sakuraAtelier.run');
  assert.equal(manifest.contributes.commands[0].icon, '$(play)');
  const nls=JSON.parse(await fs.readFile(path.resolve(__dirname,'../../package.nls.json'),'utf8'));assert.equal(nls[manifest.contributes.commands[0].title.slice(1,-1)],'使用 Sakura Atelier 运行');
  const expression = new RegExp(button.when.match(/=~ \/([^/]+)\//)[1]);
  for (const language of languages) { assert.ok(supports(language)); assert.ok(expression.test(language)); }
  for (const language of ['markdown', 'json', 'plaintext', 'html', 'shellscript']) { assert.equal(supports(language), false); assert.equal(expression.test(language), false); }
});
test('path boundary rejects prefix collisions and parent traversal', () => { assert.ok(within('/work', '/work/a')); assert.ok(!within('/work', '/work2/a')); assert.ok(!within('/work', '/a')); });
test('detects nearest project and never parent of workspace', () => fixture(async dir => {
  const nested = path.join(dir, 'child'); await fs.mkdir(nested); const file = path.join(nested, 'main.go'); await fs.writeFile(file, '');
  await fs.writeFile(path.join(dir, 'go.mod'), 'module root'); assert.equal((await findProject(file, dir, 'go'))?.root, await fs.realpath(dir));
  assert.equal(await findProject(file, nested, 'go'), undefined);
  await fs.writeFile(path.join(nested, 'go.mod'), 'module child'); assert.equal((await findProject(file, dir, 'go'))?.root, await fs.realpath(nested));
  assert.equal(await findProject(file, undefined, 'go'), undefined);
}));
test('recognizes all supported project markers', () => fixture(async dir => {
  const file = path.join(dir, 'source'); await fs.writeFile(file, '');
  const cases = { rust: 'Cargo.toml', go: 'go.mod', python: 'pyproject.toml', javascript: 'package.json', typescript: 'tsconfig.json', c: 'CMakeLists.txt', cpp: 'Makefile', csharp: 'App.csproj', java: 'pom.xml' } as const;
  for (const [language, marker] of Object.entries(cases)) {
    await fs.writeFile(path.join(dir, marker), '');
    assert.ok(await findProject(file, dir, language as PlanContext['language']), language);
    await fs.unlink(path.join(dir, marker));
  }
}));
test('does not follow workspace file or marker symlinks outside boundary', () => fixture(async dir => {
  const workspace = path.join(dir, 'workspace'); const outside = path.join(dir, 'outside'); await fs.mkdir(workspace); await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'go.mod'), 'module secret'); await fs.writeFile(path.join(outside, 'main.go'), '');
  await fs.symlink(path.join(outside, 'main.go'), path.join(workspace, 'main.go'));
  assert.equal(await findProject(path.join(workspace, 'main.go'), workspace, 'go'), undefined);
  await fs.writeFile(path.join(workspace, 'local.go'), ''); await fs.symlink(path.join(outside, 'go.mod'), path.join(workspace, 'go.mod'));
  assert.equal(await findProject(path.join(workspace, 'local.go'), workspace, 'go'), undefined);
}));
test('Go project first; Run File passes a single absolute argument with spaces', () => fixture(async dir => {
  const c = context(dir, { project: { root: dir, marker: 'go.mod' } });
  assert.deepEqual((await createPlans(c))[0].steps[0].args, ['run', '.']);
  assert.deepEqual((await createPlans({ ...c, mode: 'file' }))[0].steps[0].args, ['run', c.file]);
}));
test('project mode reports absent project', () => fixture(async dir => { await assert.rejects(createPlans(context(dir, { mode: 'project' })), /No supported project/); }));
test('missing SDK produces an explicit actionable error', () => fixture(async dir => { await assert.rejects(resolveTool('sakura-nonexistent-sdk', dir, { PATH: '' }), /Missing toolchain/); }));
test('tool path with spaces stays an executable, without shell parsing', () => fixture(async dir => {
  const tool = path.join(dir, process.platform === 'win32' ? 'tool & $.exe' : 'tool & $'); await fs.writeFile(tool, '#!/bin/sh\nexit 0\n', { mode: 0o755 }); assert.equal(await resolveTool(tool, dir), tool);
}));
test('C/C++ compile into cache and never source directory', () => fixture(async dir => {
  for (const language of ['c', 'cpp'] as const) {
    const c = context(dir, { language, settings: { ...settings, cCompiler: 'test-cc', cppCompiler: 'test-cxx' } });
    const plan = (await createPlans(c))[0]; assert.equal(plan.steps.length, 2); assert.ok(plan.steps[1].command.startsWith(c.cache)); assert.deepEqual(plan.steps[0].args, [c.file, '-o', plan.steps[1].command]);
  }
}));
test('CMake and Java projects require an explicit project entry', () => fixture(async dir => {
  for (const language of ['cpp', 'java'] as const) { await assert.rejects(createPlans(context(dir, { language, project: { root: dir, marker: language === 'cpp' ? 'CMakeLists.txt' : 'pom.xml' } })), /detected.*task/); }
}));
test('Java single file uses source launcher; C# does not invent a project', () => fixture(async dir => {
  // JAVA_HOME is honoured by the planner, so isolate the PATH-default case from the host environment.
  const savedJavaHome = process.env.JAVA_HOME; delete process.env.JAVA_HOME;
  try {
    const java = (await createPlans(context(dir, { language: 'java', mode: 'file', file: path.join(dir, 'Main.java') })))[0]; assert.equal(java.steps[0].command, 'java'); assert.deepEqual(java.steps[0].args, [path.join(dir, 'Main.java')]);
    process.env.JAVA_HOME = path.join(dir, 'jdk');
    const home = (await createPlans(context(dir, { language: 'java', mode: 'file', file: path.join(dir, 'Main.java') })))[0]; assert.equal(home.steps[0].command, path.join(dir, 'jdk', 'bin', process.platform === 'win32' ? 'java.exe' : 'java'));
  } finally { if (savedJavaHome === undefined) { delete process.env.JAVA_HOME; } else { process.env.JAVA_HOME = savedJavaHome; } }
  await assert.rejects(createPlans(context(dir, { language: 'csharp' })), /requires a .csproj/);
}));
test('C# and Cargo offer multiple targets', () => fixture(async dir => {
  await fs.writeFile(path.join(dir, 'A.csproj'), ''); await fs.writeFile(path.join(dir, 'B.csproj'), '');
  assert.equal((await createPlans(context(dir, { language: 'csharp', project: { root: dir, marker: 'A.csproj' } }))).length, 2);
  await fs.writeFile(path.join(dir, 'Cargo.toml'), '[package]\nname="demo"\n[[bin]]\nname="one"\npath="one.rs"\n[[bin]]\nname="two"\npath="two.rs"\n');
  const plans = await createPlans(context(dir, { language: 'rust', project: { root: dir, marker: 'Cargo.toml' } })); assert.equal(plans.length, 2); assert.deepEqual(plans[1].steps[0].args, ['run', '--bin', 'two']);
}));
test('TypeScript does not fall back to direct node execution', () => fixture(async dir => {
  await assert.rejects(createPlans(context(dir, { language: 'typescript' })), /TypeScript needs/);
  await fs.mkdir(path.join(dir, 'node_modules/tsx/dist'), { recursive: true }); await fs.writeFile(path.join(dir, 'node_modules/tsx/dist/cli.mjs'), '');
  const plan = (await createPlans(context(dir, { language: 'typescript' })))[0]; assert.equal(plan.name, 'tsx file'); assert.equal(plan.steps[0].args.length, 2);
}));
test('configured commands expand variables as individual arguments', () => fixture(async dir => {
  const plans = await createPlans(context(dir, { language: 'java', mode: 'project', settings: { ...settings, configurations: [{ name: 'Java', language: 'java', command: 'java', args: ['${file}', '${projectDir}', '${workspaceFolder}'] }] } }));
  assert.deepEqual(plans[0].steps[0].args, [path.join(dir, 'main.go'), dir, dir]);
}));
test('npm offers project scripts and validates explicit script', () => fixture(async dir => {
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ scripts: { start: 'node main.js', dev: 'node main.js' } }));
  const c = context(dir, { language: 'javascript', project: { root: dir, marker: 'package.json' } });
  const plans = await createPlans(c); assert.equal(plans.length, 2); assert.deepEqual(plans[0].steps[0].args.slice(-2), ['run', 'start']);
  await assert.rejects(createPlans({ ...c, settings: { ...settings, script: 'missing' } }), /does not exist/);
}));
test('Python explicit interpreter is preferred', () => fixture(async dir => {
  const plans = await createPlans(context(dir, { language: 'python', settings: { ...settings, pythonPath: process.execPath } })); assert.equal(plans[0].steps[0].command, process.execPath);
}));
test('untrusted workspace rejects Run before planning or execution', async () => {
  const { runInNewContext } = await import('node:vm');
  const source = await fs.readFile(path.resolve(__dirname, '../src/extension.js'), 'utf8');
  const commands = new Map<string, () => Promise<void>>();
  let warnings = 0; let runs = 0;
  class FakeExecutor { dispose() {} stop() {} async exclusive() { runs++; } }
  const fakeVSCode = { extensions: {getExtension:()=>undefined}, workspace: { isTrusted: false,onDidChangeConfiguration:()=>({dispose(){}}) }, window: { showWarningMessage: async () => { warnings++; } }, commands: {executeCommand:async()=>{}, registerCommand: (name: string, command: () => Promise<void>) => { commands.set(name, command); return { dispose() {} }; } } };
  const exports: { activate?: (context: { subscriptions: unknown[] }) => void } = {};
  runInNewContext(source, { exports, require: (name: string) => name === 'vscode' ? fakeVSCode : name === './embedded/editors' ? {initializeEmbeddedState:()=>{},registerEmbeddedEditors:()=>{}} : name === './environment/hostServices' ? {startHostToolchains:()=>({dispose(){}})} : name === './i18n'?{language:()=> 'zh-cn'}:name==='./ui'?{ui:fakeVSCode.window}:name === './controller' ? { AtelierController: class { dispose() {} updateStatus(){} } } : name === './executor' ? { TaskExecutor: FakeExecutor } : name === './model' ? { supports, RunnerError: Error } : {}, console });
  exports.activate!({ subscriptions: [] });
  for (const command of ['sakuraRunner.run', 'sakuraRunner.runFile', 'sakuraRunner.runProject']) { await commands.get(command)!(); }
  assert.equal(warnings, 3); assert.equal(runs, 0);
});
