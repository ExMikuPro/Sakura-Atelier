import {test} from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {initializedScaffold} from '../src/languageProjects/scaffolds';
import {planCreation,executeCreation,CreationContext} from '../src/embedded/projects/creation';
import {builtinProjectTemplates} from '../src/embedded/projects/template';
import {ensurePythonVenv,venvPython} from '../src/languageProjects/pythonVenv';
import {initializeLanguageProject} from '../src/languageProjects/initialize';
import {javaApplicationFiles,writeJavaConfigurations,javaBuildExecutable} from '../src/languageProjects/javaProjects';
import {supportsBoot,springParameters,inspectProjectZip,InitializrMetadata} from '../src/languageProjects/springInitializr';
import {validateFile} from '../src/configuration';
import {javaProjectPlan} from '../src/languageProjects/javaRuntime';
import {InitializationRequest} from '../src/languageProjects/initialize';
const exec=promisify(execFile);
const runtimeRun=async(command:string,args:string[],cwd:string)=>{const {stdout,stderr}=await exec(command,args,{cwd});return stdout+stderr;};
async function fixture(work:(root:string)=>Promise<void>){const root=await fs.mkdtemp(path.join(os.tmpdir(),'语言 创建 空格 '));try{await work(root);}finally{await fs.rm(root,{recursive:true,force:true});}}
const context=(language:string):CreationContext=>({template:builtinProjectTemplates.find(t=>t.id==='general.'+language),tools:{runtimes:{python:'/python',node:process.execPath,java:'/jdk/bin/java'},maven:'/maven',gradle:'/gradle',pnpm:'/pnpm',uv:'/uv'},boards:new Map(),fs:{exists:file=>fs.lstat(file).then(()=>true,()=>false),isDirectory:file=>fs.stat(file).then(s=>s.isDirectory(),()=>false)},isStm32Project:async()=>false});
test('only Python/TypeScript/Java require initialization; SDK selection is validated against discovered choices',()=>fixture(async root=>{
  for(const language of ['python','typescript','java']){
    const missing=await planCreation({templateId:'general.'+language,parentDir:root,name:'app'}, {...context(language),tools:{}});assert.ok(missing.blockers.some(b=>b.code==='initialization'));
    const selected=await planCreation({templateId:'general.'+language,parentDir:root,name:'app',options:{sdkId:'chosen'}},{...context(language),sdkChoices:[{id:'chosen',name:'Chosen SDK',version:'22',language:language==='typescript'?'node':language as 'python'|'java',executable:'/selected path/sdk'}]});
    assert.deepEqual(selected.blockers,[]);assert.equal(selected.steps.find(s=>s.kind==='initialize')?.request.sdk,'/selected path/sdk');
  }
  assert.deepEqual((await planCreation({templateId:'general.go',parentDir:root,name:'go'},{...context('go'),tools:{}})).blockers,[]);
}));
test('Python creates and reuses a real project venv and portable run config across reopening',()=>fixture(async root=>{
  const python=process.platform==='win32'?'python':'/usr/bin/python3';
  const plan=await planCreation({templateId:'general.python',name:'python-app',parentDir:root},{...context('python'),tools:{runtimes:{python}}});
  await executeCreation(plan,{mkdir:p=>fs.mkdir(p),writeFile:(p,c)=>fs.writeFile(p,c,{flag:'wx'}),run:async()=>{},initializeProject:input=>initializeLanguageProject(input,runtimeRun)});
  const interpreter=venvPython(plan.target);assert.match(await runtimeRun(interpreter,['src/main.py'],plan.target),/Hello from Sakura Atelier/);
  const document=validateFile(JSON.parse(await fs.readFile(path.join(plan.target,'.vscode/sakura-atelier.json'),'utf8')));assert.ok(document.configurations[0].toolchain.endsWith('/.venv'));assert.ok(!JSON.stringify(document).includes(root));
  assert.equal(await ensurePythonVenv(plan.target,'/must-not-run','pip',runtimeRun),interpreter);
  assert.ok((await fs.readFile(path.join(plan.target,'.gitignore'),'utf8')).includes('.venv/'));
}));
test('broken venv is not overwritten and uv uses an isolated matching workflow',()=>fixture(async root=>{
  await fs.mkdir(path.join(root,'.venv'));await fs.writeFile(path.join(root,'.venv/sentinel'),'user');
  await assert.rejects(ensurePythonVenv(root,'/python','pip',async()=>{throw new Error('broken');}),/重新创建/);
  assert.equal(await fs.readFile(path.join(root,'.venv/sentinel'),'utf8'),'user');
  const other=path.join(root,'other');await fs.mkdir(other);const calls:string[][]=[];
  await ensurePythonVenv(other,'/chosen/python','uv',async(_command,args)=>{calls.push(args);return '';},'/uv');
  assert.deepEqual(calls[0],['venv','--python','/chosen/python',path.join(other,'.venv')]);
  assert.ok(!calls.some(args=>args.includes('pip')));
}));
test('TypeScript scripts, output root, source maps and manager agree; npm and pnpm generate separate correct policies',()=>{
  for(const nodeManager of ['npm','pnpm'] as const){
    const files=initializedScaffold('typescript','app',{nodeManager});const read=(name:string)=>JSON.parse(files.find(f=>f.path===name)!.content);
    const pkg=read('package.json'),ts=read('tsconfig.json'),config=validateFile(read('.vscode/sakura-atelier.json'));
    assert.equal(pkg.scripts.dev,'tsx src/index.ts');assert.equal(pkg.scripts.start,'node dist/index.js');assert.ok(pkg.devDependencies['@types/node']);assert.equal(ts.compilerOptions.rootDir,'src');assert.equal(ts.compilerOptions.sourceMap,true);assert.equal(config.configurations[0].packageManager,nodeManager);assert.equal(config.configurations[0].templateId,'typescript.project');
    assert.equal(files.some(f=>f.path==='pnpm-workspace.yaml'),nodeManager==='pnpm');
  }
});
test('failed dependency initialization cannot report creation success and cancellation preserves user files',()=>fixture(async root=>{
  const plan=await planCreation({templateId:'general.typescript',name:'failed',parentDir:root},context('typescript'));let opened=false;
  await assert.rejects(executeCreation(plan,{mkdir:p=>fs.mkdir(p),writeFile:(p,c)=>fs.writeFile(p,c,{flag:'wx'}),run:async()=>{},initializeProject:async()=>{throw new Error('network failed');}}).then(()=>{opened=true;}),/network failed/);
  assert.equal(opened,false);await fs.stat(path.join(plan.target,'package.json'));
  const cancelled={...plan,target:path.join(root,'cancelled'),steps:[{kind:'mkdir' as const,path:path.join(root,'cancelled')}]};
  await assert.rejects(executeCreation(cancelled,{mkdir:p=>fs.mkdir(p),run:async()=>{},cancelled:()=>true}),/取消/);
  await assert.rejects(fs.stat(cancelled.target));
}));
test('Java application templates use standard coordinates, packages and all supported build DSLs; configs find a single real entry',()=>fixture(async root=>{
  for(const javaBuild of ['maven','gradle-groovy','gradle-kotlin'] as const){
    const folder=path.join(root,javaBuild);const files=javaApplicationFiles('demo',{javaBuild,groupId:'com.acme',artifactId:'demo',packageName:'com.acme.app',javaVersion:'17',description:'Hello & <world>'});
    for(const file of files){const dest=path.join(folder,file.path);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,file.content);}
    assert.equal(await writeJavaConfigurations(folder,'demo',{javaBuild,packageName:'com.acme.app'}),'com.acme.app.Main');
    const config=validateFile(JSON.parse(await fs.readFile(path.join(folder,'.vscode/sakura-atelier.json'),'utf8')));assert.equal(config.configurations.length,4);assert.equal(config.configurations[0].templateId,'java.project');assert.ok(!files.some(f=>f.path.includes('.idea')||f.path.endsWith('.iml')));
    if(javaBuild==='maven')assert.ok(files.find(f=>f.path==='pom.xml')!.content.includes('Hello &amp; &lt;world&gt;'));
    const wrapper=path.join(folder,javaBuild==='maven'?'mvnw':'gradlew');await fs.writeFile(wrapper,'wrapper');assert.equal(await javaBuildExecutable(folder,javaBuild,async()=>{throw new Error('must prefer wrapper');}),wrapper);
    const plan=await javaProjectPlan({...config.configurations[0],cwd:folder},{folder:{} as import('vscode').WorkspaceFolder,root:folder,file:'',cache:root,toolchain:process.execPath,environment:{}});assert.equal(plan.steps[0].command,wrapper);
  }
}));
const metadata:InitializrMetadata={bootVersions:[{id:'4.1.2',name:'4.1.2'}],javaVersions:[{id:'17',name:'17'}],builds:[{id:'maven-project',name:'Maven'}],dependencies:[{id:'web',name:'Web',versionRange:'[4.0.0,5.0.0)'}]};
test('Spring versions/dependencies/builds come from official metadata and compatibility is enforced',()=>{
  assert.equal(supportsBoot('[4.0.0,5.0.0)','4.1.2'),true);assert.equal(supportsBoot('[4.0.0,5.0.0)','5.0.0'),false);
  const query=springParameters('app',{frameworkVersion:'4.1.2',javaVersion:'17',dependencies:'web'},metadata);assert.equal(query.get('dependencies'),'web');
  assert.throws(()=>springParameters('app',{dependencies:'untrusted'},metadata),/不兼容/);assert.throws(()=>springParameters('app',{javaVersion:'99'},metadata),/支持/);
});
function zip(name:string,mode=0o100644):Buffer{
  const filename=Buffer.from(name),body=Buffer.from('test');const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt32LE(body.length,18);header.writeUInt32LE(body.length,22);header.writeUInt16LE(filename.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt32LE(body.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(filename.length,28);central.writeUInt32LE((mode*65536)>>>0,38);
  const local=Buffer.concat([header,filename,body]),directory=Buffer.concat([central,filename]),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(local.length,16);return Buffer.concat([local,directory,end]);
}
test('archive extraction validates traversal, absolute paths, symlinks and size before writing',()=>{
  assert.equal(inspectProjectZip(zip('src/Main.java'))[0].data.toString(),'test');
  for(const filename of ['../Main.java','/etc/evil','C:/evil','folder\\evil'])assert.throws(()=>inspectProjectZip(zip(filename)),/不安全/);
  assert.throws(()=>inspectProjectZip(zip('link',0o120777)),/不安全/);assert.throws(()=>inspectProjectZip(zip('large'),{file:1,total:1,count:5}),/超过/);
});
test('initialization uses safe argv for paths with spaces and does not proceed after a failed wrapper',()=>fixture(async root=>{
  const calls:string[][]=[];const request:InitializationRequest={language:'java',root,name:'app',sdk:'/jdk/java',options:{javaBuild:'maven',javaVersion:'17'},tools:{maven:'/mvn'}};
  await assert.rejects(initializeLanguageProject(request,async(_command,args)=>{calls.push(args);if(args.includes('wrapper:wrapper'))throw new Error('wrapper download failed');return 'java.version = 17.0.1\njava.home = /jdk home';}),/wrapper download failed/);
  assert.equal(calls.length,2);assert.ok(!calls.flat().includes('sh'));await fs.stat(path.join(root,'pom.xml'));
}));
test('initialization cancellation terminates its own real child process and keeps the project directory',()=>fixture(async root=>{
  const {initializationRunner}=await import('../src/languageProjects/process');
  const abort=new AbortController();let pid=0;let ready:()=>void=()=>{};
  const started=new Promise<void>(resolve=>{ready=resolve;});
  const run=initializationRunner(text=>{pid=Number(text.trim());ready();},abort.signal,()=>{});
  const pending=run(process.execPath,['-e','console.log(process.pid);setInterval(()=>{},1000)'],root);
  const rejected=assert.rejects(pending,/取消/);await started;abort.abort();await rejected;
  let alive=true;for(let i=0;i<50;i++){try{process.kill(pid,0);}catch{alive=false;break;}await new Promise(resolve=>setTimeout(resolve,20));}
  assert.equal(alive,false);assert.ok(await fs.stat(root));
}));
test('new Java project runtime refuses an aggregator root instead of guessing a runnable module',()=>fixture(async root=>{
  await fs.writeFile(path.join(root,'pom.xml'),'<project><packaging>pom</packaging><modules><module>app</module></modules></project>');
  const {newConfiguration}=await import('../src/configuration');
  await assert.rejects(javaProjectPlan({...newConfiguration('java'),templateId:'java.project',cwd:root,target:'com.example.Main',package:'maven'},{root,file:'',cache:root,environment:{},toolchain:process.execPath,folder:{} as import('vscode').WorkspaceFolder}),/聚合工程/);
}));
