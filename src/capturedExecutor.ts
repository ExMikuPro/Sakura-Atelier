import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import { processEnvironment } from './tools';
import { Step, RunnerError } from './model';
/** Optional non-terminal execution. Commands use argv arrays, with an owned process group. */
export class CapturedExecutor {
  private children = new Set<ChildProcess>();
  private output = vscode.window.createOutputChannel('Sakura Atelier');
  run(step: Step): Promise<void> {
    this.output.show(true); this.output.appendLine(`\n▶ ${step.label}`);
    return new Promise((resolve,reject)=>{
      const child=spawn(step.command,step.args,{cwd:step.cwd,env:processEnvironment(step.env),shell:false,detached:process.platform!=='win32',windowsHide:true,stdio:['ignore','pipe','pipe']});
      this.children.add(child);
      child.stdout?.on('data',(chunk:Buffer)=>this.output.append(chunk.toString()));
      child.stderr?.on('data',(chunk:Buffer)=>this.output.append(chunk.toString()));
      child.on('error',error=>{this.children.delete(child);reject(new RunnerError(`Unable to launch ${step.label}: ${error.message}`));});
      child.on('close',code=>{this.children.delete(child);if(code===0){resolve();}else{reject(new RunnerError(`${step.label} failed (exit ${code??'terminated'}). See Sakura Atelier Output.`));}});
    });
  }
  stop(): void {
    for(const child of this.children){
      if(!child.pid){continue;}
      if(process.platform==='win32'){
        const taskkill=path.join(process.env.SystemRoot||'C:\\Windows','System32','taskkill.exe');
        const kill=spawn(taskkill,['/pid',String(child.pid),'/T','/F'],{shell:false,windowsHide:true,stdio:'ignore'});kill.on('error',()=>child.kill());
      }else{
        try{process.kill(-child.pid,'SIGTERM');}catch{/* Already ended. */}
        setTimeout(()=>{if(this.children.has(child)&&child.pid){try{process.kill(-child.pid,'SIGKILL');}catch{/* Already ended. */}}},1000);
      }
    }
  }
  async shutdown(): Promise<void> { this.stop();for(let i=0;i<30&&this.children.size;i++){await new Promise(resolve=>setTimeout(resolve,50));}this.output.dispose(); }
}
