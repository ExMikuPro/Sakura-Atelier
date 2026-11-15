import {projectScaffold,ScaffoldFile,ProjectLanguage} from '../projectScaffolds';
import {newConfiguration,validateFile} from '../configuration';
import {LanguageProjectOptions} from './options';
const json=(value:unknown)=>JSON.stringify(value,null,2)+'\n';
export function initializedScaffold(language:ProjectLanguage,name:string,options:LanguageProjectOptions):ScaffoldFile[]{
  const files=projectScaffold(language,name);
  if(language==='python'){
    const config=files.find(f=>f.path==='.vscode/sakura-atelier.json')!;
    const document=validateFile(JSON.parse(config.content));
    document.configurations[0].toolchain='${workspaceFolder}/.venv';
    config.content=json(document);
    files.push({path:options.pythonManager==='uv'?'uv.toml':'requirements.txt',content:options.pythonManager==='uv'?'# Managed with uv. Use uv add <package>.\n':'# Install with .venv Python: python -m pip install -r requirements.txt\n'});
  }
  if(language==='typescript'){
    if(options.nodeManager==='pnpm')files.push({path:'pnpm-workspace.yaml',content:'allowBuilds:\n  esbuild: true\n'});
    const entry=files.find(f=>f.path==='src/main.ts')!;entry.path='src/index.ts';
    files.find(f=>f.path==='package.json')!.content=json({name:name.toLowerCase().replace(/[^a-z0-9-]/g,'-'),version:'0.1.0',private:true,type:'module',scripts:{dev:'tsx src/index.ts',build:'tsc -p tsconfig.json',start:'node dist/index.js'},devDependencies:{tsx:'^4.23.15',typescript:'^5.7.0','@types/node':'^22.0.0'}});
    files.find(f=>f.path==='tsconfig.json')!.content=json({compilerOptions:{target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext',strict:true,rootDir:'src',outDir:'dist',sourceMap:true,inlineSources:true,types:['node']},include:['src/**/*.ts']});
    const run={...newConfiguration('typescript',name+' · 运行'),id:'run',templateId:'typescript.project',kind:'project' as const,target:'${workspaceFolder}/src/index.ts',script:'dev',packageManager:options.nodeManager || 'npm'};
    const build={...run,id:'build',name:name+' · 编译',operation:'build' as const,script:'build'};
    files.find(f=>f.path==='.vscode/sakura-atelier.json')!.content=json({version:1,default:'run',configurations:[run,build]});
    files.find(f=>f.path==='README.md')!.content=`# ${name}\n\n依赖由 Sakura Atelier 初始化。\n\n- 开发：${run.packageManager} run dev\n- 编译：${run.packageManager} run build\n- 产物：${run.packageManager} start\n\nSakura Atelier 可直接运行、编译或调试 src/index.ts。\n`;
  }
  return files;
}
