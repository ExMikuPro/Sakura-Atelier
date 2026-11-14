import { t } from './i18n';
import { ui } from './ui';
import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import { PackageManagerAdapter,PackageSummary,PackageDetails,platformManager,HomebrewAdapter,AptAdapter,WingetAdapter } from './packageManagers';
import { query } from './toolchains';
import { resolveTool } from './tools';
import { TaskExecutor } from './executor';
import { RunnerError } from './model';
export class SdkManager implements vscode.Disposable{
  private adapter?:PackageManagerAdapter;
  private verified=new Map<string,PackageDetails>();
  private installer=new TaskExecutor('Sakura Atelier SDK Manager');
  status='Not checked';helpUrl='';
  constructor(private readonly refreshed:(details?:PackageDetails)=>Promise<void>){}
  async detect(cwd:string):Promise<void>{
    const release=process.platform==='linux'?await fs.readFile('/etc/os-release','utf8').catch(()=>''):'';
    const kind=platformManager(process.platform,release);
    if(!kind){this.adapter=undefined;this.status='Unsupported platform/distribution. Only macOS Homebrew, Ubuntu/Debian-compatible APT and Windows WinGet are enabled.';return;}
    this.helpUrl=kind==='brew'?'https://brew.sh/':kind==='winget'?'https://learn.microsoft.com/windows/package-manager/winget/':'https://wiki.debian.org/PackageManagement';
    try{
      const executable=await resolveTool(kind==='brew'?'brew':kind==='winget'?'winget':'apt',cwd);
      const run=(command:string,args:string[])=>query(command,args,cwd,{...process.env,LC_ALL:'C',HOMEBREW_NO_AUTO_UPDATE:'1',HOMEBREW_NO_COLOR:'1',HOMEBREW_NO_ANALYTICS:'1'});
      this.adapter=kind==='brew'?new HomebrewAdapter(executable,run):kind==='apt'?new AptAdapter(executable,run,await resolveTool('apt-cache',cwd),await resolveTool('dpkg-query',cwd)):new WingetAdapter(executable,run);
      this.status=`${kind}: ${executable}`;
    }catch{this.adapter=undefined;this.status=`${kind} is missing from PATH. Use the official installation instructions. No package manager was installed.`;}
  }
  private ready():PackageManagerAdapter{if(!vscode.workspace.isTrusted){throw new RunnerError('Trust the workspace before querying or installing SDKs.');}if(!this.adapter){throw new RunnerError(this.status);}return this.adapter;}
  private classify<T extends PackageSummary>(item:T):T{const id=item.id.toLowerCase();const language=/dotnet|\.net/.test(id)?'C#':/python|pip|conda|poetry|pyenv|(^|[/.])uv($|@)/.test(id)?'Python':/rust|cargo/.test(id)?'Rust':/(^|[/.])go($|@)|golang/.test(id)?'Go':/node|npm|pnpm|yarn|typescript|tsx/.test(id)?'JavaScript / TypeScript / Node.js':/gcc|g\+\+|clang|llvm|cmake|ninja|make|visualstudio/.test(id)?'C / C++':/jdk|java/.test(id)?'Java':'Other package';const scope=/typescript|(^|[/.])tsx($|@)/.test(id)?'project':/rustup|(^|[/.])uv($|@)|conda|poetry|pyenv|npm|pnpm|yarn/.test(id)?'manager':'system';return {...item,language,scope};}
  async list(mode:'search'|'installed'|'updates',keyword:string):Promise<PackageSummary[]>{const adapter=this.ready();return (await (mode==='search'?adapter.search(keyword):mode==='installed'?adapter.installed():adapter.updates())).map(item=>this.classify(item));}
  async details(item:PackageSummary):Promise<PackageDetails>{const adapter=this.ready();const details=this.classify(await adapter.details(item));this.verified.set(`${details.kind}:${details.source}:${details.id}`,details);return details;}
  async install(key:string,version:string,cwd:string):Promise<{cancelled:boolean}>{
    const adapter=this.ready();const previous=this.verified.get(key);if(!previous){throw new RunnerError('Open package details first; unverified package requests cannot be installed.');}
    const current=await adapter.details(previous);
    if(current.id!==previous.id||current.source!==previous.source||current.kind!==previous.kind){throw new RunnerError('Package identity/source changed. Refresh and confirm the new source first.');}
    const {step,admin}=await adapter.installPlan(current,version,cwd);
    const command=[step.command,...step.args].map(arg=>JSON.stringify(arg)).join(' ');
    const message=[t('Install {0} {1}',current.name,version),t('Source: {0}',current.source),command,admin?t('Administrator permission will be requested by sudo in the terminal.'):'',adapter.kind==='brew'?t('Homebrew formulae use --skip-link; automatic cleanup and dependent upgrades are disabled.'):'',t('Package-manager permission and license prompts remain interactive.')].filter(Boolean).join('\n');
    const accepted=await ui.showWarningMessage(message,{modal:true},'Install');
    if(accepted!=='Install'){return {cancelled:true};}
    const started=await this.installer.exclusive(()=>this.installer.run({name:`Install ${current.name}`,steps:[step]}));
    if(!started){throw new RunnerError('Another SDK installation is already running.');}
    this.verified.clear();let installed:PackageDetails|undefined;try{installed=await adapter.details(current);}catch{/* Refresh PATH SDKs even if metadata lookup is temporarily offline. */}try{await this.refreshed(installed);}catch(error){throw new RunnerError(`SDK installation completed, but toolchain refresh failed: ${error instanceof Error?error.message:String(error)}. Use Refresh or Locate Existing SDK.`,true);}return {cancelled:false};
  }
  dispose():void{this.installer.dispose();}
}
