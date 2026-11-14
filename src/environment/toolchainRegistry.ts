import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { LocalToolchain, RuntimeLanguage } from "../configuration";
import { HostEnvironment, HostGuard } from "./host";
import { EnvironmentError, message } from "./model";
export interface RegisteredToolchain extends LocalToolchain {
  hostId: string;
  available: boolean;
  lastVerifiedAt: string;
  source: string;
  manual: boolean;
  aliases: { id: string; workspace: string }[];
  canonicalPath: string;
  compilerVersion?: string;
  sdkVersion?: string;
}
export interface RegistrySnapshot {
  host: HostEnvironment;
  state: "loading" | "cached" | "scanning" | "idle" | "blocked" | "error";
  lastScanAt?: string;
  tools: RegisteredToolchain[];
  message: string;
}
interface RegistryFile {
  version: 1;
  host: HostEnvironment;
  lastScanAt?: string;
  tools: RegisteredToolchain[];
}
export type RegistryScanner = (
  signal: AbortSignal,
) => Promise<LocalToolchain[]>;
const validTool = (t: unknown): t is LocalToolchain =>
  !!t &&
  typeof t === "object" &&
  typeof (t as LocalToolchain).id === "string" &&
  typeof (t as LocalToolchain).name === "string" &&
  typeof (t as LocalToolchain).version === "string" &&
  typeof (t as LocalToolchain).manager === "string" &&
  typeof (t as LocalToolchain).executable === "string" &&
  path.isAbsolute((t as LocalToolchain).executable) &&
  [
    "go",
    "rust",
    "python",
    "node",
    "javascript",
    "javascriptreact",
    "typescript",
    "typescriptreact",
    "c",
    "cpp",
    "csharp",
    "java",
  ].includes((t as LocalToolchain).language);
export class ToolchainRegistry {
  readonly file: string;
  private data: RegistryFile;
  private state: RegistrySnapshot["state"] = "loading";
  private listeners = new Set<(value: RegistrySnapshot) => void>();
  private running?: Promise<void>;
  private initialization?: Promise<void>;
  private writing: Promise<void> = Promise.resolve();
  private disposed = false;
  constructor(
    directory: string,
    readonly guard: HostGuard,
    private readonly scanner: RegistryScanner,
    private readonly ttlMs = 6 * 60 * 60 * 1000,
  ) {
    this.file = path.join(directory, "toolchains.json");
    this.data = { version: 1, host: guard.environment, tools: [] };
  }
  snapshot(): RegistrySnapshot {
    return {
      host: this.guard.environment,
      state: this.state,
      lastScanAt: this.data.lastScanAt,
      tools: this.data.tools.map((t) => ({
        ...t,
        aliases: t.aliases.map((a) => ({ ...a })),
      })),
      message: {
        loading: "正在读取本机工具链缓存。",
        cached: "已读取缓存，正在后台验证。",
        scanning: "正在自动发现当前宿主工具链。",
        idle: "工具链发现已完成。",
        blocked: "当前工作区未受信任，仅显示缓存。",
        error: "工具链扫描未完成，保留已有记录。",
      }[this.state],
    };
  }
  subscribe(listener: (value: RegistrySnapshot) => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }
  private emit(): void {
    const value = this.snapshot();
    for (const listener of this.listeners) {
      try {
        listener(value);
      } catch {
        /* One UI consumer must not break background discovery. */
      }
    }
  }
  async load(legacy: readonly LocalToolchain[] = []): Promise<void> {
    try {
      const stat = await fs.stat(this.file);
      if (stat.size > 4 * 1024 * 1024) throw new Error("注册表过大。");
      const input = JSON.parse(
        await fs.readFile(this.file, "utf8"),
      ) as RegistryFile;
      if (
        input.version !== 1 ||
        input.host.id !== this.guard.environment.id ||
        !Array.isArray(input.tools)
      )
        throw new Error("缓存环境不匹配。");
      this.data = {
        ...input,
        tools: input.tools
          .filter(
            (t) =>
              validTool(t) &&
              t.hostId === this.guard.environment.id &&
              Array.isArray(t.aliases) &&
              t.aliases.every(
                (a) =>
                  a &&
                  typeof a.id === "string" &&
                  typeof a.workspace === "string",
              ),
          )
          .map((t) => ({
            ...t,
            available: t.available && this.guard.environment.kind === "local",
          })),
      };
      this.state = "cached";
    } catch (error) {
      this.state = "cached";
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        await fs
          .copyFile(this.file, this.file + ".preserved-" + randomUUID())
          .catch(() => {});
      } /* Preserve mismatched/corrupt data, never expose another host's paths. */
    }
    for (const tool of legacy) {
      if (
        validTool(tool) &&
        (this.guard.environment.kind === "local" ||
          (await fs
            .stat(tool.executable)
            .then((s) => s.isFile())
            .catch(() => false)))
      )
        await this.merge(tool, true, false);
    }
    await this.persist();
    this.emit();
  }
  async start(legacy: readonly LocalToolchain[] = []): Promise<void> {
    if (this.initialization) return this.initialization;
    this.initialization = this.load(legacy).then(() => {
      const age = Date.now() - Date.parse(this.data.lastScanAt ?? "");
      if (
        !this.data.lastScanAt ||
        !Number.isFinite(age) ||
        age > this.ttlMs ||
        this.guard.environment.kind !== "local"
      ) {
        void this.refresh().catch(() => {});
      }
    });
    return this.initialization;
  }
  asLocalToolchains(workspace: string): LocalToolchain[] {
    return this.data.tools.flatMap((tool) => [
      { ...tool, project: "" },
      ...tool.aliases
        .filter((alias) => !alias.workspace || alias.workspace === workspace)
        .map((alias) => ({ ...tool, id: alias.id, project: alias.workspace })),
    ]);
  }
  async add(tool: LocalToolchain, manual = true): Promise<void> {
    this.guard.assert();
    if (!validTool(tool))
      throw new EnvironmentError(
        message(
          "registry.invalid",
          "工具链记录无效，必须指定绝对可执行文件路径。",
        ),
      );
    await this.merge(tool, manual, false);
    await this.persist();
    this.emit();
  }
  private async merge(
    tool: LocalToolchain,
    manual: boolean,
    verified: boolean,
  ): Promise<void> {
    let canonicalPath = await fs
      .realpath(tool.executable)
      .catch(() => path.resolve(tool.executable));
    if (process.platform === "win32")
      canonicalPath = canonicalPath.toLowerCase();
    // Preserve Python venv identity and rustup channel dispatch; those paths are semantically meaningful.
    const identity =
      tool.language === "python" || tool.rustToolchain
        ? path.resolve(tool.executable)
        : canonicalPath;
    const id =
      "host-" +
      createHash("sha256")
        .update(
          [
            this.guard.environment.id,
            tool.language,
            identity,
            tool.rustToolchain ?? "",
            (tool as RegisteredToolchain).sdkVersion ?? "",
          ].join("\0"),
        )
        .digest("hex")
        .slice(0, 24);
    const existing = this.data.tools.find((t) => t.id === id);
    const aliases = [...(existing?.aliases ?? [])];
    if (
      tool.id !== id &&
      !aliases.some((a) => a.id === tool.id && a.workspace === tool.project)
    )
      aliases.push({ id: tool.id, workspace: tool.project || "" });
    const value: RegisteredToolchain = {
      ...existing,
      ...tool,
      id,
      project: "",
      hostId: this.guard.environment.id,
      available: verified || existing?.available || false,
      lastVerifiedAt: verified
        ? new Date().toISOString()
        : (existing?.lastVerifiedAt ?? ""),
      source: tool.manager || "手动配置",
      manual: manual || existing?.manual || false,
      aliases,
      canonicalPath,
    };
    if (existing) Object.assign(existing, value);
    else this.data.tools.push(value);
  }
  async refresh(): Promise<void> {
    if (this.initialization) await this.initialization;
    if (this.running) return this.running;
    if (this.disposed) return;
    this.running = (async () => {
      try {
        this.guard.assert();
        this.state = "scanning";
        this.emit();
        const found = await this.scanner(this.guard.signal);
        this.guard.assert();
        const old = this.data.tools;
        this.data.tools = old.map((t) => ({ ...t, available: false }));
        for (const tool of found)
          if (validTool(tool)) await this.merge(tool, false, true);
        this.data.lastScanAt = new Date().toISOString();
        this.state = "idle";
        await this.persist();
      } catch (error) {
        this.state =
          error instanceof EnvironmentError &&
          error.diagnostic.code === "workspace.untrusted"
            ? "blocked"
            : "error"; /* Preserve entries, including all manual records. */
      } finally {
        this.emit();
      }
    })().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
  private persist(): Promise<void> {
    const text = JSON.stringify(this.data, null, 2) + "\n";
    const work = this.writing
      .catch(() => {})
      .then(async () => {
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        const temporary = this.file + "." + randomUUID() + ".tmp";
        try {
          await fs.writeFile(temporary, text, { flag: "wx", mode: 0o600 });
          await fs.rename(temporary, this.file);
        } finally {
          await fs.rm(temporary, { force: true });
        }
      });
    this.writing = work;
    return work;
  }
  async settled(): Promise<void> {
    await this.initialization;
    await this.running;
    await this.writing;
  }
  dispose(): void {
    this.disposed = true;
    this.guard.disconnect();
    this.listeners.clear();
  }
}
export type RegistryLanguage = RuntimeLanguage;
