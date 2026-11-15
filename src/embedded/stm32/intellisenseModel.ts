import * as path from 'node:path';
import type { BackendHost } from '../../adapterTypes';
import type { Stm32Project } from './project';

export interface SourceConfiguration {
  includePath: string[]; defines: string[]; compilerPath?: string;
  compilerArgs: string[]; standard: string; intelliSenseMode: 'gcc-arm' | 'gcc-arm64' | 'gcc-x64';
  forcedInclude?: string[];
}
export interface CompileEntry { directory: string; file: string; command?: string; arguments?: string[] }

/** Tokenizes a compilation command for inspection only. Never evaluated by a shell. */
export function commandArguments(command: string): string[] {
  const args: string[]=[]; let value=''; let quote=''; let started=false;
  for(let i=0;i<command.length;i++) {
    const c=command[i];
    if(c==='\\' && quote!=="'" && i+1<command.length && /[\s\\"']/.test(command[i+1])) { value+=command[++i];started=true; }
    else if(quote) { if(c===quote)quote='';else value+=c;started=true; }
    else if(c==='"'||c==="'") { quote=c;started=true; }
    else if(/\s/.test(c)) { if(started){args.push(value);value='';started=false;} }
    else {value+=c;started=true;}
  }
  if(quote)throw new Error('编译数据库中的命令引号不完整。');
  if(started)args.push(value);
  return args;
}
export function compileConfiguration(entry: CompileEntry, compilerPath?: string): SourceConfiguration {
  const args=entry.arguments ?? commandArguments(entry.command ?? '');
  const includePath: string[]=[];const defines: string[]=[];const compilerArgs: string[]=[];const forcedInclude: string[]=[];
  const resolve=(value:string)=>path.resolve(entry.directory,value);
  let standard=/\.(cpp|cc|cxx)$/i.test(entry.file)?'c++17':'c11';
  for(let i=1;i<args.length;i++) {
    const a=args[i];
    if(a==='-I'||a==='-isystem'||a==='-iquote'||a==='-idirafter') { if(args[i+1])includePath.push(resolve(args[++i])); }
    else if(a.startsWith('-I'))includePath.push(resolve(a.slice(2)));
    else if(a==='-D'){if(args[i+1])defines.push(args[++i]);}
    else if(a.startsWith('-D'))defines.push(a.slice(2));
    else if(a==='-include'||a==='-imacros'){if(args[i+1])forcedInclude.push(resolve(args[++i]));}
    else if(a.startsWith('-std='))standard=a.slice(5);
    else if(a==='--sysroot'||a==='-isysroot'){if(args[i+1])compilerArgs.push(a,resolve(args[++i]));}
    else if(a.startsWith('--sysroot='))compilerArgs.push('--sysroot='+resolve(a.slice(10)));
    else if(/^-(?:m|fshort-|funsigned-char|fsigned-char|nostdinc|U)/.test(a))compilerArgs.push(a);
  }
  return {includePath:[...new Set(includePath)],defines:[...new Set(defines)],...(compilerPath?{compilerPath}:{}),compilerArgs,standard,intelliSenseMode:'gcc-arm',...(forcedInclude.length?{forcedInclude}:{})};
}

/** CubeMX metadata gives a useful configuration before the first build, without running CMake. */
export async function cubeMxConfiguration(project: Stm32Project, host: BackendHost, compilerPath?: string, release=false): Promise<SourceConfiguration> {
  const generated=path.join(project.root,'cmake/stm32cubemx/CMakeLists.txt');
  const cmake=await host.readText(generated) ?? '';
  const block=(name:string)=>cmake.match(new RegExp(`set\\s*\\(\\s*${name}\\s+([\\s\\S]*?)\\)`, 'i'))?.[1] ?? '';
  const includePath=commandArguments(block('MX_Include_Dirs')).map(value=>value.replaceAll('${CMAKE_CURRENT_SOURCE_DIR}',path.dirname(generated)).replaceAll('${CMAKE_SOURCE_DIR}',project.root)).filter(value=>!value.includes('${')).map(value=>path.resolve(project.root,value));
  const defines=commandArguments(block('MX_Defines_Syms')).filter(value=>/^[A-Za-z_]\w*(?:=.*)?$/.test(value));
  if(!release && /CONFIG:Debug>:DEBUG/.test(cmake))defines.push('DEBUG');
  // Older CubeMX generators use direct target_* calls, and Makefile projects expose -I/-D flags.
  const make=await host.readText(path.join(project.root,'Makefile')) ?? '';
  if(!includePath.length || !defines.length) {
    const flattened=make.replace(/\\\r?\n/g,' ');
    const flags=[...flattened.matchAll(/(?:^|\s)(-[ID](?:"[^"]*"|'[^']*'|[^\s]+))/g)].flatMap(match=>commandArguments(match[1]));
    const makeConfig=compileConfiguration({directory:project.root,file:'main.c',arguments:['gcc',...flags]},compilerPath);
    if(!includePath.length)includePath.push(...makeConfig.includePath);
    if(!defines.length)defines.push(...makeConfig.defines);
  }
  if(!includePath.length) {
    const roots=await host.readDir(project.root);
    for(const dir of ['Inc','Core/Inc','Drivers/CMSIS/Include'])if((await host.readDir(path.join(project.root,dir))).length)includePath.push(path.join(project.root,dir));
    for(const dir of await host.readDir(path.join(project.root,'Drivers')))if(/STM32.*HAL_Driver/.test(dir))includePath.push(path.join(project.root,'Drivers',dir,'Inc'),path.join(project.root,'Drivers',dir,'Inc/Legacy'));
    const devices=path.join(project.root,'Drivers/CMSIS/Device/ST');
    for(const dir of await host.readDir(devices))if(!project.ioc?.info.family || dir.toUpperCase().startsWith(project.ioc.info.family.toUpperCase()))includePath.push(path.join(devices,dir,'Include'));
    if(!defines.some(d=>/^STM32/.test(d))) {
      const startup=roots.find(file=>/^startup_stm32\w+\.[sS]$/.test(file));
      const part=startup?.match(/startup_(stm32\w+)\./i)?.[1];
      if(part)defines.push(part.toUpperCase().replace(/X/g,'x'));
    }
    if(roots.includes('Drivers') && !defines.includes('USE_HAL_DRIVER'))defines.push('USE_HAL_DRIVER');
  }
  const toolchain=project.toolchainFile ? await host.readText(project.toolchainFile) ?? '' : '';
  const compilerArgs=[...new Set((toolchain+'\n'+make).match(/-m(?:cpu|arch|fpu|float-abi|thumb)(?:=[A-Za-z0-9_+.-]+)?\b/g) ?? [])];
  return {includePath:[...new Set(includePath)],defines:[...new Set(defines)],...(compilerPath?{compilerPath}:{}),compilerArgs,standard:'c11',intelliSenseMode:'gcc-arm'};
}
export function nearestConfiguration(file: string, entries: {file:string;configuration:SourceConfiguration}[], fallback: SourceConfiguration): SourceConfiguration {
  const exact=entries.find(e=>e.file===file);if(exact)return exact.configuration;
  const sameStem=entries.find(e=>path.basename(e.file,path.extname(e.file))===path.basename(file,path.extname(file)));if(sameStem)return sameStem.configuration;
  // Only use a translation unit from this same project; never another workspace's chip defines.
  const sorted=[...entries].sort((a,b)=>path.relative(path.dirname(file),a.file).split(path.sep).length-path.relative(path.dirname(file),b.file).split(path.sep).length);
  return sorted[0]?.configuration ?? {...fallback,standard:/\.(cpp|cc|cxx|hpp)$/i.test(file)?'c++17':fallback.standard};
}
