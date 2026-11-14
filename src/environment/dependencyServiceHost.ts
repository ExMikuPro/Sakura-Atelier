import * as fs from "node:fs/promises";
import * as path from "node:path";
import { TaskExecutor } from "../executor";
import { resolveTool } from "../tools";
import {
  DependencyHost,
  ManagerCommand,
  ProjectDependencyService,
} from "./projectDependencyService";
import { RemediationRunner } from "./remediationRunner";
import { ToolProbe } from "./probe";
import { hostToolchains } from "./registryAccess";
import { EnvironmentError, message } from "./model";
import { confirmRemediation } from "./pythonServiceHost";
/** The selected Python/Node are supplied by the current Run Configuration, never stored globally here. */
export function createProjectDependencyServices(
  selection: { python?: string; node?: string } = {},
): {
  service: ProjectDependencyService;
  runner: RemediationRunner;
  dispose(): void;
} {
  const registry = hostToolchains();
  if (!registry)
    throw new EnvironmentError(
      message("host.unavailable", "宿主工具链服务尚未启动。"),
    );
  const guard = registry.guard;
  const executor = new TaskExecutor("Sakura Atelier 项目依赖");
  const probe = new ToolProbe(guard);
  const host: DependencyHost = {
    python: selection.python,
    tool: async (manager, root) => {
      guard.assert();
      if (manager === "pip")
        return selection.python ? { command: selection.python } : undefined;
      if (manager === "npm" && selection.node) {
        // npm.cmd cannot be executed safely as a ProcessExecution argument array; use its JS entry with the chosen Node.
        const nodePath = await fs.realpath(selection.node);
        for (const script of [
          path.resolve(
            path.dirname(nodePath),
            "../libexec/lib/node_modules/npm/bin/npm-cli.js",
          ),
          path.resolve(
            path.dirname(nodePath),
            "../lib/node_modules/npm/bin/npm-cli.js",
          ),
          path.join(
            path.dirname(selection.node),
            "node_modules/npm/bin/npm-cli.js",
          ),
          path.resolve(
            path.dirname(selection.node),
            "../lib/node_modules/npm/bin/npm-cli.js",
          ),
        ]) {
          if (
            await fs
              .stat(script)
              .then((s) => s.isFile())
              .catch(() => false)
          )
            return { command: selection.node, prefix: [script] };
        }
        try {
          const npm = await fs.realpath(await resolveTool("npm", root));
          if (path.basename(npm) === "npm-cli.js")
            return { command: selection.node, prefix: [npm] };
        } catch {
          /* No compatible installed npm entry was found. */
        }
        return undefined;
      }
      const commands: Record<string, string> = { maven: "mvn" };
      try {
        return {
          command: await resolveTool(commands[manager] ?? manager, root),
        };
      } catch {
        return undefined;
      }
    },
    query: async (tool: ManagerCommand, args, root, signal) => {
      const result = await probe.result(
        tool.command,
        [...(tool.prefix ?? []), ...args],
        root,
        { signal, env: tool.env, timeoutMs: 15000 },
      );
      return { code: result.code, stdout: result.stdout };
    },
  };
  const runner = new RemediationRunner(guard, executor, (plan) =>
    confirmRemediation(guard, plan),
  );
  const service = new ProjectDependencyService(guard, host, runner);
  return {
    service,
    runner,
    dispose() {
      executor.dispose();
    },
  };
}
