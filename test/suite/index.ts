import * as vscode from 'vscode';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { TaskExecutor } from '../../src/executor';
import { createPlans } from '../../src/planner';
import { Settings } from '../../src/model';
import { resolveTool } from '../../src/tools';
const settings: Settings = { script: '', pythonPath: '', cCompiler: '', cppCompiler: '', configurations: [] };
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export async function run(): Promise<void> {
  const root = process.env.SAKURA_TEST_WORKSPACE!;
  const folder = vscode.workspace.workspaceFolders![0];
  const results: { name: string; status: string; detail?: string }[] = [];
  const check = async (name: string, fn: () => Promise<void>) => {
    try { await fn(); results.push({ name, status: 'passed' }); console.log(`PASS ${name}`); }
    catch (error) { results.push({ name, status: 'failed', detail: String(error) }); console.error(`FAIL ${name}`, error); }
  };
  const makeFile = async (relative: string, body: string) => { const file = path.join(root, relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, body); return file; };
  const extension = vscode.extensions.getExtension('ExMikuPro.sakura-atelier');
  assert.ok(extension); await extension.activate();
  await check('commands registered in actual Extension Host', async () => {
    const commands = await vscode.commands.getCommands();
    for (const command of ['run', 'runFile', 'runProject', 'stop', 'configure']) { assert.ok(commands.includes(`sakuraRunner.${command}`)); }
    assert.ok(vscode.workspace.isTrusted);
  });
  await check('STM32 .ioc opens its read-only custom editor in the actual Extension Host', async () => {
    const content = 'Mcu.Name=STM32F401RETx\nMcu.UserName=STM32F401RET6\nProjectManager.ProjectName=HostFixture\n';
    const file = await makeFile('stm32 readonly/HostFixture.ioc', content);
    await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(file), 'sakuraAtelier.iocViewer');
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    assert.ok(tab?.input instanceof vscode.TabInputCustom);
    assert.equal(tab.input.viewType, 'sakuraAtelier.iocViewer');
    assert.equal(await fs.readFile(file, 'utf8'), content);
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });
  await check('new project wizard opens in the minimum supported Extension Host', async () => {
    const rejections: unknown[] = [];
    const rejected = (error: unknown) => { rejections.push(error); };
    process.on('unhandledRejection', rejected);
    try {
      await vscode.commands.executeCommand('sakuraAtelier.newProject');
      assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputWebview);
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      await delay(1500);
      assert.deepEqual(rejections, [], 'closing during device discovery must not post to a disposed Webview');
    } finally { process.removeListener('unhandledRejection', rejected); }
  });
  async function runCommand(file: string, command: string, expectedSteps = 1) {
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
    const exits: (number | undefined)[] = [];
    const sub = vscode.tasks.onDidEndTaskProcess(event => { if (event.execution.task.source === 'Sakura Atelier') { exits.push(event.exitCode); } });
    try { await vscode.commands.executeCommand(command); assert.equal(exits.length, expectedSteps); assert.deepEqual(exits, Array(expectedSteps).fill(0)); } finally { sub.dispose(); }
  }
  await check('Python project + Run File, interactive task path with spaces', async () => {
    await makeFile('python project/pyproject.toml', '[project]\nname="sakura-test"\nversion="0.1.0"\n');
    const file = await makeFile('python project/main.py', 'from pathlib import Path\nprint("Sakura Python OK")\nPath("python-result").write_text("ok")\n');
    await runCommand(file, 'sakuraRunner.run'); await runCommand(file, 'sakuraRunner.runFile'); assert.equal(await fs.readFile(path.join(path.dirname(file), 'python-result'), 'utf8'), 'ok');
  });
  await check('Python local virtual environment is selected', async () => {
    const dir = path.join(root, 'python project'); const python = await resolveTool(process.platform === 'win32' ? 'python' : 'python3', dir);
    execFileSync(python, ['-m', 'venv', '--without-pip', path.join(dir, '.venv')]);
    const file = await makeFile('python project/venv.py', 'import sys\nfrom pathlib import Path\nassert sys.prefix != sys.base_prefix\nPath("venv-result").write_text("ok")\n');
    await runCommand(file, 'sakuraRunner.run'); await runCommand(file, 'sakuraRunner.runFile'); assert.equal(await fs.readFile(path.join(dir, 'venv-result'), 'utf8'), 'ok');
  });
  await check('Go project + Run File in Development Host', async () => {
    await makeFile('go project/go.mod', 'module sakura.test/demo\n\ngo 1.22\n');
    const file = await makeFile('go project/main.go', 'package main\nimport ("fmt"; "os")\nfunc main() { fmt.Println("Sakura Go OK"); if err := os.WriteFile("go-result", []byte("ok"), 0600); err != nil { panic(err) } }\n');
    await runCommand(file, 'sakuraRunner.run'); await runCommand(file, 'sakuraRunner.runFile'); assert.equal(await fs.readFile(path.join(path.dirname(file), 'go-result'), 'utf8'), 'ok');
  });
  await check('Rust Cargo project + standalone file in Development Host', async () => {
    await makeFile('rust project/Cargo.toml', '[package]\nname="sakura-test"\nversion="0.1.0"\nedition="2021"\n');
    const file = await makeFile('rust project/src/main.rs', 'fn main() { println!("Sakura Rust OK"); std::fs::write("rust-result", "ok").unwrap(); }\n');
    await runCommand(file, 'sakuraRunner.run'); await runCommand(file, 'sakuraRunner.runFile', 2);
    assert.equal(await fs.readFile(path.join(root, 'rust project/rust-result'), 'utf8'), 'ok');
    assert.equal(await fs.readFile(path.join(path.dirname(file), 'rust-result'), 'utf8'), 'ok');
  });
  await check('JavaScript npm project + Node file in Development Host', async () => {
    await makeFile('js project/package.json', JSON.stringify({ scripts: { start: 'node main.js' } }));
    const file = await makeFile('js project/main.js', 'console.log("Sakura JavaScript OK"); require("node:fs").writeFileSync("js-result", "ok");\n');
    await runCommand(file, 'sakuraRunner.run'); await runCommand(file, 'sakuraRunner.runFile'); assert.equal(await fs.readFile(path.join(path.dirname(file), 'js-result'), 'utf8'), 'ok');
  });
  await check('TypeScript executes using an installed local tsx', async () => {
    const dir = path.join(root, 'ts project'); await fs.mkdir(path.join(dir, 'node_modules'), { recursive: true });
    await makeFile('ts project/package.json', '{}');
    const modules = path.resolve(__dirname, '../../../node_modules');
    for (const name of ['tsx', 'esbuild', '@esbuild']) { await fs.cp(path.join(modules, name), path.join(dir, 'node_modules', name), { recursive: true }); }
    const file = await makeFile('ts project/main.ts', 'import { writeFileSync } from "node:fs"; const message: string = "ok"; console.log(message); writeFileSync("ts-result", message);');
    await runCommand(file, 'sakuraRunner.run'); await runCommand(file, 'sakuraRunner.runFile');
    assert.equal(await fs.readFile(path.join(dir, 'ts-result'), 'utf8'), 'ok');
  });
  await check('C and C++ compile and run through VS Code Tasks', async () => {
    for (const [ext, source] of [['c', '#include <stdio.h>\nint main(void) { puts("Sakura C OK"); return 0; }'], ['cpp', '#include <iostream>\nint main() { std::cout << "Sakura C++ OK\\n"; }']]) {
      await runCommand(await makeFile(`compiled/main.${ext}`, source), 'sakuraRunner.runFile', 2);
    }
  });
  await check('JDK source file launches through VS Code Tasks', async () => {
    if (process.env.SAKURA_TEST_JAVA_BIN) { await vscode.workspace.getConfiguration('sakuraRunner', folder.uri).update('javaPath', path.join(process.env.SAKURA_TEST_JAVA_BIN, process.platform === 'win32' ? 'java.exe' : 'java'), vscode.ConfigurationTarget.Workspace); }
    const file = await makeFile('java file/Main.java', 'class Main { public static void main(String[] args) { System.out.println("Sakura Java OK"); } }');
    await runCommand(file, 'sakuraRunner.runFile');
  });
  await check('Maven project prefers its existing VS Code run task', async () => {
    await makeFile('maven project/pom.xml', '<project/>');
    const file = await makeFile('maven project/Main.java', 'class Main {}');
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
    await vscode.commands.executeCommand('sakuraRunner.runProject');
    assert.equal(await fs.readFile(path.join(root, 'maven project/task-result'), 'utf8'), 'ok');
  });
  await check('standard input reaches a running task terminal', async () => {
    const file = await makeFile('stdin/main.js', 'process.stdin.once("data", data => { require("node:fs").writeFileSync("stdin-result", data.toString().trim()); process.exit(0); }); console.log("INPUT READY");');
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
    const started = new Promise<void>(resolve => { const sub = vscode.tasks.onDidStartTaskProcess(event => { if (event.execution.task.source === 'Sakura Atelier') { sub.dispose(); resolve(); } }); });
    const pending = vscode.commands.executeCommand('sakuraRunner.runFile');
    await started; await delay(300); assert.ok(vscode.window.activeTerminal); vscode.window.activeTerminal.sendText('sakura input');
    await pending;
    assert.equal(await fs.readFile(path.join(root, 'stdin/stdin-result'), 'utf8'), 'sakura input');
  });
  await check('shared task presentation reuses a bounded number of terminals', async () => {
    assert.ok(vscode.window.terminals.length <= 3, `Expected terminal reuse, found ${vscode.window.terminals.length}`);
  });
  await check('compiler failure does not execute an old binary', async () => {
    const file = await makeFile('compile failure/main.c', '#include <stdio.h>\nint main(void) { FILE *f=fopen("stale-ran", "w"); if(f) { fputs("bad", f); fclose(f); } return 0; }');
    const dir = path.dirname(file); const cache = path.join(dir, 'cache');
    const plans = await createPlans({ file, language: 'c', mode: 'file', cache, settings });
    const executor = new TaskExecutor();
    try {
      await executor.exclusive(() => executor.run(plans[0], folder)); await fs.unlink(path.join(dir, 'stale-ran'));
      await fs.writeFile(file, 'this is invalid C code !');
      await assert.rejects(executor.exclusive(() => executor.run(plans[0], folder)), /failed/);
      await assert.rejects(fs.stat(path.join(dir, 'stale-ran')), { code: 'ENOENT' });
    } finally { executor.dispose(); }
  });
  await check('missing SDK fails explicitly before task starts', async () => {
    const executor = new TaskExecutor();
    try { await assert.rejects(executor.exclusive(() => executor.run({ name: 'Missing SDK', steps: [{ command: 'sakura-no-such-sdk', args: [], cwd: root, label: 'Missing' }] }, folder)), /Missing toolchain/); }
    finally { executor.dispose(); }
  });
  await check('duplicate clicks are suppressed before asynchronous planning', async () => {
    const file = await makeFile('duplicate/main.js', 'setTimeout(() => console.log("done"), 500);');
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
    let starts = 0; const sub = vscode.tasks.onDidStartTask(event => { if (event.execution.task.source === 'Sakura Atelier') { starts++; } });
    try { await Promise.all([vscode.commands.executeCommand('sakuraRunner.runFile'), vscode.commands.executeCommand('sakuraRunner.runFile')]); assert.equal(starts, 1); } finally { sub.dispose(); }
  });
  await check('deactivation terminates task parent and child processes', async () => {
    const pidFile = path.join(root, 'parent.pid'); const childPidFile = path.join(root, 'child.pid');
    const file = await makeFile('lifecycle/main.js', `const fs=require('node:fs'); const {spawn}=require('node:child_process'); const child=spawn(process.execPath, ['-e','setInterval(()=>{},1000)'], {stdio:'inherit'}); fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid)); fs.writeFileSync(${JSON.stringify(childPidFile)},String(child.pid)); setInterval(()=>{},1000);`);
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
    const pending = vscode.commands.executeCommand('sakuraRunner.runFile');
    for (let i = 0; i < 100; i++) { try { await fs.stat(childPidFile); break; } catch { await delay(100); } }
    const pids = await Promise.all([pidFile, childPidFile].map(async file => Number(await fs.readFile(file, 'utf8'))));
    // Stop command avoids an error notification awaiting user acknowledgement.
    // The same disposal path is invoked by deactivate and extension shutdown.
    // Capture stop information messages without a modal (the extension treats cancellation quietly).
    const implementation = await import(path.join(extension.extensionPath, 'out/src/extension.js')) as { deactivate(): void };
    implementation.deactivate();
    await pending;
    for (let i = 0; i < 100; i++) {
      const alive = pids.filter(pid => { try { process.kill(pid, 0); return true; } catch { return false; } });
      if (!alive.length) { break; } await delay(100);
    }
    for (const pid of pids) { assert.throws(() => process.kill(pid, 0)); }
    assert.equal(vscode.tasks.taskExecutions.filter(x => x.task.source === 'Sakura Atelier').length, 0);
  });
  const report = { platform: process.platform, arch: process.arch, vscode: vscode.version, results };
  await fs.mkdir(path.dirname(process.env.SAKURA_TEST_REPORT!), { recursive: true }); await fs.writeFile(process.env.SAKURA_TEST_REPORT!, JSON.stringify(report, null, 2));
  const failed = results.filter(result => result.status === 'failed'); assert.equal(failed.length, 0, JSON.stringify(failed));
}
