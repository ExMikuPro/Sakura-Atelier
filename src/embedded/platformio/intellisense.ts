import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Runner } from '../process';
import { parseJsonOutput, readConfig } from './cli';
import { defaultEnvironments } from './ini';
import { describeEnvironments } from './project';
import { chooseEnvironment } from './plans';
import { commandArguments, compileConfiguration, SourceConfiguration } from '../stm32/intellisenseModel';

/** PlatformIO's resolved IDE data is authoritative for framework + library + toolchain includes. */
export function platformioSourceConfiguration(data: unknown, root: string, cpp = true): SourceConfiguration | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const value=data as Record<string,unknown>;
  const strings=(key:string):string[]=>Array.isArray(value[key]) ? value[key].filter((item):item is string=>typeof item==='string') : [];
  const compiler=value[cpp?'cxx_path':'cc_path'];
  const flags=value[cpp?'cxx_flags':'cc_flags'];
  const args=Array.isArray(flags) ? flags.filter((item):item is string=>typeof item==='string') : typeof flags==='string' ? commandArguments(flags) : [];
  const includes=Array.isArray(value.includes) ? strings('includes') : value.includes && typeof value.includes==='object' ? Object.values(value.includes).flatMap(group=>Array.isArray(group)?group.filter((item):item is string=>typeof item==='string'):[]) : [];
  if (!includes.length || typeof compiler!=='string' || !compiler) return undefined;
  const result=compileConfiguration({directory:root,file:cpp?'main.cpp':'main.c',arguments:[compiler,...args,...includes.flatMap(dir=>['-I',dir]),...strings('defines').flatMap(define=>['-D',define])]},compiler);
  // cpptools has no Xtensa/RISC-V mode; the actual cross compiler still supplies target/system headers.
  const standards:Record<string,string>={'gnu++2a':'gnu++20','c++2a':'c++20','gnu++2b':'gnu++23','c++2b':'c++23','gnu2x':'gnu23','c2x':'c23'};
  result.standard=standards[result.standard] || result.standard;
  result.intelliSenseMode=/arm|aarch/i.test(path.basename(compiler)) ? /aarch64/i.test(compiler)?'gcc-arm64':'gcc-arm' : 'gcc-x64';
  return result;
}
export interface PlatformioCompletion { environment: string; cpp: SourceConfiguration; c: SourceConfiguration }

/** Per-host attempt tracking prevents repeated downloads/errors while editing. Cached IDE data needs no subprocess build. */
export class PlatformioCompletionLoader {
  private attempts=new Set<string>();
  private known=new Set<string>();
  private stale=new Set<string>();
  reset():void {this.attempts.clear();this.stale=new Set(this.known);}
  async load(root: string, pio: string, run: Runner, remembered: string | undefined, prepare: boolean): Promise<PlatformioCompletion | undefined> {
    const ini=await readConfig(run,pio,root);
    const choice=chooseEnvironment({root,ini:'platformio.ini',environments:describeEnvironments(ini),defaultEnvironments:defaultEnvironments(ini)},remembered);
    if (choice.kind!=='selected') return undefined;
    const environment=choice.env;
    const projectKey=root+":"+environment;this.known.add(projectKey);
    const buildDir=path.resolve(root,ini.sections.get('platformio')?.options.get('build_dir') || '.pio/build');
    const file=path.join(buildDir,environment,'idedata.json');
    const signature=createHash('sha256').update(JSON.stringify([...ini.sections].map(([name,section])=>[name,[...section.options]]))).digest('hex');
    const key=`${pio}:${root}:${environment}:${signature}`;
    let data: unknown;
    try {
      const [cached,config]=await Promise.all([fs.stat(file),fs.stat(path.join(root,'platformio.ini'))]);
      if ((!prepare || !this.stale.has(projectKey)) && cached.mtimeMs>=config.mtimeMs) data=JSON.parse(await fs.readFile(file,'utf8'));
    } catch { /* First-time setup is requested only for the active project or by the user. */ }
    if (data && (!platformioSourceConfiguration(data,root,true) || !platformioSourceConfiguration(data,root,false))) data=undefined;
    if (!data && prepare && !this.attempts.has(key)) {
      this.attempts.add(key);
      const output=parseJsonOutput(await run(pio,['project','metadata','-d',root,'-e',environment,'--json-output'],root,120000));
      data=(output as Record<string,unknown> | undefined)?.[environment];
      this.stale.delete(projectKey);
    }
    const cpp=platformioSourceConfiguration(data,root,true), c=platformioSourceConfiguration(data,root,false);
    return cpp && c ? {environment,cpp,c} : undefined;
  }
}
