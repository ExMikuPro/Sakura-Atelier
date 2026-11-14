import { resolveTool } from './tools';
import { RunnerError, Step } from './model';
export type PackageManagerKind='brew'|'apt'|'winget';
export interface PackageSummary { id:string;name:string;source:string;kind:'formula'|'cask'|'apt'|'winget';version:string;installedVersion?:string;description?:string;language?:string;scope?:'system'|'manager'|'project' }
export interface PackageDetails extends PackageSummary { versions:string[];homepage?:string;details?:string;installedPath?:string }
export type PackageQuery=(command:string,args:string[])=>Promise<string>;
export interface PackageManagerAdapter {
  readonly kind:PackageManagerKind;readonly executable:string;readonly helpUrl:string;
  search(keyword:string):Promise<PackageSummary[]>;
  details(item:PackageSummary):Promise<PackageDetails>;
  installed():Promise<PackageSummary[]>;
  updates():Promise<PackageSummary[]>;
  installPlan(item:PackageDetails,version:string,cwd:string):Promise<{step:Step;admin:boolean}>;
}
export function platformManager(platform:string,osRelease=''):PackageManagerKind|undefined{
  if(platform==='darwin'){return 'brew';}if(platform==='win32'){return 'winget';}
  if(platform!=='linux'){return undefined;}
  const values=Object.fromEntries(osRelease.split(/\r?\n/).flatMap(line=>{const m=line.match(/^([A-Z_]+)=(.*)$/);return m?[[m[1],m[2].replace(/^['"]|['"]$/g,'')]]:[];}));
  return [values.ID,...(values.ID_LIKE||'').split(/\s+/)].some(id=>['ubuntu','debian'].includes(id))?'apt':undefined;
}
export function validateKeyword(keyword:string):string{const value=keyword.trim();if(!value||value.length>80||value.startsWith('-')||/[\r\n\0]/.test(value)){throw new RunnerError('Enter a search keyword of 1–80 characters without leading options.');}return value;}
export function validatePackageId(id:string,kind:PackageSummary['kind']):void{
  const valid=kind==='apt'?/^[a-z0-9][a-z0-9+.-]*(?::[a-z0-9]+)?$/.test(id):kind==='winget'?/^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,199}$/.test(id):/^[a-zA-Z0-9][a-zA-Z0-9@+._/-]{0,199}$/.test(id)&&!id.split('/').includes('..');
  if(!valid){throw new RunnerError('The package manager returned an invalid package identifier.');}
}
function versionAllowed(item:PackageDetails,version:string):void{validatePackageId(item.id,item.kind);if(!version||!item.versions.includes(version)||/[\r\n\0]/.test(version)){throw new RunnerError('Select a version returned by the current configured package source.');}}
export function parseAptPolicy(id:string,text:string):PackageDetails{
  validatePackageId(id,'apt');
  const installed=text.match(/^\s*Installed:\s*(\S+)/m)?.[1];const candidate=text.match(/^\s*Candidate:\s*(\S+)/m)?.[1];
  const versions=[...text.matchAll(/^\s*(?:\*\*\*\s+)?(\S+)\s+\d+\s*$/gm)].map(m=>m[1]).filter(v=>v!=='Version'&&v!=='(none)');
  if(candidate&&candidate!=='(none)'&&!versions.includes(candidate)){versions.unshift(candidate);}
  const sources=[...text.matchAll(/^\s+\d+\s+((?:https?|file):\S+[^\n]*)/gm)].map(m=>m[1].trim());
  return {id,name:id,kind:'apt',source:sources.join('\n')||'Current configured APT repositories',version:candidate==='(none)'?'':candidate||'',versions:[...new Set(versions)],installedVersion:installed&&installed!=='(none)'?installed:undefined,details:text};
}
/** WinGet's table is localized; package IDs and versions remain machine identifiers. */
export function parseWingetTable(text:string):PackageSummary[]{
  const lines=text.replace(/\x1b\[[0-9;]*m/g,'').split(/\r?\n/);const separator=lines.findIndex(line=>/^\s*-{5,}/.test(line));
  if(separator<0){return [];}
  const results:PackageSummary[]=[];
  for(const line of lines.slice(separator+1)){
    const columns=line.trim().split(/\s{2,}/);if(columns.length<3){continue;}
    const [name,id,version]=columns;const source=columns.at(-1)||'';
    try{validatePackageId(id,'winget');}catch{continue;}
    if(!/^[a-zA-Z0-9_. -]+$/.test(source)||source===version){continue;}
    results.push({id,name,version,source,kind:'winget'});
  }
  return results;
}
export class HomebrewAdapter implements PackageManagerAdapter{
  readonly kind='brew';readonly helpUrl='https://brew.sh/';
  constructor(readonly executable:string,private readonly run:PackageQuery){}
  async search(keyword:string):Promise<PackageSummary[]>{
    const term=validateKeyword(keyword);
    const outputs=await Promise.all((['formula','cask'] as const).map(async kind=>{try{return {kind,text:await this.run(this.executable,['search',`--${kind}`,term])};}catch(error){if(/No formulae or casks found|No casks found|No formulae found/.test(String(error))){return {kind,text:''};}throw error;}}));
    return outputs.flatMap(({kind,text})=>text.split(/\r?\n/).filter(line=>!line.startsWith('==>')).join(' ').split(/\s+/).filter(id=>id&&!id.startsWith('=')).flatMap(id=>{try{validatePackageId(id,kind);return [{id,name:id,version:'',source:kind==='formula'?'Homebrew formula':'Homebrew cask',kind}];}catch{return [];}}));
  }
  async details(item:PackageSummary):Promise<PackageDetails>{
    validatePackageId(item.id,item.kind);
    if(!['formula','cask'].includes(item.kind)){throw new RunnerError('Invalid Homebrew package kind.');}
    const data=JSON.parse(await this.run(this.executable,['info','--json=v2',`--${item.kind}`,item.id]));
    const entry=(item.kind==='formula'?data.formulae:data.casks)?.[0];if(!entry){throw new RunnerError('Homebrew returned no package details.');}
    const version=String(item.kind==='formula'?(entry.versions?.stable||'')+(entry.revision?'_'+entry.revision:''):entry.version||'');
    const id=String(item.kind==='formula'?entry.full_name||entry.name:entry.full_token||entry.token);
    validatePackageId(id,item.kind);
    let installedPath:string|undefined;if(item.kind==='formula'&&entry.installed?.length){try{installedPath=(await this.run(this.executable,['--prefix',id])).trim();}catch{/* The SDK can still be located manually. */}}
    return {...item,installedPath,id,name:Array.isArray(entry.name)?entry.name.join(', '):entry.name||id,version,versions:version?[version]:[],source:entry.tap||(item.kind==='formula'?'homebrew/core':'homebrew/cask'),installedVersion:item.kind==='formula'?entry.installed?.map((i:{version:string})=>i.version).join(', '):entry.installed||undefined,description:entry.desc||'',homepage:entry.homepage,details:entry.caveats||''};
  }
  async installed():Promise<PackageSummary[]>{
    const data=JSON.parse(await this.run(this.executable,['info','--json=v2','--installed']));
    return [...(data.formulae||[]).map((p:{full_name?:string;name:string;tap?:string;versions?:{stable:string};installed:{version:string}[]})=>({id:p.full_name||p.name,name:p.name,source:p.tap||'homebrew/core',version:(p.versions?.stable||'')+((p as {revision?:number}).revision?'_'+(p as {revision?:number}).revision:''),installedVersion:p.installed.map(i=>i.version).join(', '),kind:'formula' as const})),...(data.casks||[]).map((p:{token:string;version:string;installed:string;tap?:string})=>({id:p.token,name:p.token,source:p.tap||'homebrew/cask',version:p.version,installedVersion:p.installed,kind:'cask' as const}))];
  }
  async updates():Promise<PackageSummary[]>{const installed=await this.installed();return installed.filter(p=>p.installedVersion&&p.version&&!p.installedVersion.split(', ').includes(p.version));}
  async installPlan(item:PackageDetails,version:string,cwd:string):Promise<{step:Step;admin:boolean}>{versionAllowed(item,version);return {step:{command:this.executable,args:['install',`--${item.kind}`,...(item.kind==='formula'?['--skip-link']:[]),item.id],cwd,label:`Install ${item.id}`,env:{HOMEBREW_NO_AUTO_UPDATE:'1',HOMEBREW_NO_ANALYTICS:'1',HOMEBREW_NO_INSTALL_CLEANUP:'1',HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK:'1'},terminal:true},admin:false};}
}
export class AptAdapter implements PackageManagerAdapter{
  readonly kind='apt';readonly helpUrl='https://wiki.debian.org/PackageManagement';
  constructor(readonly executable:string,private readonly run:PackageQuery,private readonly cache='apt-cache',private readonly dpkg='dpkg-query'){}
  async search(keyword:string):Promise<PackageSummary[]>{const text=await this.run(this.cache,['search','--names-only',validateKeyword(keyword)]);return text.split(/\r?\n/).flatMap(line=>{const m=line.match(/^(\S+)\s+-\s+(.*)$/);if(!m){return [];}validatePackageId(m[1],'apt');return [{id:m[1],name:m[1],description:m[2],source:'Configured APT repositories',version:'',kind:'apt' as const}];});}
  async details(item:PackageSummary):Promise<PackageDetails>{validatePackageId(item.id,'apt');const result=parseAptPolicy(item.id,await this.run(this.cache,['policy',item.id]));if(!result.versions.length){throw new RunnerError('Package is not available from the configured APT repositories. No repository was added.');}return result;}
  async installed():Promise<PackageSummary[]>{const text=await this.run(this.dpkg,['-W','-f=${binary:Package}\t${Version}\t${Status}\n']);return text.split(/\r?\n/).flatMap(line=>{const [id,version,status]=line.split('\t');return status==='install ok installed'?[{id,name:id,version,installedVersion:version,source:'Installed Debian package',kind:'apt' as const}]:[];});}
  async updates():Promise<PackageSummary[]>{const output=await this.run(this.executable,['list','--upgradable']);return output.split(/\r?\n/).flatMap(line=>{const m=line.match(/^(\S+)\/\S+\s+(\S+)\s+\S+\s+\[.*?:\s*(\S+)\]/);return m?[{id:m[1],name:m[1],version:m[2],installedVersion:m[3],source:'Configured APT repositories',kind:'apt' as const}]:[];});}
  async installPlan(item:PackageDetails,version:string,cwd:string):Promise<{step:Step;admin:boolean}>{versionAllowed(item,version);const root=process.platform==='linux'&&typeof process.getuid==='function'&&process.getuid()===0;const command=root?this.executable:await resolveTool('sudo',cwd);return {step:{command,args:[...(root?[]:[this.executable]),'install',`${item.id}=${version}`],cwd,label:`安装 ${item.id}`,terminal:true},admin:!root};}
}
export class WingetAdapter implements PackageManagerAdapter{
  readonly kind='winget';readonly helpUrl='https://learn.microsoft.com/windows/package-manager/winget/';
  constructor(readonly executable:string,private readonly run:PackageQuery){}
  async search(keyword:string):Promise<PackageSummary[]>{return parseWingetTable(await this.run(this.executable,['search','--query',validateKeyword(keyword),'--disable-interactivity']));}
  async details(item:PackageSummary):Promise<PackageDetails>{
    validatePackageId(item.id,'winget');if(!/^[a-zA-Z0-9_. -]+$/.test(item.source)){throw new RunnerError('Select an explicit WinGet source.');}
    const base=['show','--id',item.id,'--exact','--source',item.source];
    const details=await this.run(this.executable,[...base,'--disable-interactivity']);
    const versionsText=await this.run(this.executable,[...base,'--versions','--disable-interactivity']);
    const lines=versionsText.split(/\r?\n/);const separator=lines.findIndex(line=>/^\s*-{3,}/.test(line));
    const versions=separator>=0?lines.slice(separator+1).map(line=>line.trim()).filter(v=>/^[0-9][a-zA-Z0-9.+_-]*$/.test(v)):[];
    if(!versions.length){throw new RunnerError('WinGet did not return a parseable version list. Inspect the package in a normal terminal; no install command was generated.');}
    return {...item,version:versions[0],versions,details};
  }
  async installed():Promise<PackageSummary[]>{return parseWingetTable(await this.run(this.executable,['list','--disable-interactivity'])).map(p=>({...p,installedVersion:p.version}));}
  async updates():Promise<PackageSummary[]>{return parseWingetTable(await this.run(this.executable,['upgrade','--disable-interactivity']));}
  async installPlan(item:PackageDetails,version:string,cwd:string):Promise<{step:Step;admin:boolean}>{versionAllowed(item,version);if(!/^[a-zA-Z0-9_. -]+$/.test(item.source)){throw new RunnerError('A verified WinGet source is required.');}return {step:{command:this.executable,args:['install','--id',item.id,'--exact','--source',item.source,'--version',version],cwd,label:`Install ${item.id}`,terminal:true},admin:false};}
}
