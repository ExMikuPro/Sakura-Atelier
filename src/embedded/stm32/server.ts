import { spawn, ChildProcess } from 'node:child_process';

/** Owns only the process spawned here, never a process found by name or by port. */
export class OpenocdServer {
  private child?: ChildProcess;
  async start(executable: string, args: string[], cwd: string, output: (text:string)=>void, port: number): Promise<void> {
    if (this.child) throw new Error('本次 OpenOCD 已启动。');
    await new Promise<void>((resolve,reject) => {
      const child = spawn(executable,args,{cwd,shell:false,stdio:['ignore','pipe','pipe']}); this.child = child;
      let ready = false; let tail = '';
      const timer = setTimeout(() => { reject(new Error('OpenOCD 启动超时，请检查探针和端口。')); void this.stop(); },15000);
      const read = (chunk: Buffer) => {
        const text = chunk.toString(); output(text); tail = (tail + text).slice(-8192);
        if (!ready && new RegExp(`Listening on port ${port} for gdb connections`, 'i').test(tail)) { ready=true; clearTimeout(timer); resolve(); }
      };
      child.stdout?.on('data',read); child.stderr?.on('data',read);
      child.once('error',error => { clearTimeout(timer); reject(error); });
      child.once('exit',(code,signal) => { clearTimeout(timer); if (!ready) reject(new Error(`OpenOCD 启动失败（${code ?? signal}），请查看输出。`)); });
    });
  }
  async stop(): Promise<void> {
    const child = this.child; this.child = undefined;
    if (!child || !child.pid || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => child.kill('SIGKILL'),2000);
      child.once('exit',() => { clearTimeout(timer); resolve(); });
      child.kill('SIGTERM');
    });
  }
}
