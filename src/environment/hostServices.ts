import * as vscode from "vscode";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ToolchainDiscovery } from "../toolchains";
import { PythonEnvironments } from "../pythonEnvironments";
import type { LocalToolchain, RuntimeLanguage } from "../configuration";
import { HostGuard, identifyHost } from "./host";
import { ToolProbe } from "./probe";
import { ToolchainRegistry } from "./toolchainRegistry";
import {
  hostCandidates,
  safeAutomaticCandidate,
  HostCandidate,
} from "./hostSearch";
import { hostToolchains, setHostToolchains } from "./registryAccess";
export { hostToolchains } from "./registryAccess";
/** Kept outside P0's controller/UI. Cached snapshots are available synchronously after the async disk read. */
export function startHostToolchains(
  context: vscode.ExtensionContext,
): vscode.Disposable {
  const environment = identifyHost({
    remoteName: vscode.env.remoteName,
    authority: vscode.workspace.workspaceFolders?.find(
      (f) => f.uri.scheme === "vscode-remote",
    )?.uri.authority,
    hostname: os.hostname(),
    machineId: vscode.env.machineId,
    platform: process.platform,
    arch: process.arch,
    extensionKind:
      context.extension.extensionKind === vscode.ExtensionKind.Workspace
        ? "workspace"
        : "ui",
  });
  const guard = new HostGuard(environment, () => vscode.workspace.isTrusted);
  const probe = new ToolProbe(guard);
  const python = new PythonEnvironments();
  const discovery = new ToolchainDiscovery(python);
  const cwd = context.globalStorageUri.fsPath;
  const synthetic: vscode.WorkspaceFolder = {
    name: "Sakura Atelier 主机工具链",
    index: 0,
    uri: context.globalStorageUri,
  };
  const registry = new ToolchainRegistry(cwd, guard, async (signal) => {
    await fs.mkdir(cwd, { recursive: true });
    const roots = (vscode.workspace.workspaceFolders ?? []).map(
      (f) => f.uri.fsPath,
    );
    const candidates: HostCandidate[] = [];
    for (const candidate of await hostCandidates()) {
      if (!safeAutomaticCandidate(candidate, roots)) continue;
      const real = await fs
        .realpath(candidate.executable)
        .catch(() => undefined);
      if (
        !real ||
        !safeAutomaticCandidate({ ...candidate, executable: real }, roots) ||
        /^(rustup|volta(?:-shim)?)(?:\.exe)?$/i.test(path.basename(real)) ||
        (process.platform === "darwin" &&
          candidate.language === "java" &&
          candidate.executable === "/usr/bin/java")
      )
        continue;
      candidates.push(candidate);
    }
    const output: LocalToolchain[] = [];
    const languages: RuntimeLanguage[] = [
      "go",
      "rust",
      "python",
      "node",
      "c",
      "cpp",
      "csharp",
      "java",
    ];
    let next = 0;
    const worker = async () => {
      for (;;) {
        const index = next++;
        if (index >= languages.length) return;
        const language = languages[index];
        const entries = candidates.filter((c) => c.language === language);
        const found = await discovery.discover(language, synthetic, {
          candidates: entries.map((c) => c.executable),
          physicalRust: true,
          query: (command, args, dir, env) =>
            probe.run(command, args, dir, { signal, env }),
        });
        for (const tool of found) {
          const canonical = await fs
            .realpath(tool.executable)
            .catch(() => tool.executable);
          let source = entries.find((c) => c.executable === tool.executable);
          if (!source) {
            for (const candidate of entries) {
              if (
                (await fs
                  .realpath(candidate.executable)
                  .catch(() => candidate.executable)) === canonical
              ) {
                source = candidate;
                break;
              }
            }
          }
          const entry = {
            ...tool,
            project: "",
            manager: source?.source ?? tool.manager,
            ...(source?.variant ? { rustToolchain: source.variant } : {}),
          };
          if (language === "rust") {
            try {
              const compilerVersion = await probe.run(
                path.join(
                  path.dirname(tool.executable),
                  process.platform === "win32" ? "rustc.exe" : "rustc",
                ),
                ["--version"],
                cwd,
                { signal },
              );
              output.push({ ...entry, compilerVersion } as LocalToolchain);
            } catch {
              output.push(entry);
            }
          } else if (language === "csharp") {
            for (const line of (tool.details || tool.version).split(/\r?\n/)) {
              const version = line.trim().split(/\s/)[0];
              if (/^\d+\.\d+\.\d+/.test(version))
                output.push({
                  ...entry,
                  id: tool.id + "-" + version,
                  version,
                  sdkVersion: version,
                } as LocalToolchain);
            }
          } else output.push(entry);
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    return output;
  });
  setHostToolchains(registry);
  const ready = registry.start(
    context.globalState.get<LocalToolchain[]>("atelier.toolchains", []),
  );
  void ready.catch((error) =>
    console.error("Sakura Atelier 工具链注册表：", error),
  );
  const trusted = vscode.workspace.onDidGrantWorkspaceTrust(() => {
    void registry.refresh();
  });
  const command = vscode.commands.registerCommand(
    "sakuraAtelier.openToolchainRegistry",
    async () => {
      await ready;
      await vscode.window.showTextDocument(
        await vscode.workspace.openTextDocument(vscode.Uri.file(registry.file)),
      );
    },
  );
  return {
    dispose() {
      trusted.dispose();
      command.dispose();
      registry.dispose();
      python.dispose();
      if (hostToolchains() === registry) setHostToolchains(undefined);
    },
  };
}
