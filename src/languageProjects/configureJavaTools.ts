import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {AtelierController} from '../controller';
import {resolveTool} from '../tools';
import {hostToolchains} from '../environment/registryAccess';
import {installJavaTool,JavaBuildTool} from './javaTools';
import {initializationRunner} from './process';
export async function configureJavaTools(controller:AtelierController,preferred?:'maven'|'gradle'):Promise<void>{
  if(!vscode.workspace.isTrusted)throw new Error('工作区未受信任，不能配置构建工具。');
  const choice=preferred==='maven'||preferred==='gradle' ? {label:preferred,tool:preferred,wrapper:false} : await vscode.window.showQuickPick([{label:'Maven：配置本机工具',tool:'maven' as const,wrapper:false},{label:'Gradle：配置本机工具',tool:'gradle' as const,wrapper:false},{label:'当前工程：配置 mvnw / gradlew',tool:undefined,wrapper:true}],{title:'一键配置 Java 构建工具（安装到 Sakura 本机存储，不修改 PATH）'});
  if(!choice)return;
  let root:string|undefined,tool:JavaBuildTool|undefined=choice.tool;
  if(choice.wrapper){
    root=(await controller.editorContext()).root;
    tool=await fs.stat(path.join(root,'pom.xml')).then(()=>true).catch(()=>false)?'maven':await fs.stat(path.join(root,'build.gradle')).then(()=>true).catch(()=>false)||await fs.stat(path.join(root,'build.gradle.kts')).then(()=>true).catch(()=>false)?'gradle':undefined;
    if(!tool)throw new Error('当前目录没有 pom.xml 或 Gradle 构建文件，请先打开 Java 工程。');
    const wrapper=path.join(root,tool==='maven'?'mvnw':'gradlew');
    if(await fs.lstat(wrapper).catch(()=>undefined)){void vscode.window.showInformationMessage('工程已包含 Wrapper，将保留现有文件。');return;}
    const partial=tool==='maven'?['mvnw.cmd','.mvn/wrapper/maven-wrapper.properties']:['gradlew.bat','gradle/wrapper/gradle-wrapper.jar','gradle/wrapper/gradle-wrapper.properties'];
    for(const file of partial)if(await fs.lstat(path.join(root,file)).catch(()=>undefined))throw new Error('发现不完整的 Wrapper。请先备份并移走现有 Wrapper 文件，避免覆盖用户配置。');
  }
  const target=tool!;const context=controller.context;const output=vscode.window.createOutputChannel('Sakura Atelier — Java 构建工具');context.subscriptions.push(output);output.show(true);
  await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:`配置 ${target}${choice.wrapper?' Wrapper':''}`,cancellable:true},async(progress,token)=>{
    const abort=new AbortController(),listener=token.onCancellationRequested(()=>abort.abort());
    const report=(message:string)=>progress.report({message});
    try{
      const saved=context.globalState.get<Record<string,string>>('atelier.java.buildTools',{});
      let executable=await resolveTool(target==='maven'?'mvn':'gradle',root || context.globalStorageUri.fsPath).catch(()=>undefined);
      if(!executable && saved[target] && await fs.stat(saved[target]).then(s=>s.isFile()).catch(()=>false))executable=saved[target];
      executable ??= await installJavaTool(vscode.Uri.joinPath(context.globalStorageUri,'java-tools').fsPath,target,report,abort.signal);
      await context.globalState.update('atelier.java.buildTools',{...saved,[target]:executable});
      if(root){
        const java=hostToolchains()?.snapshot().tools.find(t=>t.language==='java'&&t.available)?.executable;
        if(!java)throw new Error('构建工具已就绪，但未发现 JDK。请先在工具链管理中选择 JDK，再生成 Wrapper。');
        const home=path.dirname(path.dirname(await fs.realpath(java)));
        const run=initializationRunner(text=>output.append(text),abort.signal,report);
        await run(executable,target==='maven'?['-B','wrapper:wrapper']:['wrapper','--no-daemon'],root,{JAVA_HOME:home,PATH:path.join(home,'bin')+path.delimiter+(process.env.PATH || '')});
      }
      void vscode.window.showInformationMessage(`${target==='maven'?'Maven':'Gradle'}${root?' 和项目 Wrapper':''}已配置完成。`);
    }finally{listener.dispose();}
  });
}
