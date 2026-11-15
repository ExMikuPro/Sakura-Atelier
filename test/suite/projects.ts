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
import {initializeLanguageProject} from '../../src/languageProjects/initialize';
import {installJavaTool} from '../../src/languageProjects/javaTools';
import {venvPython} from '../../src/languageProjects/pythonVenv';
import { resolveTool } from '../../src/tools';
const exec = promisify(execFile);
export async function run(): Promise<void> {
  await vscode.extensions.getExtension('ExMikuPro.sakura-atelier')!.activate();
  const root = process.env.SAKURA_TEST_WORKSPACE!;
  const node = await resolveTool('node', root);
  const results: { language: string; created: boolean; execution: string }[] = [];
  for (const spec of projectLanguages) {
    if(spec.language==='java' && !process.env.SAKURA_TEST_JAVA_BIN){results.push({language:'java',created:false,execution:'not verified: set SAKURA_TEST_JAVA_BIN to a working JDK bin directory'});continue;}
    const python=spec.language==='python'?await resolveTool('python3',root):undefined;
    const java=spec.language==='java'?path.join(process.env.SAKURA_TEST_JAVA_BIN!,'java'):undefined;
    const maven=java?await installJavaTool(path.resolve(__dirname,'../../../.test-output/java-tools'),'maven',()=>{}):undefined;
    const plan = await planCreation({ templateId: 'general.' + spec.language, name: 'scaffold-' + spec.language, parentDir: root }, {
      template: builtinProjectTemplates.find(t => t.id === 'general.' + spec.language), tools: {runtimes:{node,...(python?{python}:{}),...(java?{java}:{})},maven}, boards: new Map(),
      fs: { exists: p => fs.lstat(p).then(() => true, () => false), isDirectory: p => fs.stat(p).then(s => s.isDirectory(), () => false) }, isStm32Project: async () => false,
    });
    await executeCreation(plan, { mkdir: p => fs.mkdir(p).then(() => {}), writeFile: (p, content) => fs.writeFile(p, content, { flag: 'wx' }), run: async () => { throw new Error('Creation unexpectedly ran a command'); },initializeProject:input=>initializeLanguageProject(input,async(command,args,cwd,env)=>{const result=await exec(command,args,{cwd,env:{...process.env,...env},timeout:12*60*1000,maxBuffer:16*1024*1024});return result.stdout+result.stderr;}) });
    const config = validateFile(JSON.parse(await fs.readFile(path.join(plan.target, '.vscode/sakura-atelier.json'), 'utf8')));
    assert.equal(config.configurations[0].templateId,spec.language==='typescript'?'typescript.project':spec.language==='java'?'java.project':spec.template);
    const run = (command: string, args: string[]) => exec(command, args, { cwd: plan.target, timeout: 120000, env: { ...process.env, GOTOOLCHAIN: 'local' } });
    let output = '';
    if (spec.language === 'python') output = (await run(venvPython(plan.target), ['src/main.py'])).stdout;
    else if (spec.language === 'node') output = (await run(node, ['src/main.js'])).stdout;
    else if (spec.language === 'typescript') output = (await run(node, [path.join(plan.target,'node_modules/tsx/dist/cli.mjs'), 'src/index.ts'])).stdout;
    else if (spec.language === 'go') output = (await run(await resolveTool('go', root), ['run', '.'])).stdout;
    else if (spec.language === 'rust') output = (await run(await resolveTool('cargo', root), ['run', '--offline', '--quiet'])).stdout;
    else if (spec.language === 'java'){const home=path.dirname(path.dirname(await fs.realpath(java!)));output=(await exec(path.join(plan.target,'mvnw'),['-B','exec:java'],{cwd:plan.target,env:{...process.env,JAVA_HOME:home},timeout:120000})).stdout;}
    else if (spec.language === 'c' || spec.language === 'cpp') {
      const compiler = await resolveTool(spec.language === 'c' ? 'clang' : 'clang++', root);
      const binary = path.join(plan.target, 'app');
      await run(compiler, [spec.language === 'c' ? '-std=c11' : '-std=c++17', spec.entry, '-o', binary]);
      output = (await run(binary, [])).stdout;
    }
    if (spec.language === 'csharp') results.push({ language: spec.language, created: true, execution: 'not verified: .NET SDK 8+ runtime build not performed' });
    else { assert.match(output, /Hello from Sakura Atelier/); results.push({ language: spec.language, created: true, execution: 'passed' }); }
  }
  await fs.writeFile(process.env.SAKURA_TEST_REPORT!, JSON.stringify({ platform: process.platform, arch: process.arch, vscode: vscode.version, results, dependencies: 'Python venv and project-local TypeScript dependencies initialized. Java tools isolated in .test-output; no system SDK or global PATH modified.' }, null, 2));
  console.log('PASS project creation regression:',results);
}
