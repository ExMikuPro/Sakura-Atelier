import type * as vscode from 'vscode';
import type { AtelierConfiguration as Configuration, RuntimeLanguage, LocalToolchain, PreparedRun } from './configuration';
import type { Step } from './model';
import type { ToolchainDiscovery } from './toolchains';
import type { ProjectRecord } from './projects';

export interface AdapterContext { folder: vscode.WorkspaceFolder; root: string; file: string; cache: string; environment: Record<string,string>; toolchain: string }
export interface DebugPlan { configuration: vscode.DebugConfiguration; build: Step[]; artifactFile?: string }

/** Per-language behaviour used by the managed Run / Debug flow. */
export interface RuntimeAdapter {
  readonly language: RuntimeLanguage; readonly runtime: string;
  detectProjects(projects: ProjectRecord[]): ProjectRecord[];
  discoverToolchains(discovery: ToolchainDiscovery, folder: vscode.WorkspaceFolder): Promise<LocalToolchain[]>;
  detectRunTargets(context: AdapterContext): Promise<Configuration[]>;
  proposeConfigurations(context: AdapterContext): Promise<Configuration[]>;
  validateConfiguration(configuration: Configuration): void;
  buildRunPlan(configuration: Configuration, context: AdapterContext): Promise<PreparedRun>;
  buildDebugPlan(configuration: Configuration, context: AdapterContext, adapterType: string): Promise<DebugPlan>;
  resolveTerminalEnvironment(configuration: Configuration, context: AdapterContext): Record<string,string>;
}

/** How a project is built, independent of the language of its sources. */
export interface BuildSystemDescriptor { readonly id: string; readonly label: string; readonly markers: readonly string[] }

/** Where a built program runs. `device` targets need an explicit device and firmware before anything is written to them. */
export interface RunTargetDescriptor { readonly id: string; readonly label: string; readonly kind: 'host' | 'device' | 'simulator' }

/** A project found by a backend. */
export interface BackendProject {
  backend: string; root: string; marker: string;
  buildSystem: string; languages: RuntimeLanguage[]; runTargets: string[];
  details: Record<string, string>;
}

/** Environment a backend may inspect. Injected so detection can be tested without a real workspace. */
export interface BackendHost {
  readDir(directory: string): Promise<string[]>;
  readText(file: string): Promise<string | undefined>;
}

/** A project backend combines a language, a build system and run targets (for example PlatformIO or STM32). */
export interface ProjectBackend {
  readonly id: string; readonly label: string;
  /** Returns undefined when the directory is not a project of this backend. Must not run any tool. */
  detect(root: string, host: BackendHost): Promise<BackendProject | undefined>;
}
