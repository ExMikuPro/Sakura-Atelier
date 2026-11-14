import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parse, ParseError } from 'jsonc-parser';
import { exists,contained } from './detect';
import { RunnerError } from './model';
/** Read JSONC directly so recently saved launch files do not depend on configuration-cache timing. */
export async function launchConfigurations(folder:vscode.WorkspaceFolder):Promise<vscode.DebugConfiguration[]>{
  const file=path.join(folder.uri.fsPath,'.vscode/launch.json');
  if(!await exists(file)){return vscode.workspace.getConfiguration('launch',folder.uri).get<vscode.DebugConfiguration[]>('configurations',[]);}
  if(!await contained(folder.uri.fsPath,file)){throw new RunnerError('launch.json points outside the workspace.',true);}
  const errors:ParseError[]=[];const document=parse(await fs.readFile(file,'utf8'),errors,{allowTrailingComma:true,disallowComments:false}) as {configurations?:unknown[]}|undefined;
  if(errors.length){throw new RunnerError(`launch.json contains invalid JSONC at offset ${errors[0].offset}.`,true);}
  if(!document?.configurations){return [];}
  if(!Array.isArray(document.configurations)){throw new RunnerError('launch.json configurations must be an array.',true);}
  return document.configurations.filter((entry):entry is vscode.DebugConfiguration=>!!entry&&typeof entry==='object'&&typeof (entry as vscode.DebugConfiguration).name==='string'&&typeof (entry as vscode.DebugConfiguration).type==='string');
}
/** Local task labels only: asking for templates never invokes task providers or a build tool. */
export async function taskLabels(folder:vscode.WorkspaceFolder):Promise<string[]> {
  const file=path.join(folder.uri.fsPath,'.vscode/tasks.json');
  if(!await exists(file)){return [];}
  if(!await contained(folder.uri.fsPath,file)){throw new RunnerError('tasks.json points outside the workspace.',true);}
  const errors:ParseError[]=[];const document=parse(await fs.readFile(file,'utf8'),errors,{allowTrailingComma:true}) as {tasks?:{label?:unknown;isBackground?:boolean}[]};
  if(errors.length||!Array.isArray(document?.tasks)){return [];}
  return document.tasks.filter(t=>t&&typeof t.label==='string'&&!t.isBackground).map(t=>t.label as string);
}
