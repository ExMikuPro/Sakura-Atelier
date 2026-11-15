const {runTests}=require('@vscode/test-electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
(async()=>{
  const sandbox=await fs.mkdtemp(path.join(os.tmpdir(),'sakura-pio-集成 空格 '));
  try {
    const workspace=path.join(sandbox,'workspace');
    for(const folder of ['first','second']) {
      const root=path.join(workspace,folder,'deep','firmware');
      await fs.mkdir(path.join(root,'src'),{recursive:true});
      await fs.writeFile(path.join(root,'platformio.ini'),'[env:dev]\nplatform=espressif32\nboard=esp32dev\nframework=arduino\n[env:other]\nplatform=ststm32\nboard=nucleo_f401re\n');
      await fs.writeFile(path.join(root,'CMakeLists.txt'),'# STM32');
      await fs.writeFile(path.join(root,'board.ioc'),'Mcu.Name=STM32F401RETx\n');
      await fs.writeFile(path.join(root,'src/main.cpp'),'int main(){return 0;}\n');
    }
    const config=path.join(sandbox,'test.code-workspace');
    await fs.writeFile(config,JSON.stringify({folders:[{path:path.join(workspace,'first')},{path:path.join(workspace,'second')}]}));
    await runTests({vscodeExecutablePath:process.env.SAKURA_VSCODE_EXECUTABLE || '/Applications/Visual Studio Code.app/Contents/MacOS/Code',extensionDevelopmentPath:path.resolve(__dirname,'..'),extensionTestsPath:path.resolve(__dirname,'../out/test/suite/platformio.js'),launchArgs:[config,'--user-data-dir',path.join(sandbox,'user'),'--extensions-dir',path.join(sandbox,'extensions'),'--disable-workspace-trust','--skip-welcome','--skip-release-notes','--disable-updates'],extensionTestsEnv:{SAKURA_PLATFORMIO_SANDBOX:sandbox,SAKURA_TEST_NODE:process.execPath}});
  } finally {await fs.rm(sandbox,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
