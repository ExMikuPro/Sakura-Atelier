import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {createHash} from 'node:crypto';
import {inspectProjectZip} from './springInitializr';
export type JavaBuildTool='maven'|'gradle';
export interface ToolDownload {version:string;url:string;checksumUrl:string;algorithm:'sha512'|'sha256'}
async function fetchChecked(url:string,signal?:AbortSignal):Promise<Response>{
  if(!url.startsWith('https://'))throw new Error('构建工具只能通过 HTTPS 下载。');
  const response=await fetch(url,{signal:signal || AbortSignal.timeout(30000)});if(!response.ok)throw new Error(`构建工具下载失败：HTTP ${response.status}`);return response;
}
export async function currentJavaTool(tool:JavaBuildTool,signal?:AbortSignal):Promise<ToolDownload>{
  if(tool==='gradle'){
    const metadata=await (await fetchChecked('https://services.gradle.org/versions/current',signal)).json() as {version:string;downloadUrl:string;checksumUrl:string};
    if(!/^\d+(?:\.\d+){1,2}$/.test(metadata.version)||!metadata.downloadUrl.startsWith('https://services.gradle.org/distributions/'))throw new Error('Gradle 返回的版本元数据无效。');
    return {version:metadata.version,url:metadata.downloadUrl,checksumUrl:metadata.checksumUrl,algorithm:'sha256'};
  }
  const xml=await (await fetchChecked('https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/maven-metadata.xml',signal)).text();
  const versions=[...xml.matchAll(/<version>(3\.\d+\.\d+)<\/version>/g)].map(m=>m[1]);
  versions.sort((a,b)=>{const left=a.split('.').map(Number),right=b.split('.').map(Number);return right[1]-left[1]||right[2]-left[2];});
  const version=versions[0];if(!version)throw new Error('Maven 返回的版本元数据无效。');
  const url=`https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/${version}/apache-maven-${version}-bin.zip`;
  return {version,url,checksumUrl:url+'.sha512',algorithm:'sha512'};
}
export async function installJavaTool(storage:string,tool:JavaBuildTool,report:(message:string)=>void,signal?:AbortSignal):Promise<string>{
  report(`查询 ${tool} 官方版本`);const spec=await currentJavaTool(tool,signal);
  const destination=path.join(storage,tool+'-'+spec.version);const executable=path.join(destination,tool==='maven'?'apache-maven-'+spec.version:'gradle-'+spec.version,'bin',tool==='maven'?'mvn':'gradle');
  if(await fs.stat(executable).then(s=>s.isFile()).catch(()=>false))return executable;
  report(`下载并校验 ${tool} ${spec.version}`);
  const response=await fetchChecked(spec.url,signal),reader=response.body?.getReader();if(!reader)throw new Error('下载响应为空。');
  const chunks:Uint8Array[]=[];let size=0,lastMegabytes=-1;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>250*1024*1024)throw new Error('构建工具压缩包超过大小限制。');chunks.push(value);const megabytes=Math.round(size/1024/1024);if(megabytes!==lastMegabytes){lastMegabytes=megabytes;report(`下载 ${tool} ${spec.version}：${megabytes} MB`);}}}finally{await reader.cancel().catch(()=>{});}
  const zip=Buffer.concat(chunks);const expected=(await (await fetchChecked(spec.checksumUrl,signal)).text()).trim().split(/\s+/)[0].toLowerCase();
  const actual=createHash(spec.algorithm).update(zip).digest('hex');if(expected!==actual)throw new Error('构建工具校验和不匹配，已拒绝安装。');
  const files=inspectProjectZip(zip,{total:600*1024*1024,file:150*1024*1024,count:10000});
  await fs.mkdir(storage,{recursive:true});const temporary=await fs.mkdtemp(path.join(storage,'.install-'));
  try{
    for(const file of files){if(signal?.aborted)throw new Error('下载已取消。');const target=path.join(temporary,file.name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,file.data,{flag:'wx',mode:file.executable?0o755:0o644});}
    const relative=path.relative(destination,executable);await fs.chmod(path.join(temporary,relative),0o755);
    await fs.rename(temporary,destination);
  }catch(error){await fs.rm(temporary,{recursive:true,force:true});throw error;}
  return executable;
}
