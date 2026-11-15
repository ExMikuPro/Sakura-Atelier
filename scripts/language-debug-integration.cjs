const {runTests}=require('@vscode/test-electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {initializedScaffold}=require('../out/src/languageProjects/scaffolds');
const {initializeLanguageProject}=require('../out/src/languageProjects/initialize');
const {initializationRunner}=require('../out/src/languageProjects/process');
(async()=>{
  const sandbox=await fs.mkdtemp(path.join(os.tmpdir(),'lang-dbg-'));
  try{
    const workspace=path.join(sandbox,'project 空格');await fs.mkdir(workspace);
    for(const file of initializedScaffold('typescript','debug-test',{})){const dest=path.join(workspace,file.path);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,file.content);}
    await initializeLanguageProject({language:'typescript',root:workspace,name:'debug-test',sdk:process.execPath,options:{},tools:{}},initializationRunner(()=>{},new AbortController().signal,()=>{}));
    const pythonRoot=path.join(workspace,'python-child');await fs.mkdir(pythonRoot);
    for(const file of initializedScaffold('python','python-debug',{})){const dest=path.join(pythonRoot,file.path);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,file.content);}
    await initializeLanguageProject({language:'python',root:pythonRoot,name:'python-debug',sdk:'/usr/bin/python3',options:{},tools:{}},initializationRunner(()=>{},new AbortController().signal,()=>{}));
    await fs.writeFile(path.join(workspace,'src/index.ts'),'const message: string = "Breakpoint works";\nconsole.log(message);\n');
    await runTests({vscodeExecutablePath:process.env.SAKURA_VSCODE_EXECUTABLE || '/Applications/Visual Studio Code.app/Contents/MacOS/Code',extensionDevelopmentPath:path.resolve(__dirname,'..'),extensionTestsPath:path.resolve(__dirname,'../out/test/suite/language-debug.js'),launchArgs:[workspace,'--user-data-dir',path.join(sandbox,'user'),'--extensions-dir',path.join(sandbox,'extensions'),'--disable-workspace-trust','--skip-welcome','--skip-release-notes','--disable-updates'],extensionTestsEnv:{SAKURA_TS_DEBUG_PROJECT:workspace,SAKURA_TS_NODE:process.execPath}});
  }finally{await fs.rm(sandbox,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
