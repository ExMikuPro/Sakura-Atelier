import type { RunPlan } from "../model";
import type { LocalToolchain } from "../configuration";

export type ToolchainLanguage =
  | "python"
  | "go"
  | "rust"
  | "node"
  | "c"
  | "cpp"
  | "csharp"
  | "java"
  | "cmake";
export type DiagnosticState =
  | "compatible"
  | "incompatible"
  | "missing"
  | "unknown"
  | "conflict";
/** UI translates stable codes + parameters; Chinese fallback never embeds a command. */
export interface EnvironmentMessage {
  code: string;
  message: string;
  parameters?: Record<string, string | number>;
}
export interface ToolchainRequirement {
  language: ToolchainLanguage;
  source: string;
  field: string;
  expression: string;
  kind: "version" | "channel" | "executable" | "standard" | "toolchain-file";
  syntax: "range" | "prefix" | "exact" | "dotnet" | "literal";
  role: "required" | "preferred";
  profile?: string;
  options?: Record<string, string | boolean>;
}
export interface ToolchainCandidate {
  id: string;
  language: ToolchainLanguage;
  executable: string;
  version?: string;
  versionKind?: "runtime" | "compiler" | "sdk" | "package-manager";
  channel?: string;
  manager?: string;
  state: DiagnosticState;
  diagnostics: EnvironmentMessage[];
}
export interface ToolchainDiagnostic {
  language: ToolchainLanguage;
  state: DiagnosticState;
  requirements: ToolchainRequirement[];
  candidates: ToolchainCandidate[];
  diagnostics: EnvironmentMessage[];
}
export interface ProjectScope {
  workspace: string;
  root: string;
}
export interface EnvironmentStatus extends ProjectScope {
  toolchains: ToolchainDiagnostic[];
  dependencies?: DependencyStatus[];
  diagnostics: EnvironmentMessage[];
}
export type DependencyManager =
  | "go"
  | "cargo"
  | "uv"
  | "pip"
  | "poetry"
  | "pipenv"
  | "conda"
  | "npm"
  | "pnpm"
  | "yarn"
  | "bun"
  | "dotnet"
  | "maven"
  | "gradle"
  | "vcpkg"
  | "conan";
export interface DependencyStatus extends ProjectScope {
  language: ToolchainLanguage;
  manager?: DependencyManager;
  state: "ready" | "missing" | "unknown" | "conflict" | "error";
  declarations: string[];
  lockfiles: string[];
  evidence: "metadata" | "official-query";
  diagnostics: EnvironmentMessage[];
  remediation: RemediationPlan[];
}
export interface RemediationPlan extends ProjectScope {
  id: string;
  hostId: string;
  title: EnvironmentMessage;
  manager: DependencyManager | "venv" | "official-python";
  run: RunPlan;
  mayModify: string[];
  mayExecuteCode: boolean;
  timeoutMs: number;
  /** Hash of declarations/locks and relevant environment selection; refreshed before confirmation and execution. */
  fingerprint: string;
  requiresTrust: true;
  requiresConfirmation: true;
}
export interface DiscoveredToolchain extends Omit<LocalToolchain, "language"> {
  language: LocalToolchain["language"] | "cmake";
  compilerVersion?: string;
  sdkVersions?: string[];
  sdkVersion?: string;
}
export interface Cancellation {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(listener: () => void): { dispose(): void };
}
export const message = (
  code: string,
  text: string,
  parameters?: EnvironmentMessage["parameters"],
): EnvironmentMessage => ({
  code,
  message: text,
  ...(parameters ? { parameters } : {}),
});
export class EnvironmentError extends Error {
  constructor(readonly diagnostic: EnvironmentMessage) {
    super(diagnostic.message);
    this.name = "EnvironmentError";
  }
}
