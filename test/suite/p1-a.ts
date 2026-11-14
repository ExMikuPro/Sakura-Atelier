import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as assert from "node:assert/strict";
import { hostToolchains } from "../../src/environment/registryAccess";
import { ProjectToolchainResolver } from "../../src/environment/projectToolchainResolver";
export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension("ExMikuPro.sakura-atelier");
  assert.ok(extension);
  await extension.activate();
  const registry = hostToolchains();
  assert.ok(registry);
  await registry.settled();
  await registry.refresh();
  const first = registry.snapshot();
  assert.equal(first.host.platform, process.platform);
  assert.equal(first.host.arch, process.arch);
  const root = process.env.SAKURA_P1_WORKSPACE!;
  await fs.mkdir(path.join(root, "backend"), { recursive: true });
  await fs.writeFile(
    path.join(root, "backend/go.mod"),
    "module atelier.test\n\ngo 1.22\n",
  );
  const file = path.join(root, "backend/main.go");
  await fs.writeFile(file, "package main\nfunc main(){}\n");
  const result = await new ProjectToolchainResolver().resolve({
    file,
    workspaces: [root],
    language: "go",
    toolchains: first.tools,
    discoveryComplete: true,
  });
  assert.equal(result.root, path.join(await fs.realpath(root), "backend"));
  const languages = [
    ...new Set(first.tools.filter((t) => t.available).map((t) => t.language)),
  ];
  assert.ok(languages.includes("node"));
  assert.ok(languages.includes("python"));
  assert.ok(languages.includes("go"));
  assert.ok(!registry.file.startsWith(root + path.sep));
  assert.ok(first.tools.every((t) => t.hostId === first.host.id));
  const commands = await vscode.commands.getCommands();
  assert.ok(commands.includes("sakuraAtelier.openToolchainRegistry"));
  await fs.writeFile(
    process.env.SAKURA_P1_REPORT!,
    JSON.stringify(
      {
        vscode: vscode.version,
        platform: process.platform,
        arch: process.arch,
        languages,
        tests: [
          "启动异步发现",
          "全局 JSON 注册表",
          "实际宿主平台与架构",
          "工作区外存储",
          "真实 Go 版本约束",
          "旧 Run 命令兼容",
        ],
        remotePlatforms: "仅模拟测试，WSL/SSH/容器未实际验证",
      },
      null,
      2,
    ),
  );
  console.log("P1-A actual SDKs:", languages.join(", "));
}
