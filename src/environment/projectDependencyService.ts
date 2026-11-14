import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { contained } from "../detect";
import { HostGuard } from "./host";
import { fingerprint, jsonObject, metadata, projectScope } from "./metadata";
import {
  DependencyManager,
  DependencyStatus,
  EnvironmentError,
  message,
  ProjectScope,
  ToolchainLanguage,
} from "./model";
import { ProjectToolchainResolver } from "./projectToolchainResolver";
import { RemediationRunner } from "./remediationRunner";
export interface DependencyProject extends ProjectScope {
  language: ToolchainLanguage;
  manager: DependencyManager;
  declarations: string[];
  lockfiles: string[];
  conflict?: string;
  managerVersion?: string;
}
export interface ManagerCommand {
  command: string;
  prefix?: string[];
  env?: Record<string, string>;
}
export interface DependencyAdapter {
  readonly language: ToolchainLanguage;
  detect(
    scope: ProjectScope,
    files: ReadonlyMap<string, string>,
  ): DependencyProject[];
  repair(
    project: DependencyProject,
    python?: string,
  ): { args: string[]; mayModify: string[] } | undefined;
}
export interface DependencyHost {
  tool(
    manager: DependencyManager,
    root: string,
  ): Promise<ManagerCommand | undefined>;
  query?(
    tool: ManagerCommand,
    args: string[],
    root: string,
    signal?: AbortSignal,
  ): Promise<{ code: number; stdout: string }>;
  python?: string;
}
const known = [
  "go.mod",
  "go.sum",
  "go.work",
  "Cargo.toml",
  "Cargo.lock",
  "pyproject.toml",
  "requirements.txt",
  "uv.lock",
  "poetry.lock",
  "Pipfile",
  "Pipfile.lock",
  "environment.yml",
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "packages.lock.json",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
  "gradle.lockfile",
  "vcpkg.json",
  "conanfile.py",
  "conanfile.txt",
  "conan.lock",
];
const project = (
  scope: ProjectScope,
  language: ToolchainLanguage,
  manager: DependencyManager,
  declarations: string[],
  lockfiles: string[],
): DependencyProject => ({
  ...scope,
  language,
  manager,
  declarations,
  lockfiles,
});
const present = (files: ReadonlyMap<string, string>, names: string[]) =>
  names.filter((n) => files.has(n));
class BasicAdapter implements DependencyAdapter {
  constructor(
    readonly language: ToolchainLanguage,
    private readonly detectFn: DependencyAdapter["detect"],
    private readonly repairFn: DependencyAdapter["repair"],
  ) {}
  detect(
    scope: ProjectScope,
    files: ReadonlyMap<string, string>,
  ): DependencyProject[] {
    return this.detectFn(scope, files);
  }
  repair(
    p: DependencyProject,
    python?: string,
  ): ReturnType<DependencyAdapter["repair"]> {
    return this.repairFn(p, python);
  }
}
/** Declaration roles are explicit. A checksum/lock file alone is never a project declaration. */
export const dependencyAdapters: readonly DependencyAdapter[] = [
  new BasicAdapter(
    "go",
    (s, f) => {
      const d = present(f, ["go.mod", "go.work"]);
      return d.length
        ? [project(s, "go", "go", d, present(f, ["go.sum"]))]
        : [];
    },
    () => ({
      args: ["mod", "download"],
      mayModify: ["go.sum", "Go 模块缓存（目标宿主）"],
    }),
  ),
  new BasicAdapter(
    "rust",
    (s, f) =>
      f.has("Cargo.toml")
        ? [
            project(
              s,
              "rust",
              "cargo",
              ["Cargo.toml"],
              present(f, ["Cargo.lock"]),
            ),
          ]
        : [],
    (p) =>
      p.lockfiles.includes("Cargo.lock")
        ? { args: ["fetch", "--locked"], mayModify: ["Cargo 缓存（目标宿主）"] }
        : undefined,
  ),
  new BasicAdapter(
    "python",
    (s, f) => {
      const d = present(f, [
        "pyproject.toml",
        "requirements.txt",
        "Pipfile",
        "environment.yml",
      ]);
      if (!d.length) return [];
      const choices: DependencyManager[] = [];
      if (f.has("uv.lock")) choices.push("uv");
      if (
        f.has("poetry.lock") ||
        /\[tool\.poetry(?:\]|\.)/.test(f.get("pyproject.toml") ?? "")
      )
        choices.push("poetry");
      if (f.has("Pipfile")) choices.push("pipenv");
      if (f.has("environment.yml")) choices.push("conda");
      const manager = choices[0] ?? "pip";
      const p = project(
        s,
        "python",
        manager,
        d,
        present(f, ["uv.lock", "poetry.lock", "Pipfile.lock"]),
      );
      if (choices.length > 1)
        p.conflict = "项目存在多个 Python 管理器声明，请明确选择。";
      return [p];
    },
    (p, python) => {
      if (!python) return undefined;
      if (p.manager === "uv" && p.lockfiles.includes("uv.lock"))
        return {
          args: [
            "sync",
            "--locked",
            "--no-python-downloads",
            "--python",
            python,
          ],
          mayModify: [".venv", "uv 缓存（目标宿主）"],
        };
      if (p.manager === "pip" && p.declarations.includes("requirements.txt"))
        return {
          args: [
            "-m",
            "pip",
            "install",
            "--require-virtualenv",
            "-r",
            "requirements.txt",
          ],
          mayModify: ["所选 Python 虚拟环境", "pip 缓存（目标宿主）"],
        };
      return undefined;
    },
  ),
  new BasicAdapter(
    "node",
    (s, f) => {
      if (!f.has("package.json")) return [];
      const data = jsonObject(f.get("package.json")!);
      const locks = present(f, [
        "package-lock.json",
        "npm-shrinkwrap.json",
        "pnpm-lock.yaml",
        "yarn.lock",
        "bun.lock",
        "bun.lockb",
      ]);
      const managers = [
        ...new Set(
          locks.map((n) =>
            n.startsWith("pnpm")
              ? "pnpm"
              : n.startsWith("yarn")
                ? "yarn"
                : n.startsWith("bun")
                  ? "bun"
                  : "npm",
          ),
        ),
      ] as DependencyManager[];
      const declared =
        typeof data.packageManager === "string"
          ? data.packageManager.match(/^(npm|pnpm|yarn|bun)@(\d+(?:\.\d+)*)/)
          : null;
      const manager =
        (declared?.[1] as DependencyManager) ?? managers[0] ?? "npm";
      const p = project(s, "node", manager, ["package.json"], locks);
      p.managerVersion = declared?.[2];
      if (
        managers.length > 1 ||
        (declared && managers.some((m) => m !== manager))
      )
        p.conflict = "包管理器声明与锁文件不一致，请先处理冲突。";
      const npmLock =
        f.get("npm-shrinkwrap.json") ?? f.get("package-lock.json");
      if (npmLock) {
        const lock = jsonObject(npmLock);
        const packages = lock.packages as Record<string, unknown> | undefined;
        const root = packages?.[""] as Record<string, unknown> | undefined;
        if (root) {
          for (const key of [
            "dependencies",
            "devDependencies",
            "optionalDependencies",
          ]) {
            const a = data[key] as Record<string, string> | undefined;
            const b = root[key] as Record<string, string> | undefined;
            if (
              Object.keys(a ?? {}).some((n) => a?.[n] !== b?.[n]) ||
              Object.keys(b ?? {}).some((n) => b?.[n] !== a?.[n])
            )
              p.conflict = "package.json 与 npm 锁文件的根依赖声明不一致。";
          }
        }
      }
      return [p];
    },
    (p) => {
      if (
        p.manager === "npm" &&
        p.lockfiles.some(
          (n) => n === "package-lock.json" || n === "npm-shrinkwrap.json",
        )
      )
        return {
          args: ["ci"],
          mayModify: ["node_modules", "npm 缓存（目标宿主）"],
        };
      if (p.manager === "pnpm" && p.lockfiles.includes("pnpm-lock.yaml"))
        return {
          args: ["install", "--frozen-lockfile"],
          mayModify: ["node_modules", "pnpm store（目标宿主）"],
        };
      if (
        p.manager === "yarn" &&
        p.lockfiles.includes("yarn.lock") &&
        p.managerVersion
      )
        return {
          args: [
            "install",
            Number(p.managerVersion.split(".")[0]) === 1
              ? "--frozen-lockfile"
              : "--immutable",
          ],
          mayModify: ["node_modules", ".yarn", "Yarn 缓存（目标宿主）"],
        };
      if (
        p.manager === "bun" &&
        p.lockfiles.some((n) => n.startsWith("bun.lock"))
      )
        return {
          args: ["install", "--frozen-lockfile"],
          mayModify: ["node_modules", "Bun 缓存（目标宿主）"],
        };
      return undefined;
    },
  ),
  new BasicAdapter(
    "csharp",
    (s, f) => {
      const d = [...f.keys()].filter((n) => /\.(csproj|sln|slnx)$/.test(n));
      return d.length
        ? [
            project(
              s,
              "csharp",
              "dotnet",
              d,
              present(f, ["packages.lock.json"]),
            ),
          ]
        : [];
    },
    (p) =>
      p.declarations.length === 1
        ? {
            args: [
              "restore",
              p.declarations[0],
              ...(p.lockfiles.length ? ["--locked-mode"] : []),
            ],
            mayModify: [
              "obj/project.assets.json",
              "obj/*.nuget.*",
              "NuGet 缓存（目标宿主）",
            ],
          }
        : undefined,
  ),
  new BasicAdapter(
    "java",
    (s, f) => {
      const out: DependencyProject[] = [];
      if (f.has("pom.xml"))
        out.push(project(s, "java", "maven", ["pom.xml"], []));
      const g = present(f, [
        "build.gradle",
        "build.gradle.kts",
        "settings.gradle",
        "settings.gradle.kts",
      ]);
      if (g.length)
        out.push(
          project(s, "java", "gradle", g, present(f, ["gradle.lockfile"])),
        );
      return out;
    },
    (p) =>
      p.manager === "maven"
        ? {
            args: ["dependency:go-offline"],
            mayModify: ["target", "Maven 缓存（目标宿主）"],
          }
        : {
            args: ["--no-daemon", "dependencies"],
            mayModify: [".gradle", "Gradle 缓存（目标宿主）"],
          },
  ),
  new BasicAdapter(
    "cpp",
    (s, f) => {
      const out: DependencyProject[] = [];
      if (f.has("vcpkg.json"))
        out.push(project(s, "cpp", "vcpkg", ["vcpkg.json"], []));
      const d = present(f, ["conanfile.py", "conanfile.txt"]);
      if (d.length)
        out.push(project(s, "cpp", "conan", d, present(f, ["conan.lock"])));
      return out;
    },
    () => undefined,
  ),
];
export class ProjectDependencyService {
  constructor(
    readonly guard: HostGuard,
    private readonly host: DependencyHost,
    readonly runner: RemediationRunner,
    private readonly adapters = dependencyAdapters,
  ) {}
  private listeners = new Set<(status: DependencyStatus[]) => void>();
  subscribe(listener: (status: DependencyStatus[]) => void): {
    dispose(): void;
  } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }
  async diagnose(
    file: string,
    workspaces: readonly string[],
    options: { checkInstalled?: boolean; signal?: AbortSignal } = {},
  ): Promise<DependencyStatus[]> {
    this.guard.assert();
    const scope = await new ProjectToolchainResolver().resolve({
      file,
      workspaces,
      toolchains: [],
      discoveryComplete: false,
    });
    const files = new Map<string, string>();
    for (const name of [
      ...known,
      ...(await fs.readdir(scope.root))
        .filter((n) => /\.(csproj|sln|slnx)$/.test(n))
        .slice(0, 256),
    ]) {
      if (options.signal?.aborted)
        throw new EnvironmentError(
          message("operation.cancelled", "依赖诊断已取消。"),
        );
      // bun.lockb is opaque binary: detect presence without treating it as text/installed evidence.
      if (name === "bun.lockb") {
        if (
          await fs
            .lstat(path.join(scope.root, name))
            .then((s) => s.isFile())
            .catch(() => false)
        )
          files.set(name, "");
        continue;
      }
      const text = await metadata(scope.root, name);
      if (text !== undefined) files.set(name, text);
    }
    const output: DependencyStatus[] = [];
    for (const adapter of this.adapters) {
      let projects: DependencyProject[];
      try {
        projects = adapter.detect(scope, files);
      } catch (error) {
        output.push({
          ...scope,
          language: adapter.language,
          state: "error",
          declarations: [],
          lockfiles: [],
          evidence: "metadata",
          diagnostics: [
            message("dependency.invalidMetadata", "依赖元数据无法解析。", {
              detail: String(error),
            }),
          ],
          remediation: [],
        });
        continue;
      }
      for (const p of projects) {
        this.guard.assert();
        const status: DependencyStatus = {
          ...p,
          state: p.conflict ? "conflict" : "unknown",
          evidence: "metadata",
          diagnostics: [
            message(
              p.conflict ? "dependency.conflict" : "dependency.unknown",
              p.conflict ?? "仅发现声明与锁文件，尚无可靠的依赖就绪证据。",
            ),
          ],
          remediation: [],
        };
        const tool = await this.host
          .tool(p.manager, p.root)
          .catch(() => undefined);
        if (!tool) {
          status.diagnostics.push(
            message(
              "dependency.managerMissing",
              "当前宿主缺少所需包管理器，未自动安装。",
              { manager: p.manager },
            ),
          );
        }
        if (tool && !p.conflict) {
          if (
            options.checkInstalled &&
            p.manager === "npm" &&
            this.host.query
          ) {
            try {
              const result = await this.host.query(
                tool,
                ["ls", "--all", "--json", "--ignore-scripts", "--offline"],
                p.root,
                options.signal,
              );
              this.guard.assert();
              const data = jsonObject(result.stdout);
              if (result.code === 0 && !data.problems) {
                status.state = "ready";
                status.evidence = "official-query";
                status.diagnostics = [
                  message(
                    "dependency.ready",
                    "npm 官方依赖树检查通过；未执行安装脚本。",
                  ),
                ];
              } else if (
                Array.isArray(data.problems) &&
                data.problems.every((v) => typeof v === "string") &&
                data.problems.length
              ) {
                status.state = "missing";
                status.evidence = "official-query";
                status.diagnostics = [
                  message(
                    "dependency.problems",
                    "npm 报告依赖树缺失或版本不兼容。",
                    {
                      detail: (data.problems as string[])
                        .join("\n")
                        .slice(0, 4096),
                    },
                  ),
                ];
              } else
                status.diagnostics.push(
                  message(
                    "dependency.queryUnknown",
                    "官方查询结果不足，未推断依赖已安装。",
                  ),
                );
            } catch (error) {
              if (options.signal?.aborted || !this.guard.connected) throw error;
              status.state = "error";
              status.diagnostics.push(
                message(
                  "dependency.queryFailed",
                  "官方依赖查询失败，未将其当作已安装或缺失。",
                  { detail: String(error) },
                ),
              );
            }
          }
          const repair = adapter.repair(p, this.host.python);
          if (repair) {
            const selection = JSON.stringify([tool, this.host.python]);
            const hash = await dependencyFingerprint(p.root, selection);
            const validate = async () => {
              this.guard.assert();
              await projectScope(workspaces, p.root);
              const latest = await this.host.tool(p.manager, p.root);
              if (
                JSON.stringify([latest, this.host.python]) !== selection ||
                (await dependencyFingerprint(p.root, selection)) !== hash
              )
                throw new EnvironmentError(
                  message(
                    "plan.changed",
                    "依赖声明、锁文件或工具选择已变化，请重新诊断。",
                  ),
                );
            };
            const args = [
              ...(p.manager === "pip" ? [] : (tool.prefix ?? [])),
              ...repair.args,
            ];
            const command =
              p.manager === "pip" ? this.host.python! : tool.command;
            status.remediation.push(
              this.runner.prepare(
                {
                  workspace: p.workspace,
                  root: p.root,
                  title: message("dependency.prepare", "准备项目依赖", {
                    manager: p.manager,
                  }),
                  manager: p.manager,
                  run: {
                    name: "准备项目依赖",
                    steps: [
                      {
                        command,
                        args,
                        cwd: p.root,
                        label: "准备项目依赖",
                        env: {
                          ...tool.env,
                          GOTOOLCHAIN: "local",
                          UV_PYTHON_DOWNLOADS: "never",
                        },
                        terminal: true,
                      },
                    ],
                  },
                  mayModify: repair.mayModify,
                  mayExecuteCode: true,
                  timeoutMs: 10 * 60 * 1000,
                  fingerprint: hash,
                },
                validate,
                async () => {
                  await this.diagnose(p.root, workspaces);
                },
              ),
            );
          } else
            status.diagnostics.push(
              message(
                "dependency.manualRepair",
                "此项目暂不提供可靠的保留锁文件修复命令，请使用已配置的官方工具。",
              ),
            );
        }
        output.push(status);
      }
    }
    for (const listener of this.listeners) {
      try {
        listener(output);
      } catch {
        /* Consumer failures are isolated. */
      }
    }
    return output;
  }
}

async function dependencyFingerprint(
  root: string,
  selection: string,
): Promise<string> {
  const entries = (await fs.readdir(root))
    .filter((n) => /\.(csproj|sln|slnx)$/.test(n))
    .sort();
  let binary = "missing";
  const file = path.join(root, "bun.lockb");
  if (
    await fs
      .lstat(file)
      .then(() => true)
      .catch(() => false)
  ) {
    if (
      !(await contained(root, file)) ||
      (await fs.stat(file)).size > 1024 * 1024
    )
      throw new EnvironmentError(
        message("metadata.invalid", "二进制锁文件超出安全读取范围。"),
      );
    binary = createHash("sha256")
      .update(await fs.readFile(file))
      .digest("hex");
  }
  return fingerprint(
    root,
    [...known.filter((n) => n !== "bun.lockb"), ...entries],
    selection + JSON.stringify(entries) + binary,
  );
}
