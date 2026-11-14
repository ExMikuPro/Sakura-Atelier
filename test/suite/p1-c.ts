import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as assert from "node:assert/strict";
import { hostToolchains } from "../../src/environment/registryAccess";
import { createProjectDependencyServices } from "../../src/environment/dependencyServiceHost";
export async function run(): Promise<void> {
  await vscode.extensions.getExtension("ExMikuPro.sakura-atelier")!.activate();
  const registry = hostToolchains()!;
  await registry.settled();
  const node = registry
    .snapshot()
    .tools.find((t) => t.language === "node" && t.available);
  assert.ok(node);
  const services = createProjectDependencyServices({ node: node.executable });
  const root = process.env.SAKURA_P1_WORKSPACE!;
  try {
    await fs.writeFile(
      path.join(root, "package.json"),
      '{"name":"atelier-dependency-fixture","version":"1.0.0"}',
    );
    const [ready] = await services.service.diagnose(root, [root], {
      checkInstalled: true,
    });
    assert.equal(ready.state, "ready");
    await fs.writeFile(
      path.join(root, "package.json"),
      '{"name":"atelier-dependency-fixture","version":"1.0.0","dependencies":{"atelier-p1-not-installed-fixture":"1.0.0"}}',
    );
    const [missing] = await services.service.diagnose(root, [root], {
      checkInstalled: true,
    });
    assert.equal(missing.state, "missing");
    assert.equal(missing.evidence, "official-query");
    assert.equal((await fs.readdir(root)).includes("node_modules"), false);
    await fs.writeFile(
      path.join(root, "go.mod"),
      "module atelier.test\ngo 1.22\n",
    );
    await fs.writeFile(
      path.join(root, "Cargo.toml"),
      '[package]\nname="test"\nversion="0.1.0"\n',
    );
    const statuses = await services.service.diagnose(root, [root]);
    assert.ok(
      statuses.some((s) => s.manager === "go" && s.state === "unknown"),
    );
    assert.ok(
      statuses.some((s) => s.manager === "cargo" && s.state === "unknown"),
    );
    await fs.writeFile(
      process.env.SAKURA_P1_REPORT!,
      JSON.stringify(
        {
          vscode: vscode.version,
          platform: process.platform,
          arch: process.arch,
          tests: [
            "所选 Node 执行 npm JS 入口",
            "npm 官方依赖树空项目 Ready",
            "npm 官方缺失依赖 Missing",
            "Go/Cargo 声明 Unknown",
            "只读诊断不创建 node_modules",
          ],
          installs: "未执行依赖安装或系统 SDK 安装",
          otherPlatforms: "Linux/Windows/WSL/SSH/容器未实机验证",
        },
        null,
        2,
      ),
    );
  } finally {
    services.dispose();
  }
}
