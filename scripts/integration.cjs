const { runTests, downloadAndUnzipVSCode } = require('@vscode/test-electron');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
(async () => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'sakura-host-'));
  let workspace = path.join(sandbox, 'workspace 空格 & $');
  await fs.mkdir(path.join(workspace, '.vscode'), { recursive: true });
  workspace=await fs.realpath(workspace);
  await fs.writeFile(path.join(workspace, '.vscode/tasks.json'), JSON.stringify({ version: '2.0.0', tasks: [{ label: 'Maven project run', type: 'process', command: process.execPath, args: ['-e', 'require("node:fs").writeFileSync("task-result", "ok")'], options: { cwd: '${workspaceFolder}/maven project' }, problemMatcher: [] }] }));
  await fs.writeFile(path.join(workspace, '.vscode/settings.json'), JSON.stringify({ 'security.workspace.trust.enabled': false, 'telemetry.telemetryLevel': 'off', 'update.mode': 'none', 'extensions.autoCheckUpdates': false, 'task.autoDetect': 'off', 'python-envs.terminal.autoActivationType':'command', 'python.useEnvironmentsExtension':true, 'extensions.ignoreRecommendations':true }));
  const otherProject=path.join(sandbox,'other project');await fs.mkdir(otherProject);const workspaceFile=path.join(sandbox,'atelier.code-workspace');await fs.writeFile(workspaceFile,JSON.stringify({folders:[{path:workspace},{path:otherProject}]}));
  // User settings belong exclusively to this disposable Development Host.
  const userData = path.join(sandbox, 'user');
  await fs.mkdir(path.join(userData, 'User'), { recursive: true });
  await fs.writeFile(path.join(userData, 'User/settings.json'), JSON.stringify({ 'security.workspace.trust.enabled': false, 'telemetry.telemetryLevel': 'off', 'workbench.startupEditor': 'none', 'window.restoreWindows': 'none', 'update.mode': 'none' }));
  try {
    const developmentPaths=[process.env.SAKURA_TEST_EXTENSION_PATH || path.resolve(__dirname, '..')];
    if(process.env.SAKURA_TEST_ADAPTERS==='1'){
      const roots=[path.join(os.homedir(),'.vscode/extensions'),path.resolve(__dirname,'../.test-output/debug-extensions')];
      for(const root of roots){
        const entries=await fs.readdir(root).catch(()=>[]);
        for(const name of entries.filter(name=>/^(ms-python\.(debugpy|python|vscode-python-envs)-|vadimcn\.vscode-lldb-)/.test(name))){
          const destination=path.join(sandbox,'adapters',name);await fs.cp(path.join(root,name),destination,{recursive:true});developmentPaths.push(destination);
        }
      }
    }
    const version = process.env.SAKURA_VSCODE_VERSION || '1.85.2';
    let executable = process.env.SAKURA_VSCODE_EXECUTABLE || await downloadAndUnzipVSCode(version);
    if (process.platform === 'darwin' && !process.env.SAKURA_VSCODE_EXECUTABLE) {
      // Newer official app bundles name their executable Code instead of Electron.
      try { await fs.access(executable); }
      catch { executable = path.join(path.dirname(executable), 'Code'); await fs.access(executable); }
    }
    await runTests({
      version,
      vscodeExecutablePath: executable,
      extensionDevelopmentPath: developmentPaths,
      extensionTestsPath: path.resolve(__dirname, process.env.SAKURA_TEST_SUITE==='advanced'?'../out/test/suite/advanced.js':process.env.SAKURA_TEST_SUITE==='wizard'?'../out/test/suite/wizard.js':'../out/test/suite/index.js'),
      launchArgs: [...(process.env.SAKURA_TEST_CDP_PORT ? [`--remote-debugging-port=${process.env.SAKURA_TEST_CDP_PORT}`, '--remote-debugging-address=127.0.0.1'] : []), workspaceFile, '--user-data-dir', userData, '--extensions-dir', path.join(sandbox, 'extensions'), '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--disable-updates'],
      extensionTestsEnv: { ...(process.env.SAKURA_TEST_CDP_PORT ? { SAKURA_TEST_CDP_PORT: process.env.SAKURA_TEST_CDP_PORT } : {}), ...(process.env.SAKURA_TEST_JAVA_BIN ? { SAKURA_TEST_JAVA_BIN: process.env.SAKURA_TEST_JAVA_BIN } : {}), SAKURA_TEST_WORKSPACE: workspace, SAKURA_TEST_REPORT: path.resolve(__dirname, process.env.SAKURA_TEST_SUITE==='advanced'?'../.test-output/advanced-integration.json':'../.test-output/integration.json') }
    });
  } finally { await fs.rm(sandbox, { recursive: true, force: true }); }
})().catch(error => { process.stderr.write(String(error) + '\n'); process.exitCode = 1; });
