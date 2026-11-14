const { runTests } = require("@vscode/test-electron");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
(async () => {
  const suite = process.argv[2] || "p1-a";
  if (!/^p1-[abc]$/.test(suite)) throw new Error("请选择 p1-a、p1-b 或 p1-c。");
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "atelier-p1-host-"));
  const workspace = path.join(sandbox, "项目 空格");
  await fs.mkdir(workspace);
  try {
    await runTests({
      version: "1.85.2",
      ...(process.env.SAKURA_VSCODE_EXECUTABLE
        ? { vscodeExecutablePath: process.env.SAKURA_VSCODE_EXECUTABLE }
        : {}),
      extensionDevelopmentPath: path.resolve(__dirname, ".."),
      extensionTestsPath: path.resolve(
        __dirname,
        "../out/test/suite/" + suite + ".js",
      ),
      launchArgs: [
        workspace,
        "--user-data-dir",
        path.join(sandbox, "user"),
        "--extensions-dir",
        path.join(sandbox, "extensions"),
        "--disable-workspace-trust",
        "--skip-welcome",
        "--skip-release-notes",
      ],
      extensionTestsEnv: {
        SAKURA_P1_WORKSPACE: workspace,
        SAKURA_P1_REPORT: path.resolve(
          __dirname,
          "../.test-output/" + suite + "-host.json",
        ),
      },
    });
  } finally {
    await fs.rm(sandbox, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
