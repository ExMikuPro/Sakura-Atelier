import * as path from 'node:path';
import type { Step } from '../../model';
import { EmbeddedPlan, rejectTargetArguments } from '../plan';
import type { EnvironmentMetadata } from './cli';
import type { PlatformioEnvironment, PlatformioProject } from './project';

export const platformioOperations = ['build', 'clean', 'upload', 'monitor', 'test', 'testOnDevice', 'debug'] as const;
export type PlatformioOperation = typeof platformioOperations[number];
export const platformioIdeExtension = 'platformio.platformio-ide';

export interface PlatformioPlanInput {
  operation: PlatformioOperation;
  /** Absolute path of `pio`, or undefined when it was not found. */
  pio?: string;
  project: PlatformioProject;
  env: string;
  port?: string; baud?: number;
  extraArgs?: string[];
  metadata?: EnvironmentMetadata;
  ideExtensionInstalled?: boolean;
  remote?: boolean;
}

const titles: Record<PlatformioOperation, string> = { build: 'Build', clean: 'Clean', upload: 'Upload', monitor: 'Serial Monitor', test: 'Test (build only)', testOnDevice: 'Test on device', debug: 'Debug' };
export function operationTitle(operation: PlatformioOperation): string { return titles[operation]; }

function deviceWarning(env: string, what: string, port: string | undefined, remote: boolean | undefined): string {
  return `${what} for environment "${env}" will write firmware to the board ${port ? `on ${port}` : 'using the upload settings of this environment'}${remote ? ', which is attached to the remote machine' : ''}. The existing firmware is replaced. Continue?`;
}

/** Builds the plan for one operation. Pure: no process runs and no file is touched. */
export function buildPlatformioPlan(input: PlatformioPlanInput): EmbeddedPlan {
  const { operation, project, env: envName } = input;
  const label = `PlatformIO ${titles[operation]} · ${envName}`;
  const blockers: string[] = [];
  const environment: PlatformioEnvironment | undefined = project.environments.find(e => e.name === envName);
  if (!environment) { blockers.push(`Environment "${envName}" is not defined in platformio.ini.`); }
  if (!input.pio) { blockers.push('PlatformIO Core (pio) was not found. Locate it with "Sakura Atelier: Embedded Tools...".'); }
  const bad = rejectTargetArguments(input.extraArgs ?? []);
  if (bad) { blockers.push(`Extra argument "${bad}" selects a PlatformIO target; use the dedicated action instead.`); }
  const base = { backend: 'platformio', operation, label, blockers };
  const pio = input.pio ?? 'pio';
  const cwd = project.root;
  const step = (args: string[], stepLabel: string, terminal = true): Step => ({ command: pio, args: [...args, ...(input.extraArgs ?? [])], cwd, label: stepLabel, terminal });
  const common = ['-d', project.root, '-e', envName];

  switch (operation) {
    case 'build': return { ...base, risk: 'safe', steps: [step(['run', ...common], label)] };
    case 'clean': return { ...base, risk: 'safe', steps: [step(['run', ...common, '-t', 'clean'], label)] };
    case 'upload': return {
      ...base, risk: 'writes-device', confirm: deviceWarning(envName, 'Upload', input.port, input.remote),
      steps: [step(['run', ...common, '-t', 'upload', ...(input.port ? ['--upload-port', input.port] : [])], label)]
    };
    case 'monitor': return { ...base, risk: 'safe', steps: [step(['device', 'monitor', '-d', project.root, '-e', envName, ...(input.port ? ['--port', input.port] : []), ...(input.baud ? ['--baud', String(input.baud)] : [])], label)] };
    case 'test': {
      // On a hardware environment `pio test` uploads the test firmware. The default test action only builds there.
      const hardware = environment?.family !== 'native';
      return { ...base, risk: 'safe', steps: [step(['test', ...common, ...(hardware ? ['--without-uploading', '--without-testing'] : [])], label)] };
    }
    case 'testOnDevice': {
      if (environment?.family === 'native') { blockers.push('A native environment runs tests on this computer; use "Test".'); }
      return { ...base, risk: 'writes-device', confirm: deviceWarning(envName, 'Running tests on the device', input.port, input.remote), steps: [step(['test', ...common, ...(input.port ? ['--upload-port', input.port, '--test-port', input.port] : [])], label)] };
    }
    case 'debug': {
      if (!input.ideExtensionInstalled) { blockers.push(`Debugging uses the PlatformIO IDE extension (${platformioIdeExtension}). Install it; Sakura Atelier does not implement a debugger.`); }
      if (!input.metadata?.gdbPath) { blockers.push('The debugger path is unknown. Load the build details for this environment first; PlatformIO may download its platform.'); }
      const executable = input.metadata?.progPath || path.join(project.root, '.pio', 'build', envName, 'firmware.elf');
      return {
        ...base, risk: 'writes-device', confirm: deviceWarning(envName, 'Starting a debug session', input.port, input.remote), steps: [],
        debug: {
          extension: platformioIdeExtension,
          configuration: {
            type: 'platformio-debug', request: 'launch', name: `PlatformIO Debug (${envName})`,
            executable, projectEnvName: envName, toolchainBinDir: input.metadata?.gdbPath ? path.dirname(input.metadata.gdbPath) : '',
            internalConsoleOptions: 'openOnSessionStart', preLaunchTask: { type: 'PlatformIO', task: 'Pre-Debug' }
          }
        }
      };
    }
  }
}

/** Per-environment configuration descriptors generated from `[env:NAME]`. A template registry can wrap these without changing them. */
export interface PlatformioTemplate { id: string; name: string; backend: 'platformio'; env: string; operation: PlatformioOperation; risk: 'safe' | 'writes-device'; platform: string; board: string }
export function platformioTemplates(project: PlatformioProject): PlatformioTemplate[] {
  return project.environments.flatMap(environment => platformioOperations
    .filter(operation => operation !== 'testOnDevice' || environment.family !== 'native')
    .map(operation => ({
      id: `platformio:${environment.name}:${operation}`, name: `PlatformIO: ${titles[operation]} (${environment.name})`, backend: 'platformio' as const,
      env: environment.name, operation, risk: operation === 'upload' || operation === 'testOnDevice' || operation === 'debug' ? 'writes-device' as const : 'safe' as const,
      platform: environment.platform, board: environment.board
    })));
}

/** Which environment an action uses. Never guesses between several: the caller must ask. */
export type EnvironmentChoice = { kind: 'selected'; env: string } | { kind: 'choose'; choices: string[] } | { kind: 'none' };
export function chooseEnvironment(project: PlatformioProject, remembered?: string): EnvironmentChoice {
  const names = project.environments.map(e => e.name);
  if (!names.length) { return { kind: 'none' }; }
  if (remembered && names.includes(remembered)) { return { kind: 'selected', env: remembered }; }
  if (names.length === 1) { return { kind: 'selected', env: names[0] }; }
  if (project.defaultEnvironments.length === 1) { return { kind: 'selected', env: project.defaultEnvironments[0] }; }
  return { kind: 'choose', choices: [...project.defaultEnvironments, ...names.filter(n => !project.defaultEnvironments.includes(n))] };
}
