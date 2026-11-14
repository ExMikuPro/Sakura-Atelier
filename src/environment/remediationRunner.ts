import { randomUUID } from "node:crypto";
import type { RunPlan } from "../model";
import { HostGuard } from "./host";
import { EnvironmentError, message, RemediationPlan } from "./model";

export interface RemediationExecutor {
  exclusive(work: () => Promise<void>): Promise<boolean>;
  run(plan: RunPlan): Promise<void>;
  stop(): void;
}
export interface RemediationResult {
  state: "completed" | "cancelled" | "timed-out";
  diagnostics: ReturnType<typeof message>[];
}
/** Plans are minted by services, not accepted as executable payloads from webviews. */
export class RemediationRunner {
  private plans = new Map<
    string,
    {
      plan: RemediationPlan;
      validate: () => Promise<void>;
      after: () => Promise<void>;
    }
  >();
  private busy = false;
  constructor(
    readonly guard: HostGuard,
    private readonly executor: RemediationExecutor,
    private readonly confirm: (plan: RemediationPlan) => Promise<boolean>,
  ) {}
  prepare(
    input: Omit<
      RemediationPlan,
      "id" | "hostId" | "requiresTrust" | "requiresConfirmation"
    >,
    validate: () => Promise<void>,
    after: () => Promise<void> = async () => {},
  ): RemediationPlan {
    const plan: RemediationPlan = {
      ...input,
      id: randomUUID(),
      hostId: this.guard.environment.id,
      requiresTrust: true,
      requiresConfirmation: true,
    };
    this.plans.set(plan.id, {
      plan: JSON.parse(JSON.stringify(plan)) as RemediationPlan,
      validate,
      after,
    });
    // Bound stale UI plans, without evicting an active operation (it already holds its entry).
    if (this.plans.size > 128)
      this.plans.delete(this.plans.keys().next().value!);
    return plan;
  }
  async execute(id: string, signal?: AbortSignal): Promise<RemediationResult> {
    this.guard.assert();
    if (this.busy)
      throw new EnvironmentError(
        message("operation.busy", "已有环境操作正在执行，请等待完成。"),
      );
    const entry = this.plans.get(id);
    if (!entry)
      throw new EnvironmentError(
        message("plan.expired", "操作计划已过期，请重新诊断。"),
      );
    this.guard.assert(entry.plan.hostId);
    this.busy = true;
    try {
      const check = () => {
        this.guard.assert(entry.plan.hostId);
        if (signal?.aborted)
          throw new EnvironmentError(
            message("operation.cancelled", "操作已取消。"),
          );
      };
      check();
      await entry.validate();
      check();
      if (
        !(await this.confirm(
          JSON.parse(JSON.stringify(entry.plan)) as RemediationPlan,
        ))
      )
        return {
          state: "cancelled",
          diagnostics: [
            message("operation.cancelled", "用户取消了操作，未执行命令。"),
          ],
        };
      check();
      await entry.validate();
      check();
      this.plans.delete(id);
      let state: RemediationResult["state"] = "completed";
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stop = () => {
        state = "cancelled";
        this.executor.stop();
      };
      const started = await this.executor.exclusive(async () => {
        signal?.addEventListener("abort", stop, { once: true });
        this.guard.signal.addEventListener("abort", stop, { once: true });
        timer = setTimeout(
          () => {
            state = "timed-out";
            this.executor.stop();
          },
          Math.max(1, Math.min(entry.plan.timeoutMs, 30 * 60 * 1000)),
        );
        try {
          check();
          await this.executor.run(entry.plan.run);
        } catch (error) {
          if (state === "completed") throw error;
        } finally {
          clearTimeout(timer);
          signal?.removeEventListener("abort", stop);
          this.guard.signal.removeEventListener("abort", stop);
        }
      });
      if (!started)
        throw new EnvironmentError(
          message("operation.busy", "执行器正在处理其他操作。"),
        );
      await entry.after();
      return {
        state,
        diagnostics: [
          message(
            "operation." + state,
            state === "completed"
              ? "操作已完成，已重新扫描环境。"
              : state === "timed-out"
                ? "操作超时，已请求停止。"
                : "操作已取消，已请求停止。",
          ),
        ],
      };
    } finally {
      this.busy = false;
    }
  }
}
