const {runTests}=require('@vscode/test-electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
(async()=>{
  const sandbox=await fs.mkdtemp(path.join(os.tmpdir(),'sakura-intellisense-空格 '));
  try{
    const workspace=path.join(sandbox,'workspace');
    for(const dir of ['Inc','Src','cmake/stm32cubemx','.vscode'])await fs.mkdir(path.join(workspace,dir),{recursive:true});
    await fs.writeFile(path.join(workspace,'board.ioc'),'Mcu.Name=STM32F302x8\n');
    await fs.writeFile(path.join(workspace,'CMakeLists.txt'),'project(board)\n# STM32');
    await fs.writeFile(path.join(workspace,'cmake/stm32cubemx/CMakeLists.txt'),'set(MX_Defines_Syms USE_HAL_DRIVER STM32F302x8)\nset(MX_Include_Dirs "${CMAKE_CURRENT_SOURCE_DIR}/../../Inc")');
    await fs.writeFile(path.join(workspace,'Inc/main.h'),'typedef struct { unsigned Mode;\n#ifdef DATABASE_ONLY\nunsigned DatabaseMember;\n#endif\n} GPIO_InitTypeDef;\n');
    await fs.writeFile(path.join(workspace,'Src/main.c'),'#include "main.h"\n\nvoid test(void) { GPIO_InitTypeDef gpio; gpio.\n}\n');
    await fs.writeFile(path.join(workspace,'.vscode/settings.json'),JSON.stringify({'extensions.ignoreRecommendations':true,'C_Cpp.intelliSenseCacheSize':0,'C_Cpp.loggingLevel':'Debug'}));
    const extensions=path.join(os.homedir(),'.vscode/extensions');
    const cpp=process.env.SAKURA_CPPTOOLS_PATH || path.join(extensions,(await fs.readdir(extensions)).filter(name=>/^ms-vscode\.cpptools-\d/.test(name)).sort().reverse()[0] || 'missing');
    await fs.access(path.join(cpp,'package.json'));
    await runTests({vscodeExecutablePath:process.env.SAKURA_VSCODE_EXECUTABLE || '/Applications/Visual Studio Code.app/Contents/MacOS/Code',extensionDevelopmentPath:[path.resolve(__dirname,'..'),cpp],extensionTestsPath:path.resolve(__dirname,'../out/test/suite/stm32-intellisense.js'),launchArgs:[workspace,'--user-data-dir',path.join(sandbox,'user'),'--extensions-dir',path.join(sandbox,'extensions'),'--disable-workspace-trust','--skip-welcome','--skip-release-notes','--disable-updates'],extensionTestsEnv:{SAKURA_STM32_COMPLETION_WORKSPACE:workspace}});
  }finally{await fs.cp(path.join(sandbox,'user/logs'),path.join(os.tmpdir(),'sakura-cpp-integration-logs'),{recursive:true,force:true}).catch(()=>{});await fs.rm(sandbox,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
