import { createHash } from "node:crypto";
import { EnvironmentError, message } from "./model";
export interface HostEnvironment {
  id: string;
  kind: "local" | "wsl" | "ssh" | "container" | "remote";
  label: string;
  platform: NodeJS.Platform;
  arch: string;
  authority: string;
}
export interface HostFacts {
  remoteName?: string;
  authority?: string;
  hostname: string;
  machineId: string;
  platform: NodeJS.Platform;
  arch: string;
  extensionKind: "workspace" | "ui";
}
export function identifyHost(facts: HostFacts): HostEnvironment {
  if (facts.remoteName && facts.extensionKind !== "workspace")
    throw new EnvironmentError(
      message(
        "host.wrongExtensionHost",
        "远程项目操作必须由远程工作区扩展宿主执行，禁止回退到本机。",
      ),
    );
  const kind: HostEnvironment["kind"] = !facts.remoteName
    ? "local"
    : facts.remoteName === "wsl"
      ? "wsl"
      : facts.remoteName === "ssh-remote"
        ? "ssh"
        : facts.remoteName === "dev-container" ||
            facts.remoteName === "attached-container"
          ? "container"
          : "remote";
  const authority = facts.authority || facts.hostname;
  const id = createHash("sha256")
    .update(
      JSON.stringify([
        kind,
        authority,
        facts.hostname,
        facts.machineId,
        facts.platform,
        facts.arch,
      ]),
    )
    .digest("hex")
    .slice(0, 32);
  return {
    id,
    kind,
    label:
      {
        local: "本机",
        wsl: "WSL",
        ssh: "SSH",
        container: "Dev Container",
        remote: "远程环境",
      }[kind] +
      " · " +
      authority,
    platform: facts.platform,
    arch: facts.arch,
    authority,
  };
}
/** VS Code disposes the workspace extension host on disconnect; P0 can also explicitly invalidate a session. */
export class HostGuard {
  private active = true;
  private aborter = new AbortController();
  constructor(
    readonly environment: HostEnvironment,
    private readonly trusted: () => boolean,
  ) {}
  get signal(): AbortSignal {
    return this.aborter.signal;
  }
  get connected(): boolean {
    return this.active;
  }
  assert(expectedId = this.environment.id): void {
    if (!this.active || expectedId !== this.environment.id)
      throw new EnvironmentError(
        message(
          "host.disconnected",
          "目标扩展宿主已断开或发生变化，已禁止执行。",
        ),
      );
    if (!this.trusted())
      throw new EnvironmentError(
        message(
          "workspace.untrusted",
          "未受信任工作区中禁止执行环境检测或修复命令。",
        ),
      );
  }
  disconnect(): void {
    this.active = false;
    this.aborter.abort();
  }
  dispose(): void {
    this.disconnect();
  }
}
export function debuggerAvailability(
  host: HostEnvironment,
  type: string,
  extensions: readonly {
    id: string;
    types: readonly string[];
    extensionKind: "workspace" | "ui";
  }[],
): ReturnType<typeof message> | undefined {
  if (
    extensions.some(
      (e) =>
        e.types.includes(type) &&
        (host.kind === "local" || e.extensionKind === "workspace"),
    )
  )
    return undefined;
  return message(
    "debugger.missing",
    "当前扩展宿主未安装兼容的调试扩展，请在目标环境中安装，不会回退到本机调试。",
    { host: host.label, type },
  );
}
