import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as assert from "node:assert/strict";
import {
  createPythonEnvironmentServices,
  pythonEnvironmentExecutable,
} from "../../src/environment/pythonServiceHost";
import { PythonEnvironments } from "../../src/pythonEnvironments";
import { hostToolchains } from "../../src/environment/registryAccess";
import { RemediationRunner } from "../../src/environment/remediationRunner";
import {
  PythonEnvironmentService,
  PythonEnvironmentPort,
} from "../../src/environment/pythonEnvironmentService";
import { TaskExecutor } from "../../src/executor";
export async function run(): Promise<void> {
  await vscode.extensions.getExtension("ExMikuPro.sakura-atelier")!.activate();
  const registry = hostToolchains()!;
  await registry.settled();
  const root = process.env.SAKURA_P1_WORKSPACE!;
  await fs.writeFile(
    path.join(root, "pyproject.toml"),
    '[project]\nname="test"\nversion="0.0.0"\nrequires-python=">=3.9"\n',
  );
  const python = new PythonEnvironments();
  const folder = vscode.workspace.workspaceFolders![0];
  const base = (await python.discover(folder)).find(
    (e) => e.manager === "system",
  );
  assert.ok(base);
  const executor = new TaskExecutor("P1 Python 测试");
  const port: PythonEnvironmentPort = {
    discover: () => python.discover(folder),
    managers: async () => ["venv"],
    synchronize: async (exe) => {
      await python.synchronize(exe, folder.uri);
      return python.mismatch;
    },
    terminal: (exe, _scope, cwd, active) =>
      python.createTerminal(exe, folder, cwd, active),
  };
  // Confirmation is injected only in this temp-fixture host test; production uses a native modal.
  const runner = new RemediationRunner(
    registry.guard,
    executor,
    async () => true,
  );
  const service = new PythonEnvironmentService(
    registry.guard,
    port,
    runner,
    async () => false,
  );
  try {
    const state = await service.diagnose(root, [root]);
    const plan = await service.prepareCreation(state, base);
    assert.equal((await runner.execute(plan.id)).state, "completed");
    const exe = pythonEnvironmentExecutable(path.join(root, ".venv"));
    assert.ok(
      (await python.discover(folder)).some((e) => e.executable === exe),
    );
    const selected = await service.useExisting(
      await service.diagnose(root, [root]),
      exe,
    );
    assert.equal(selected.toolchain, exe);
    await assert.rejects(service.prepareCreation(state, base), /已存在/);
    const a = await service.terminal(state, exe);
    const b = await service.terminal(state, exe);
    assert.equal(a, b);
    const production = createPythonEnvironmentServices();
    production.dispose();
    await fs.writeFile(
      process.env.SAKURA_P1_REPORT!,
      JSON.stringify(
        {
          vscode: vscode.version,
          platform: process.platform,
          arch: process.arch,
          tests: [
            "临时项目 venv 创建",
            "创建后发现",
            "已有目录保护",
            "选择显式解释器",
            "终端复用避免重复激活",
          ],
          officialPythonApi:
            "隔离宿主未安装官方 Python 扩展；同步不一致明确返回，现代 API 只做契约测试",
          debug: "未实测 Python Debug Adapter",
          terminal: "已验证创建与复用，未自动采集交互 shell 的激活结果",
        },
        null,
        2,
      ),
    );
  } finally {
    python.dispose();
    await executor.shutdown();
  }
}
