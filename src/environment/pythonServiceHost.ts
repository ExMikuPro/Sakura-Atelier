import * as vscode from "vscode";
import * as path from "node:path";
import { PythonEnvironments } from "../pythonEnvironments";
import { TaskExecutor } from "../executor";
import { resolveTool } from "../tools";
import {
  PythonEnvironmentService,
  PythonEnvironmentPort,
} from "./pythonEnvironmentService";
import { RemediationRunner } from "./remediationRunner";
import { HostGuard } from "./host";
import { hostToolchains } from "./registryAccess";
import { EnvironmentError, message, RemediationPlan } from "./model";
/** Stable service factory for P0. Callers dispose it alongside their panel/controller. */
export function createPythonEnvironmentServices(
  python = new PythonEnvironments(),
): {
  service: PythonEnvironmentService;
  runner: RemediationRunner;
  dispose(): void;
} {
  const registry = hostToolchains();
  if (!registry)
    throw new EnvironmentError(
      message("host.unavailable", "宿主工具链服务尚未启动。"),
    );
  const guard: HostGuard = registry.guard;
  const executor = new TaskExecutor("Sakura Atelier 项目环境");
  const folder = (root: string): vscode.WorkspaceFolder => {
    const owner = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(root));
    if (!owner)
      throw new EnvironmentError(
        message("scope.outside", "项目不属于当前工作区。"),
      );
    return { ...owner, uri: vscode.Uri.file(root) };
  };
  const port: PythonEnvironmentPort = {
    discover: (root) => python.discover(folder(root)),
    managers: async (root) => {
      const results = ["venv"];
      for (const name of ["uv", "poetry", "pipenv", "conda"]) {
        try {
          await resolveTool(name, root);
          results.push(name);
        } catch {
          /* Report only available managers; do not install. */
        }
      }
      return results;
    },
    synchronize: async (executable, root) => {
      await python.synchronize(executable, folder(root).uri);
      return python.mismatch;
    },
    terminal: (executable, root, cwd, activate) =>
      python.createTerminal(executable, folder(root), cwd, activate),
    createOfficial: async (root) => {
      const api = await python.modern();
      if (!api?.createEnvironment)
        throw new EnvironmentError(
          message(
            "python.apiUnavailable",
            "官方 Python Environments 创建 API 不可用，请显式选择 venv/uv 后备计划。",
          ),
        );
      const env = await api.createEnvironment(folder(root).uri, {
        quickCreate: false,
      });
      if (!env) return undefined;
      return {
        id: env.envId.id,
        language: "python",
        name: env.displayName,
        version: env.version,
        manager: env.envId.managerId,
        executable: env.execInfo.run.executable,
        project: folder(root).uri.toString(),
      };
    },
  };
  const runner = new RemediationRunner(guard, executor, (plan) =>
    confirmRemediation(guard, plan),
  );
  const service = new PythonEnvironmentService(
    guard,
    port,
    runner,
    async (root) =>
      (await vscode.window.showWarningMessage(
        `目标环境：${guard.environment.label}\n项目：${root}\n将打开官方 Python Environments 创建向导。该扩展可能选择环境目录、解释器并安装项目依赖；Sakura Atelier 不指定下载或覆盖操作，也无法取消其内部任务。请在向导中核对操作。`,
        { modal: true },
        "打开创建向导",
      )) === "打开创建向导",
  );
  return {
    service,
    runner,
    dispose() {
      executor.dispose();
      python.dispose();
    },
  };
}
export async function confirmRemediation(
  guard: HostGuard,
  plan: RemediationPlan,
): Promise<boolean> {
  guard.assert(plan.hostId);
  const commands = plan.run.steps
    .map((s) => [s.command, ...s.args].map((v) => JSON.stringify(v)).join(" "))
    .join("\n");
  const text = `${plan.title.message}\n目标环境：${guard.environment.label} (${guard.environment.platform}/${guard.environment.arch})\n工作目录：${plan.root}\n命令（按参数数组执行）：\n${commands}\n可能修改：\n${plan.mayModify.join("\n")}\n${plan.mayExecuteCode ? "可能运行安装脚本、项目构建或第三方代码。" : ""}\n不修改系统默认 SDK。`;
  return (
    (await vscode.window.showWarningMessage(text, { modal: true }, "执行")) ===
    "执行"
  );
}
export const pythonEnvironmentExecutable = (
  root: string,
  platform: NodeJS.Platform = process.platform,
): string =>
  path.join(root, platform === "win32" ? "Scripts/python.exe" : "bin/python");
