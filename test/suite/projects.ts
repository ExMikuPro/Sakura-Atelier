import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { projectLanguages } from '../../src/projectScaffolds';
import { builtinProjectTemplates } from '../../src/embedded/projects/template';
import { executeCreation, planCreation } from '../../src/embedded/projects/creation';
import { validateFile } from '../../src/configuration';
import { resolveTool } from '../../src/tools';
const exec = promisify(execFile);
export async function run(): Promise<void> {
  await vscode.extensions.getExtension('ExMikuPro.sakura-atelier')!.activate();
  const root = process.env.SAKURA_TEST_WORKSPACE!;
  const node = await resolveTool('node', root);
  const results: { language: string; created: boolean; execution: string }[] = [];
  for (const spec of projectLanguages) {
    const plan = await planCreation({ templateId: 'general.' + spec.language, name: 'scaffold-' + spec.language, parentDir: root }, {
      template: builtinProjectTemplates.find(t => t.id === 'general.' + spec.language), tools: {}, boards: new Map(),
      fs: { exists: p => fs.lstat(p).then(() => true, () => false), isDirectory: p => fs.stat(p).then(s => s.isDirectory(), () => false) }, isStm32Project: async () => false,
    });
    await executeCreation(plan, { mkdir: p => fs.mkdir(p).then(() => {}), writeFile: (p, content) => fs.writeFile(p, content, { flag: 'wx' }), run: async () => { throw new Error('Creation unexpectedly ran a command'); }, confirm: async () => false, launch: () => { throw new Error('Creation unexpectedly launched an application'); } });
    const config = validateFile(JSON.parse(await fs.readFile(path.join(plan.target, '.vscode/sakura-atelier.json'), 'utf8')));
    assert.equal(config.configurations[0].templateId, spec.template);
    const run = (command: string, args: string[]) => exec(command, args, { cwd: plan.target, timeout: 120000, env: { ...process.env, GOTOOLCHAIN: 'local' } });
    let output = '';
    if (spec.language === 'python') output = (await run(await resolveTool('python3', root), ['src/main.py'])).stdout;
    else if (spec.language === 'node') output = (await run(node, ['src/main.js'])).stdout;
    else if (spec.language === 'typescript') output = (await run(node, [path.resolve(__dirname, '../../../node_modules/tsx/dist/cli.mjs'), 'src/main.ts'])).stdout;
    else if (spec.language === 'go') output = (await run(await resolveTool('go', root), ['run', '.'])).stdout;
    else if (spec.language === 'rust') output = (await run(await resolveTool('cargo', root), ['run', '--offline', '--quiet'])).stdout;
    else if (spec.language === 'java') output = (await run(process.env.SAKURA_TEST_JAVA_BIN ? path.join(process.env.SAKURA_TEST_JAVA_BIN, 'java') : await resolveTool('java', root), ['Main.java'])).stdout;
    else if (spec.language === 'c' || spec.language === 'cpp') {
      const compiler = await resolveTool(spec.language === 'c' ? 'clang' : 'clang++', root);
      const binary = path.join(plan.target, 'app');
      await run(compiler, [spec.language === 'c' ? '-std=c11' : '-std=c++17', spec.entry, '-o', binary]);
      output = (await run(binary, [])).stdout;
    }
    if (spec.language === 'csharp') results.push({ language: spec.language, created: true, execution: 'not verified: .NET SDK 8+ runtime build not performed' });
    else { assert.match(output, /Hello from Sakura Atelier/); results.push({ language: spec.language, created: true, execution: 'passed' }); }
  }
  await fs.writeFile(process.env.SAKURA_TEST_REPORT!, JSON.stringify({ platform: process.platform, arch: process.arch, vscode: vscode.version, results, dependencies: 'No project dependencies or system SDKs installed. TypeScript uses the existing repository tsx for this fixture check.' }, null, 2));
  console.log('PASS language project scaffolds: 9 created, 8 executed; C# build explicitly unverified.');
}
