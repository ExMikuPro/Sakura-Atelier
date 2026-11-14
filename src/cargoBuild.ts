import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
/** Task child: capture Cargo's machine-readable artifact paths without guessing target directories. */
export function main(args: string[]): void {
  const [cargo, output, ...cargoArgs] = args;
  const child = spawn(cargo,cargoArgs,{shell:false,stdio:['inherit','pipe','inherit']});
  let pending=''; const artifacts: { executable: string; name: string }[]=[];
  child.stdout.on('data',(data:Buffer)=>{pending+=data.toString();const lines=pending.split('\n');pending=lines.pop()!;for(const line of lines){try{const event=JSON.parse(line);if(event.reason==='compiler-artifact'&&event.executable){artifacts.push({executable:event.executable,name:event.target?.name||event.executable});}if(event.message?.rendered){process.stdout.write(event.message.rendered);}}catch{process.stdout.write(line+'\n');}}});
  child.on('error',error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
  child.on('close',code=>{if(code===0){fs.writeFileSync(output,JSON.stringify(artifacts),{mode:0o600});}process.exitCode=code??1;});
}
if(require.main===module){main(process.argv.slice(2));}
