import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {LanguageProjectOptions} from './options';
import {ensurePythonVenv,InitializationRun} from './pythonVenv';
import {nodeManagerStep} from './nodeManager';
import {javaFrameworkProviders,writeJavaConfigurations,javaBuildExecutable} from './javaProjects';
export interface InitializationRequest {language:'python'|'typescript'|'java';root:string;name:string;sdk:string;options:LanguageProjectOptions;tools:{uv?:string;maven?:string;gradle?:string}}
export async function initializeLanguageProject(input:InitializationRequest,run:InitializationRun,report:(message:string)=>void=()=>{},signal?:AbortSignal):Promise<void>{
  const {root,sdk,options,language}=input;
  if(signal?.aborted)throw new Error('创建已取消；已创建的文件保留。');
  try {
    if(language==='python'){
      report('创建并验证项目 .venv');
      const python=await ensurePythonVenv(root,sdk,options.pythonManager || 'pip',run,input.tools.uv);
      if(options.pythonManager==='uv')await run(input.tools.uv!,['sync','--python',sdk,'--no-install-project'],root);
      await run(python,[path.join(root,'src/main.py')],root);
      return;
    }
    if(language==='typescript'){
      const version=await run(sdk,['--version'],root);const match=version.match(/v(\d+)\.(\d+)/);if(!match || !(Number(match[1])>20 || Number(match[1])===20&&Number(match[2])>=6 || Number(match[1])===18&&Number(match[2])>=19))throw new Error('TypeScript 需要 Node 18.19+、20.6+ 或更新的 LTS。请选择兼容 SDK。');
      const manager=options.nodeManager || 'npm';
      const versionStep=await nodeManagerStep(sdk,manager,['--version'],root);
      const managerVersion=(await run(versionStep.command,versionStep.args,root,versionStep.env)).match(/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/m)?.[0] || '';
      if(!/^\d+\.\d+\.\d+/.test(managerVersion))throw new Error('无法确认包管理器版本。');
      if(manager==='pnpm' && Number(managerVersion.split('.')[0])>=11 && Number(match[1])<22)throw new Error('所选 pnpm 需要 Node 22+，请更换 Node SDK。');
      const packageFile=path.join(root,'package.json');const pkg=JSON.parse(await fs.readFile(packageFile,'utf8'));pkg.packageManager=manager+'@'+managerVersion;await fs.writeFile(packageFile,JSON.stringify(pkg,null,2)+'\n');
      report(`使用 ${manager} 安装 TypeScript / tsx / @types/node`);
      const install=await nodeManagerStep(sdk,manager,['install'],root);await run(install.command,install.args,root,install.env);
      report('验证 TypeScript 开发入口和类型检查');
      await run(sdk,[path.join(root,'node_modules/typescript/bin/tsc'),'--noEmit','-p',path.join(root,'tsconfig.json')],root);
      await run(sdk,['--import',pathToFileURL(path.join(root,'node_modules/tsx/dist/loader.mjs')).toString(),path.join(root,'src/index.ts')],root);
      return;
    }
    const properties=await run(sdk,['-XshowSettings:properties','-version'],root);
    const major=Number(properties.match(/java\.version\s*=\s*(\d+)/)?.[1] || properties.match(/version\s+"(\d+)/)?.[1]);
    const release=Number(options.javaVersion || 17);
    if(!major || major<release)throw new Error(`所选 JDK 不支持 Java ${release}，请更换 JDK 或降低语言版本。`);
    const javaHome=properties.match(/java\.home\s*=\s*(.+)/)?.[1]?.trim() || path.dirname(path.dirname(sdk));
    const env={JAVA_HOME:javaHome,PATH:path.join(javaHome,'bin')+path.delimiter+(process.env.PATH || '')};
    report(options.javaFramework==='spring-boot'?'从官方 Spring Initializr 生成工程':'生成标准 Java 工程');
    const provider=javaFrameworkProviders.find(p=>p.id===(options.javaFramework || 'application'))!;
    await provider.generate(root,input.name,options,signal);
    const build=options.javaBuild || 'maven';
    if(provider.id==='application'){
      report('生成官方构建 Wrapper');
      const command=build==='maven'?input.tools.maven:input.tools.gradle;
      if(!command)throw new Error(`未找到 ${build==='maven'?'Maven':'Gradle'}，请先配置构建工具。`);
      await run(command,build==='maven'?['-B','wrapper:wrapper']:['wrapper','--no-daemon'],root,env);
    }
    if(build!=='maven')for(const file of ['gradlew','gradlew.bat','gradle/wrapper/gradle-wrapper.jar','gradle/wrapper/gradle-wrapper.properties'])if(!await fs.stat(path.join(root,file)).then(s=>s.isFile()).catch(()=>false))throw new Error('Gradle Wrapper 不完整：'+file);
    await writeJavaConfigurations(root,input.name,options);
    const command=await javaBuildExecutable(root,build,async()=>{throw new Error('生成的项目缺少有效构建 Wrapper。');});
    report('下载依赖并验证 Java 构建');
    await run(command,build==='maven'?(provider.id==='spring-boot'?['-B','package','-DskipTests']:['-B','test']):(provider.id==='spring-boot'?['assemble','--no-daemon']:['build','--no-daemon']),root,env);
    if(provider.id==='application'){report('验证 Java 默认入口');await run(command,build==='maven'?['-B','exec:java']:['run','--no-daemon'],root,env);}
  } catch(error){throw new Error(`工程目录已保留：${root}\n初始化或验证未完成：${error instanceof Error?error.message:String(error)}`);}
}
