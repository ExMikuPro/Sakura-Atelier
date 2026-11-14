import type { Step } from '../model';

/** `safe` plans only read or build. `writes-device` plans write firmware to a target and always need an explicit confirmation. */
export type PlanRisk = 'safe' | 'writes-device';

export interface DebugLaunch {
  /** The VS Code debug configuration handed to an existing debug extension. No debug protocol is implemented here. */
  configuration: Record<string, unknown>;
  /** Extension that provides the debug type. */
  extension: string;
}

export interface EmbeddedPlan {
  backend: string; operation: string; label: string;
  steps: Step[]; debug?: DebugLaunch;
  risk: PlanRisk;
  /** Text for the modal confirmation shown before a `writes-device` plan runs. */
  confirm?: string;
  /** Reasons the plan cannot run yet. An empty list means it can. */
  blockers: string[];
}

/** Arguments that would change what an operation does to the device. Callers cannot smuggle a different target through extra args. */
export function rejectTargetArguments(args: readonly string[]): string | undefined {
  return args.find(arg => /^(-t|--target)(=|$)/.test(arg) || /^-t./.test(arg));
}
