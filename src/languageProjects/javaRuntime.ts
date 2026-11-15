import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {AtelierConfiguration} from '../configuration';
import type {AdapterContext,DebugPlan} from '../adapterTypes';
import {RunPlan} from '../model';
import {resolveTool} from '../tools';
import {javaBuildExecutable} from './javaProjects';
async function requireRunnableModule(root:string):Promise<void>{
  const pom=await fs.readFile(path.join(root,'pom.xml'),'utf8').catch(()=>'');
  const settings=await fs.readFile(path.join(root,'settings.gradle'),'utf8').catch(()=>fs.readFile(path.join(root,'settings.gradle.kts'),'utf8').catch(()=>''));
  const hasSources=await fs.stat(path.join(root,'src/main/java')).then(s=>s.isDirectory()).catch(()=>false);
  if(/<packaging>\s*pom\s*<\/packaging>/.test(pom) || (!hasSources && /\binclude\s*[( ]/.test(settings)))throw new Error('当前目录是多模块聚合工程。请将运行配置的工作目录设为实际应用模块，并选择该模块的入口类；不会运行聚合根。');
}
export async function javaProjectPlan(c:AtelierConfiguration,ctx:AdapterContext):Promise<RunPlan>{
  const root=c.cwd || ctx.root,build=c.package || 'maven';
  if(c.operation==='run')await requireRunnableModule(root);
  const command=await javaBuildExecutable(root,build,name=>resolveTool(name,root));
  const java=await fs.realpath(await resolveTool(ctx.toolchain || 'java',root));
  const home=path.dirname(path.dirname(java));
  const env={...ctx.environment,JAVA_HOME:home,PATH:path.join(home,'bin')+path.delimiter+(process.env.PATH || '')};
  const maven=build==='maven';
  const args=maven ? ['-B',...(c.operation==='test'?['test']:c.operation==='build'?['package','-DskipTests']:c.framework==='spring-boot'?['spring-boot:run']:['compile','exec:java',`-Dexec.mainClass=${c.target}`]),...c.buildArgs] : [c.operation==='test'?'test':c.operation==='build'?'assemble':c.framework==='spring-boot'?'bootRun':'run','--no-daemon',...c.buildArgs];
  if(c.args.length && c.operation==='run'){
    // Maven/Gradle accept one argv string for application arguments. Quote it for their parser, never a shell.
    const applicationArgs=c.args.map(arg=>'"'+arg.replace(/([\\"])/g,'\\$1')+'"').join(' ');
    args.push(maven?`-Dexec.args=${applicationArgs}`:`--args=${applicationArgs}`);
  }
  return {name:c.name,steps:[{command,args,cwd:root,env,label:c.name,terminal:true}]};
}
export async function javaProjectDebugPlan(c:AtelierConfiguration,ctx:AdapterContext,type:string):Promise<DebugPlan>{
  await requireRunnableModule(c.cwd || ctx.root);
  const build=await javaProjectPlan({...c,operation:'build'},ctx);
  return {configuration:{name:c.name,type,request:'launch',mainClass:c.target,projectName:c.binary || undefined,cwd:c.cwd,javaExec:ctx.toolchain || await resolveTool('java',c.cwd),console:c.terminal?'integratedTerminal':'internalConsole',args:c.args,env:ctx.environment},build:build.steps};
}
