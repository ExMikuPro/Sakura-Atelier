import {spawn} from 'node:child_process';
import {processEnvironment} from '../tools';
import type {InitializationRun} from './pythonVenv';
/** Creation-only streaming runner: cancellation terminates its own process group, never another task. */
export function initializationRunner(output:(text:string)=>void,signal:AbortSignal,report:(message:string)=>void):InitializationRun {
  return (command,args,cwd,env)=>new Promise((resolve,reject)=>{
    if(signal.aborted){reject(new Error('创建已取消。'));return;}
    report(pathLabel(command,args));
    const child=spawn(command,args,{cwd,env:processEnvironment(env),shell:false,detached:process.platform!=='win32',windowsHide:true});
    let text='',settled=false;
    const append=(chunk:Buffer)=>{const value=chunk.toString();output(value);text=(text+value).slice(-2*1024*1024);};
    child.stdout.on('data',append);child.stderr.on('data',append);
    const stop=()=>{if(child.pid){try{if(process.platform==='win32')child.kill();else process.kill(-child.pid,'SIGTERM');}catch{/* already exited */}}};
    const timer=setTimeout(()=>{stop();finish(new Error('初始化超时，请检查网络和构建工具。'));},12*60*1000);
    const abort=()=>{stop();finish(new Error('创建已取消，已创建文件保留。'));};
    const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);if(error)reject(error);else resolve(text);};
    signal.addEventListener('abort',abort,{once:true});
    child.on('error',error=>finish(error));child.on('close',code=>finish(code===0?undefined:new Error(`${pathLabel(command,args)} 失败（退出码 ${code}）\n${text.split(/\r?\n/).slice(-12).join('\n')}`)));
  });
}
function pathLabel(command:string,args:string[]):string{return command.split(/[\\/]/).pop()+' '+args.slice(0,2).join(' ');}
