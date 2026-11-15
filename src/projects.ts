import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { RuntimeLanguage } from './configuration';
import { contained } from './detect';
export interface ProjectRecord { folder: vscode.WorkspaceFolder; root: string; marker: string; languages: RuntimeLanguage[] }
/** Metadata-only inventory: multiple languages coexist; no tools or workspace code run on activation. */
export async function scanProjects(folder: vscode.WorkspaceFolder): Promise<ProjectRecord[]> {
  const markers:vscode.Uri[]=[];
  const excluded=new Set(['node_modules','.git','.venv','venv','target','build','dist','out','.pio','.test-output','.vscode-test']);
  const pending=[folder.uri.fsPath];let visited=0;
  const marker=/^(platformio\.ini|go\.(mod|work)|Cargo\.toml|pyproject\.toml|requirements\.txt|Pipfile|package\.json|tsconfig\.json|CMakeLists\.txt|Makefile|pom\.xml|build\.gradle(?:\.kts)?)$|\.(csproj|sln|slnx)$/;
  while(pending.length&&visited++<10000&&markers.length<1000){
    const directory=pending.pop()!;if(!await contained(folder.uri.fsPath,directory)){continue;}
    const entries=await fs.readdir(directory,{withFileTypes:true}).catch(()=>[]);
    for(const entry of entries){if(entry.isSymbolicLink()){continue;}const file=path.join(directory,entry.name);if(entry.isDirectory()&&!excluded.has(entry.name)){pending.push(file);}else if(entry.isFile()&&marker.test(entry.name)){markers.push(vscode.Uri.file(file));}}
  }
  const records: ProjectRecord[] = [];
  for (const uri of markers) {
    if (!await contained(folder.uri.fsPath, uri.fsPath)) { continue; }
    const marker = path.basename(uri.fsPath); const root = path.dirname(uri.fsPath);
    let languages: RuntimeLanguage[] = [];
    if (/^go\.(mod|work)$/.test(marker)) { languages = ['go']; }
    else if (marker === 'Cargo.toml') { languages = ['rust']; }
    else if (['pyproject.toml','requirements.txt','Pipfile'].includes(marker)) { languages = ['python']; }
    else if (marker === 'package.json') { languages = ['javascript','typescript','node']; }
    else if (marker === 'tsconfig.json') { languages = ['typescript']; }
    else if (marker === 'platformio.ini') { languages = ['c','cpp']; }
    else if (marker === 'CMakeLists.txt') { languages = ['c','cpp']; }
    else if (marker === 'Makefile') {
      const entries = await fs.readdir(root);
      if (entries.some(e => /\.c$/i.test(e))) { languages.push('c'); }
      if (entries.some(e => /\.(cpp|cxx|cc)$/i.test(e))) { languages.push('cpp'); }
    } else if (/\.(csproj|sln|slnx)$/.test(marker)) { languages = ['csharp']; }
    else { languages = ['java']; }
    records.push({ folder, root, marker, languages });
  }
  return records.sort((a,b) => a.root.localeCompare(b.root) || a.marker.localeCompare(b.marker));
}
