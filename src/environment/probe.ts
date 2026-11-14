import { execFile } from "node:child_process";
import { HostGuard } from "./host";
import { EnvironmentError, message } from "./model";
export interface ProbeOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}
/** Bounded, cancellable argument-array probes. Never a shell, never a package installation. */
export class ToolProbe {
  private active = 0;
  private waiters: (() => void)[] = [];
  constructor(
    private readonly guard: HostGuard,
    readonly concurrency = 3,
  ) {
    if (concurrency < 1 || concurrency > 16)
      throw new Error("检测并发数必须在 1–16 之间。");
  }
  async run(
    command: string,
    args: string[],
    cwd: string,
    options: ProbeOptions = {},
  ): Promise<string> {
    const result = await this.result(command, args, cwd, options);
    if (result.code !== 0)
      throw new EnvironmentError(
        message("probe.exit", "工具检测返回失败状态。", {
          tool: command,
          code: result.code,
        }),
      );
    return result.stdout || result.stderr;
  }
  async result(
    command: string,
    args: string[],
    cwd: string,
    options: ProbeOptions = {},
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    this.guard.assert();
    if (options.signal?.aborted)
      throw new EnvironmentError(
        message("operation.cancelled", "操作已取消。"),
      );
    while (this.active >= this.concurrency) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
      this.guard.assert();
      if (options.signal?.aborted)
        throw new EnvironmentError(
          message("operation.cancelled", "操作已取消。"),
        );
    }
    this.active++;
    try {
      return await new Promise<{
        code: number;
        stdout: string;
        stderr: string;
      }>((resolve, reject) => {
        const environment = {
          ...process.env,
          ...options.env,
          GOTOOLCHAIN: "local",
          RUSTUP_NO_UPDATE_CHECK: "1",
          PYTHONNOUSERSITE: "1",
          DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1",
          DOTNET_CLI_TELEMETRY_OPTOUT: "1",
          DOTNET_NOLOGO: "1",
        };
        for (const key of [
          "NODE_OPTIONS",
          "PYTHONPATH",
          "PYTHONSTARTUP",
          "BASH_ENV",
          "ENV",
        ])
          delete environment[key as keyof typeof environment];
        let finished = false;
        let forceTimer: ReturnType<typeof setTimeout> | undefined;
        let interrupted = false;
        const finish = (
          error: Error | null,
          stdout: string,
          stderr: string,
        ) => {
          if (finished) return;
          finished = true;
          clearTimeout(forceTimer);
          clearTimeout(deadline);
          options.signal?.removeEventListener("abort", cancel);
          this.guard.signal.removeEventListener("abort", cancel);
          if (
            interrupted ||
            (error && typeof (error as NodeJS.ErrnoException).code !== "number")
          )
            reject(
              new EnvironmentError(
                message("probe.failed", "工具链检测失败、超时或已取消。", {
                  tool: command,
                  detail: error?.message ?? "操作已取消或超时",
                }),
              ),
            );
          else
            resolve({
              code: error ? (error as Error & { code: number }).code : 0,
              stdout,
              stderr,
            });
        };
        const child = execFile(
          command,
          args,
          {
            cwd,
            env: environment,
            timeout: Math.max(1, Math.min(options.timeoutMs ?? 5000, 30000)),
            maxBuffer: 1024 * 1024,
            windowsHide: true,
            killSignal: "SIGTERM",
          },
          finish,
        );
        const cancel = () => {
          if (finished || interrupted) return;
          interrupted = true;
          child.kill("SIGTERM");
          forceTimer = setTimeout(() => child.kill("SIGKILL"), 250);
        };
        const deadline = setTimeout(
          cancel,
          Math.max(1, Math.min(options.timeoutMs ?? 5000, 30000)),
        );
        options.signal?.addEventListener("abort", cancel, { once: true });
        this.guard.signal.addEventListener("abort", cancel, { once: true });
        if (options.signal?.aborted || this.guard.signal.aborted) cancel();
      });
    } finally {
      this.active--;
      for (const resume of this.waiters.splice(0)) resume();
    }
  }
}
