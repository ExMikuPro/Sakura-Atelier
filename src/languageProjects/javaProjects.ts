import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {newConfiguration} from '../configuration';
import type {ScaffoldFile} from '../projectScaffolds';
import {LanguageProjectOptions} from './options';
import {downloadSpring,extractProjectZip,initializrMetadata,InitializrMetadata} from './springInitializr';
export interface JavaFrameworkProvider {
  id:'application'|'spring-boot'; label:string;
  metadata?(signal?:AbortSignal):Promise<InitializrMetadata>;
  generate(root:string,name:string,options:LanguageProjectOptions,signal?:AbortSignal):Promise<void>;
}
const xml=(value:string)=>value.replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]!));
export function javaApplicationFiles(name:string,options:LanguageProjectOptions):ScaffoldFile[]{
  const group=options.groupId || 'com.example',artifact=options.artifactId || name,packageName=options.packageName || 'com.example.app',version=options.projectVersion || '1.0-SNAPSHOT',java=options.javaVersion || '17';
  const main=packageName+'.Main';
  const files:ScaffoldFile[]=[{path:`src/main/java/${packageName.replaceAll('.','/')}/Main.java`,content:`package ${packageName};\n\npublic class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello from Sakura Atelier");\n    }\n}\n`},{path:'.gitignore',content:'.DS_Store\ntarget/\nbuild/\n.gradle/\n*.class\n'},{path:'README.md',content:`# ${name}\n\n标准 Java Application，可由 IntelliJ IDEA / VS Code 导入。\n入口：${main}\nJava：${java}\n\n使用 Sakura Atelier 的运行、编译、调试和测试配置。构建优先使用工程 Wrapper。\n`}];
  if(!options.javaBuild||options.javaBuild==='maven') files.push({path:'pom.xml',content:`<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">\n  <modelVersion>4.0.0</modelVersion>\n  <groupId>${xml(group)}</groupId>\n  <artifactId>${xml(artifact)}</artifactId>\n  <version>${xml(version)}</version>\n  <description>${xml(options.description || name)}</description>\n  <properties><maven.compiler.release>${java}</maven.compiler.release><project.build.sourceEncoding>UTF-8</project.build.sourceEncoding></properties>\n  <build><plugins>\n    <plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId><version>3.13.0</version></plugin>\n    <plugin><groupId>org.codehaus.mojo</groupId><artifactId>exec-maven-plugin</artifactId><version>3.5.0</version><configuration><mainClass>${main}</mainClass></configuration></plugin>\n  </plugins></build>\n</project>\n`});
  else {
    const kotlin=options.javaBuild==='gradle-kotlin',suffix=kotlin?'.kts':'';
    files.push({path:'settings.gradle'+suffix,content:`rootProject.name = '${artifact}'\n`.replaceAll("'",kotlin?'"':"'")},{path:'build.gradle'+suffix,content:kotlin?`plugins { application }\ngroup = "${group}"\nversion = "${version}"\nrepositories { mavenCentral() }\ntasks.withType<JavaCompile>().configureEach { options.release.set(${java}) }\napplication { mainClass.set("${main}") }\n`:`plugins { id 'application' }\ngroup = '${group}'\nversion = '${version}'\nrepositories { mavenCentral() }\ntasks.withType(JavaCompile).configureEach { options.release = ${java} }\napplication { mainClass = '${main}' }\n`});
  }
  return files;
}
async function writeFiles(root:string,files:ScaffoldFile[]):Promise<void>{for(const file of files){const destination=path.join(root,file.path);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,file.content,{flag:'wx'});}}
export const javaFrameworkProviders:JavaFrameworkProvider[]=[
  {id:'application',label:'Java Application',generate:async(root,name,options)=>{await writeFiles(root,javaApplicationFiles(name,options));await fs.mkdir(path.join(root,'src/main/resources'),{recursive:true});await fs.mkdir(path.join(root,'src/test/java'),{recursive:true});}},
  {id:'spring-boot',label:'Spring Boot Application',metadata:initializrMetadata,generate:async(root,name,options,signal)=>extractProjectZip(await downloadSpring(name,options,signal),root)}
];
export async function writeJavaConfigurations(root:string,name:string,options:LanguageProjectOptions):Promise<string>{
  const pending=[path.join(root,'src/main/java')];const entries:{file:string;main:string}[]=[];
  while(pending.length){const dir=pending.pop()!;for(const entry of await fs.readdir(dir,{withFileTypes:true}).catch(()=>[])){if(entry.isSymbolicLink())continue;const file=path.join(dir,entry.name);if(entry.isDirectory())pending.push(file);else if(file.endsWith('.java')){const source=await fs.readFile(file,'utf8');if(/public\s+static\s+void\s+main\s*\(/.test(source)){const pkg=source.match(/\bpackage\s+([\w.]+)\s*;/)?.[1];entries.push({file,main:(pkg?pkg+'.':'')+entry.name.slice(0,-5)});}}}}
  if(entries.length!==1)throw new Error('无法唯一确定 Java 入口类；工程文件已保留，请检查框架生成结果。');
  const base={...newConfiguration('java',name+' · 运行'),id:'run',templateId:'java.project',kind:'project' as const,target:entries[0].main,framework:options.javaFramework || 'application',package:options.javaBuild || 'maven',binary:options.artifactId || name};
  await writeFiles(root,[{path:'.vscode/sakura-atelier.json',content:JSON.stringify({version:1,default:'run',configurations:[base,{...base,id:'build',name:name+' · 编译',operation:'build'},{...base,id:'test',name:name+' · 测试',operation:'test'},{...base,id:'debug',name:name+' · 调试'}]},null,2)+'\n'}]);
  return entries[0].main;
}
export async function javaBuildExecutable(root:string,build:string,resolve:(command:string)=>Promise<string>):Promise<string>{
  const wrapper=path.join(root,build==='maven'?(process.platform==='win32'?'mvnw.cmd':'mvnw'):(process.platform==='win32'?'gradlew.bat':'gradlew'));
  if(await fs.stat(wrapper).then(s=>s.isFile()).catch(()=>false))return wrapper;
  return resolve(build==='maven'?'mvn':'gradle');
}
