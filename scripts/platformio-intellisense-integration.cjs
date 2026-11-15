const {runTests}=require('@vscode/test-electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
(async()=>{
  const sandbox=await fs.mkdtemp(path.join(os.tmpdir(),'pio-ci-'));
  try{
    const workspace=path.join(sandbox,'workspace 空格');
    await fs.mkdir(path.join(workspace,'src'),{recursive:true});
    await fs.writeFile(path.join(workspace,'platformio.ini'),'[env:esp32dev]\nplatform=espressif32\nboard=esp32doit-devkit-v1\nframework=arduino\n');
    await fs.writeFile(path.join(workspace,'src/main.cpp'),'#include <Arduino.h>\nvoid setup(){ Serial.\n}\nvoid loop(){}\n');
    const extensions=path.join(os.homedir(),'.vscode/extensions');
    const cpp=process.env.SAKURA_CPPTOOLS_PATH || path.join(extensions,(await fs.readdir(extensions)).filter(name=>/^ms-vscode\.cpptools-\d/.test(name)).sort().reverse()[0] || 'missing');
    await fs.access(path.join(cpp,'package.json'));
    await runTests({vscodeExecutablePath:process.env.SAKURA_VSCODE_EXECUTABLE || '/Applications/Visual Studio Code.app/Contents/MacOS/Code',extensionDevelopmentPath:[path.resolve(__dirname,'..'),cpp],extensionTestsPath:path.resolve(__dirname,'../out/test/suite/platformio-intellisense.js'),launchArgs:[workspace,'--user-data-dir',path.join(sandbox,'user'),'--extensions-dir',path.join(sandbox,'extensions'),'--disable-workspace-trust','--skip-welcome','--skip-release-notes','--disable-updates'],extensionTestsEnv:{SAKURA_PIO_COMPLETION_WORKSPACE:workspace}});
  }finally{await fs.cp(path.join(sandbox,'user/logs'),path.join(os.tmpdir(),'sakura-pio-cpp-logs'),{recursive:true,force:true}).catch(()=>{});await fs.rm(sandbox,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
