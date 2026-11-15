import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { ConfigurationFile, newConfiguration, portablePath } from '../../configuration';
import { chooseEnvironment } from './plans';
import { PlatformioProject } from './project';
export const managedOperations = {build:'编译',upload:'运行（编译并上传）',debug:'调试',monitor:'串口监视',test:'测试',clean:'清理'};
export function mergePlatformioConfigurations(document: ConfigurationFile, projects: PlatformioProject[], workspace: string): ConfigurationFile {
  const configurations=[...document.configurations];
  for (const project of projects) {
    const relative=path.relative(workspace,project.root).split(path.sep).join('/') || '.';
    const prefix='pio-'+createHash('sha256').update(relative).digest('hex').slice(0,12);
    for (const [action,label] of Object.entries(managedOperations)) {
      const target=portablePath(project.root,workspace), id=`${prefix}-${action}`;
      if (configurations.some(c=>c.id===id || c.templateId==='platformio' && c.target===target && c.pioAction===action)) continue;
      const choice=chooseEnvironment(project);
      configurations.push({...newConfiguration('cpp',`PlatformIO — ${label} · ${path.basename(project.root)}`),id,templateId:'platformio',kind:'project',target,cwd:target,pioAction:action,pioEnvironment:choice.kind==='selected'?choice.env:''});
    }
  }
  return {...document,configurations};
}
