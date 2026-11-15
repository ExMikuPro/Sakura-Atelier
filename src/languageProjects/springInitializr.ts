import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {inflateRawSync} from 'node:zlib';
import {LanguageProjectOptions} from './options';
export interface InitializrChoice {id:string;name:string;versionRange?:string;description?:string}
export interface InitializrMetadata {bootVersions:InitializrChoice[];javaVersions:InitializrChoice[];builds:InitializrChoice[];dependencies:InitializrChoice[]; defaultJava?:string;defaultBoot?:string}
const origin='https://start.spring.io';
async function response(url:string,signal?:AbortSignal):Promise<Response>{
  const reply=await fetch(url,{headers:{Accept:'application/vnd.initializr.v2.3+json','User-Agent':'Sakura-Atelier/0.1.0'},signal:signal || AbortSignal.timeout(30000)});
  if(!reply.ok)throw new Error(`Spring Initializr 请求失败：HTTP ${reply.status}`);return reply;
}
export async function initializrMetadata(signal?:AbortSignal):Promise<InitializrMetadata>{
  const raw=await (await response(origin,signal)).json() as Record<string,{values?:unknown[];default?:string}>;
  const choices=(key:string):InitializrChoice[]=>((raw[key]?.values ?? []) as InitializrChoice[]).filter(v=>typeof v.id==='string'&&typeof v.name==='string');
  const dependencies=((raw.dependencies?.values ?? []) as {values?:InitializrChoice[]}[]).flatMap(group=>group.values ?? []);
  return {defaultJava:raw.javaVersion?.default,defaultBoot:raw.bootVersion?.default,bootVersions:choices('bootVersion'),javaVersions:choices('javaVersion'),builds:choices('type').filter(v=>['maven-project','gradle-project','gradle-project-kotlin'].includes(v.id)),dependencies};
}
const numbers=(version:string)=>version.split(/[^0-9]+/).slice(0,3).map(Number);
function compare(a:string,b:string):number{const left=numbers(a),right=numbers(b);for(let i=0;i<3;i++){const delta=(left[i]||0)-(right[i]||0);if(delta)return delta;}return 0;}
export function supportsBoot(range:string|undefined,version:string):boolean {
  if(!range)return true;
  if(!/^[[(]/.test(range))return compare(version,range)>=0;
  const match=range.match(/^([[(])([^,]*),([^\])]*)([\])])$/);
  if(!match)return false;
  const [,start,min,max,end]=match;
  return (!min||(start==='['?compare(version,min)>=0:compare(version,min)>0)) && (!max||(end===']'?compare(version,max)<=0:compare(version,max)<0));
}
export function springParameters(name:string,options:LanguageProjectOptions,metadata:InitializrMetadata):URLSearchParams{
  const boot=options.frameworkVersion || metadata.defaultBoot || metadata.bootVersions.find(v=>!/(?:SNAPSHOT|M\d|RC\d)/i.test(v.id))?.id;
  const java=options.javaVersion || metadata.defaultJava || metadata.javaVersions[0]?.id;
  const type=options.javaBuild==='gradle-kotlin'?'gradle-project-kotlin':options.javaBuild==='gradle-groovy'?'gradle-project':'maven-project';
  if(!metadata.bootVersions.some(v=>v.id===boot)||!metadata.javaVersions.some(v=>v.id===java)||!metadata.builds.some(v=>v.id===type))throw new Error('请选择 Spring Initializr 当前支持的框架、Java 版本和构建工具。');
  const dependencies=(options.dependencies || '').split(',').filter(Boolean);
  for(const id of dependencies){const dependency=metadata.dependencies.find(d=>d.id===id);if(!dependency||!supportsBoot(dependency.versionRange,boot!))throw new Error(`依赖 ${id} 与所选 Spring Boot 版本不兼容。`);}
  return new URLSearchParams({type,language:'java',bootVersion:boot!,javaVersion:java!,groupId:options.groupId || 'com.example',artifactId:options.artifactId || name,version:options.projectVersion || '0.0.1-SNAPSHOT',name,description:options.description || name,packageName:options.packageName || 'com.example.app',packaging:'jar',dependencies:dependencies.join(',')});
}
export async function downloadSpring(name:string,options:LanguageProjectOptions,signal?:AbortSignal):Promise<Buffer>{
  const query=springParameters(name,options,await initializrMetadata(signal));
  const reply=await response(origin+'/starter.zip?'+query,signal);
  const reader=reply.body?.getReader();if(!reader)throw new Error('Spring Initializr 未返回工程文件。');
  const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>20*1024*1024)throw new Error('工程压缩包超过大小限制。');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
  return Buffer.concat(chunks);
}
export interface ZipFile {name:string;data:Buffer;executable:boolean}
/** Inspect every central-directory entry before writing: no traversal, symlinks, encryption or unbounded inflation. */
export function inspectProjectZip(zip:Buffer,limits={total:50*1024*1024,file:20*1024*1024,count:5000}):ZipFile[]{
  let end=-1;for(let i=zip.length-22;i>=Math.max(0,zip.length-65557);i--)if(zip.readUInt32LE(i)===0x06054b50){end=i;break;}
  if(end<0)throw new Error('项目压缩包不是有效 ZIP。');
  const count=zip.readUInt16LE(end+10);if(count>limits.count)throw new Error('ZIP 文件数量超过限制。');
  let cursor=zip.readUInt32LE(end+16),total=0;const files:ZipFile[]=[],seen=new Set<string>();
  for(let i=0;i<count;i++){
    if(cursor+46>zip.length || zip.readUInt32LE(cursor)!==0x02014b50)throw new Error('ZIP 目录损坏。');
    const flags=zip.readUInt16LE(cursor+8),method=zip.readUInt16LE(cursor+10),compressed=zip.readUInt32LE(cursor+20),size=zip.readUInt32LE(cursor+24),length=zip.readUInt16LE(cursor+28),extra=zip.readUInt16LE(cursor+30),comment=zip.readUInt16LE(cursor+32),mode=zip.readUInt32LE(cursor+38)>>>16,offset=zip.readUInt32LE(cursor+42);
    const name=zip.subarray(cursor+46,cursor+46+length).toString('utf8');cursor+=46+length+extra+comment;
    if(!name||/[\\\0]/.test(name)||name.startsWith('/')||/^[a-z]:/i.test(name)||name.split('/').some(v=>v==='..'||v==='.')||(mode&0xf000)===0xa000||flags&1)throw new Error('ZIP 包含不安全的路径或符号链接。');
    if(seen.has(name))throw new Error('ZIP 包含重复文件。');seen.add(name);
    if(name.endsWith('/'))continue;
    total+=size;if(size>limits.file||total>limits.total)throw new Error('ZIP 解压大小超过限制。');
    if(offset+30>zip.length||zip.readUInt32LE(offset)!==0x04034b50)throw new Error('ZIP 文件头损坏。');
    const start=offset+30+zip.readUInt16LE(offset+26)+zip.readUInt16LE(offset+28);
    if(start+compressed>zip.length)throw new Error('ZIP 文件内容不完整。');
    const packed=zip.subarray(start,start+compressed);
    const data=method===0?packed:method===8?inflateRawSync(packed,{maxOutputLength:Math.max(1,size)}):undefined;
    if(!data||data.length!==size)throw new Error('ZIP 压缩格式或大小无效。');
    files.push({name,data,executable:!!(mode&0o111)});
  }
  return files;
}
export async function extractProjectZip(zip:Buffer,target:string):Promise<void>{
  const files=inspectProjectZip(zip);
  for(const file of files){const destination=path.join(target,file.name);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,file.data,{flag:'wx',mode:file.executable||/^(gradlew|mvnw)$/.test(file.name)?0o755:0o644});}
}
