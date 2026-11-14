import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { LocalToolchain } from "../configuration";
import { HostGuard } from "./host";
import { fingerprint, metadata, pathWithin, projectScope } from "./metadata";
import {
  EnvironmentError,
  EnvironmentMessage,
  message,
  RemediationPlan,
  ToolchainRequirement,
} from "./model";
import {
  ProjectToolchainResolver,
  diagnoseToolchain,
  discoveredCandidates,
} from "./projectToolchainResolver";
import { RemediationRunner } from "./remediationRunner";
export interface PythonEnvironmentPort {
  discover(scope: string): Promise<LocalToolchain[]>;
  managers(root: string): Promise<string[]>;
  synchronize(executable: string, scope: string): Promise<string>;
  createOfficial?(scope: string): Promise<LocalToolchain | undefined>;
  terminal(
    executable: string,
    scope: string,
    cwd: string,
    activate: boolean,
  ): Promise<unknown>;
}
export interface PythonEnvironmentStatus {
  workspace: string;
  root: string;
  requirements: ToolchainRequirement[];
  environments: LocalToolchain[];
  directories: { name: string; exists: boolean }[];
  managers: string[];
  recommended: string;
  state: "missing" | "incompatible" | "available" | "unknown";
  dependencies: "unknown";
  diagnostics: EnvironmentMessage[];
}
const files = [
  ".python-version",
  "pyproject.toml",
  ".tool-versions",
  "mise.toml",
  "requirements.txt",
  "uv.lock",
  "poetry.lock",
  "Pipfile",
  "Pipfile.lock",
];
const present = (file: string) =>
  fs
    .lstat(file)
    .then(() => true)
    .catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    });
/** Workflow around the existing official-API/terminal integration. No second interpreter store. */
export class PythonEnvironmentService {
  private creating = false;
  constructor(
    readonly guard: HostGuard,
    private readonly port: PythonEnvironmentPort,
    private readonly runner: RemediationRunner,
    private readonly confirmOfficial: (scope: string) => Promise<boolean>,
    private readonly resolver = new ProjectToolchainResolver(),
  ) {}
  async diagnose(
    file: string,
    workspaces: readonly string[],
  ): Promise<PythonEnvironmentStatus> {
    this.guard.assert();
    const base = await this.resolver.resolve({
      file,
      workspaces,
      language: "python",
      toolchains: [],
      discoveryComplete: false,
    });
    const environments = await this.port.discover(base.root);
    this.guard.assert();
    const managers = await this.port.managers(base.root);
    const pyproject = (await metadata(base.root, "pyproject.toml")) ?? "";
    const recommended =
      (await metadata(base.root, "uv.lock")) !== undefined ||
      /\[tool\.uv(?:\]|\.)/.test(pyproject)
        ? "uv"
        : (await metadata(base.root, "poetry.lock")) !== undefined ||
            /\[tool\.poetry(?:\]|\.)/.test(pyproject)
          ? "poetry"
          : (await metadata(base.root, "Pipfile")) !== undefined
            ? "pipenv"
            : "venv";
    const requirements =
      base.toolchains.find((t) => t.language === "python")?.requirements ?? [];
    const diagnostic = diagnoseToolchain(
      "python",
      requirements,
      discoveredCandidates(environments),
      base.root,
      true,
    );
    return {
      workspace: base.workspace,
      root: base.root,
      requirements,
      environments,
      directories: await Promise.all(
        [".venv", "venv"].map(async (name) => ({
          name,
          exists: await present(path.join(base.root, name)),
        })),
      ),
      managers,
      recommended,
      state: !environments.length
        ? "missing"
        : diagnostic.state === "compatible"
          ? "available"
          : diagnostic.state === "incompatible"
            ? "incompatible"
            : "unknown",
      dependencies: "unknown",
      diagnostics: [
        ...base.diagnostics,
        ...diagnostic.diagnostics,
        message(
          "python.dependenciesUnknown",
          "解释器可用不代表项目依赖已安装，请另行诊断依赖。",
        ),
      ],
    };
  }
  async useExisting(
    status: PythonEnvironmentStatus,
    executable: string,
  ): Promise<{ toolchain: string; diagnostics: EnvironmentMessage[] }> {
    this.guard.assert();
    const environments = await this.port.discover(status.root);
    const selected = environments.find(
      (e) => path.resolve(e.executable) === path.resolve(executable),
    );
    if (!selected)
      throw new EnvironmentError(
        message(
          "python.environmentMissing",
          "所选解释器不在当前项目重新发现的环境中。",
        ),
      );
    const diagnosis = diagnoseToolchain(
      "python",
      status.requirements,
      discoveredCandidates([selected]),
      status.root,
      true,
    );
    if (diagnosis.state === "incompatible" || diagnosis.state === "conflict")
      throw new EnvironmentError(
        message("python.versionMismatch", "所选解释器与项目版本要求不兼容。"),
      );
    const mismatch = await this.port.synchronize(executable, status.root);
    this.guard.assert();
    return {
      toolchain: executable,
      diagnostics: [
        ...diagnosis.diagnostics,
        ...(mismatch
          ? [
              message(
                "python.selectionMismatch",
                "官方 Python 扩展的解释器未同步；运行配置仍须显式使用所选解释器。",
                { detail: mismatch, executable },
              ),
            ]
          : []),
      ],
    };
  }
  async prepareCreation(
    status: PythonEnvironmentStatus,
    base: LocalToolchain,
    manager: "venv" | "uv" = "venv",
    managerExecutable?: string,
    name = ".venv",
  ): Promise<RemediationPlan> {
    this.guard.assert();
    await projectScope([status.workspace], status.root);
    if (!/^[\w.-]+$/.test(name) || name === "." || name === "..")
      throw new EnvironmentError(
        message("python.invalidDirectory", "环境名称必须是项目内单个目录名。"),
      );
    const target = path.join(status.root, name);
    if (!pathWithin(status.root, target))
      throw new EnvironmentError(
        message("scope.outside", "环境目录越过项目边界。"),
      );
    const checkTarget = async () => {
      if (await present(target))
        throw new EnvironmentError(
          message(
            "python.environmentExists",
            "环境目录已存在，不会覆盖或删除，请使用现有环境。",
          ),
        );
    };
    await checkTarget();
    if (
      base.language !== "python" ||
      !path.isAbsolute(base.executable) ||
      (manager === "uv" &&
        (!managerExecutable || !path.isAbsolute(managerExecutable)))
    )
      throw new EnvironmentError(
        message(
          "python.invalidTool",
          "必须选择已发现的 Python 及工具的绝对路径。",
        ),
      );
    const diagnosis = diagnoseToolchain(
      "python",
      status.requirements,
      discoveredCandidates([base]),
      status.root,
      true,
    );
    if (status.requirements.length && diagnosis.state !== "compatible")
      throw new EnvironmentError(
        message(
          "python.versionUnverified",
          "基础解释器未确认兼容项目版本要求，无法自动创建。",
        ),
      );
    const selection = JSON.stringify([
      base.executable,
      base.version,
      manager,
      managerExecutable,
      name,
    ]);
    const hash = await fingerprint(status.root, files, selection);
    const validate = async () => {
      await projectScope([status.workspace], status.root);
      await checkTarget();
      const current = (await this.port.discover(status.root)).find(
        (e) => e.executable === base.executable,
      );
      if (!current || current.version !== base.version)
        throw new EnvironmentError(
          message("python.baseChanged", "基础解释器已变化，请重新发现环境。"),
        );
      if (hash !== (await fingerprint(status.root, files, selection)))
        throw new EnvironmentError(
          message("plan.changed", "项目声明已变化，请重新诊断并确认。"),
        );
    };
    const args =
      manager === "uv"
        ? ["venv", target, "--python", base.executable, "--no-python-downloads"]
        : ["-m", "venv", target];
    return this.runner.prepare(
      {
        workspace: status.workspace,
        root: status.root,
        title: message("python.createEnvironment", "创建项目 Python 虚拟环境"),
        manager,
        run: {
          name: "创建 Python 环境",
          steps: [
            {
              command: manager === "uv" ? managerExecutable! : base.executable,
              args,
              cwd: status.root,
              label: "创建 Python 环境",
              env: { UV_PYTHON_DOWNLOADS: "never", PIP_NO_INPUT: "1" },
              terminal: true,
            },
          ],
        },
        mayModify: [target],
        mayExecuteCode: true,
        timeoutMs: 120000,
        fingerprint: hash,
      },
      validate,
      async () => {
        await this.port.discover(status.root);
      },
    );
  }
  async createOfficial(
    status: PythonEnvironmentStatus,
  ): Promise<LocalToolchain | undefined> {
    this.guard.assert();
    if (!this.port.createOfficial)
      throw new EnvironmentError(
        message(
          "python.apiUnavailable",
          "官方环境创建 API 不可用，请使用明确指定解释器的 venv/uv 计划。",
        ),
      );
    if (this.creating)
      throw new EnvironmentError(
        message("operation.busy", "已有官方环境创建流程正在运行。"),
      );
    this.creating = true;
    try {
      const check = async () => {
        this.guard.assert();
        await projectScope([status.workspace], status.root);
        for (const name of [".venv", "venv"])
          if (await present(path.join(status.root, name)))
            throw new EnvironmentError(
              message(
                "python.environmentExists",
                "项目已有环境，不会调用创建流程覆盖它。",
              ),
            );
      };
      await check();
      if (!(await this.confirmOfficial(status.root))) return undefined;
      await check();
      // Public API has no interpreter/path/cancellation options; retain its interactive wizard.
      const environment = await this.port.createOfficial(status.root);
      this.guard.assert();
      await this.port.discover(status.root);
      if (environment) await this.useExisting(status, environment.executable);
      return environment;
    } finally {
      this.creating = false;
    }
  }
  async terminal(
    status: PythonEnvironmentStatus,
    executable: string,
    activate = true,
  ): Promise<unknown> {
    await this.useExisting(status, executable);
    this.guard.assert();
    return this.port.terminal(executable, status.root, status.root, activate);
  }
}
