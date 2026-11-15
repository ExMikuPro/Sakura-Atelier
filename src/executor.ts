import { hostToolchains } from './environment/registryAccess';
import { t } from './i18n';
import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { ExecutionBackend, RunPlan, RunnerError, Step } from './model';
import { resolveTool, processEnvironment } from './tools';
import { CapturedExecutor } from './capturedExecutor';
/** Tasks own their process trees and interactive terminals; no detached child processes. */
export class TaskExecutor implements vscode.Disposable, ExecutionBackend {
  private readonly host=hostToolchains()?.guard;
  private readonly stopForHost=()=>this.stop();
  constructor(private readonly source = 'Sakura Atelier') {this.host?.signal.addEventListener('abort',this.stopForHost,{once:true});}
  private captured?: CapturedExecutor;
  private active = new Set<vscode.TaskExecution>();
  private pending = new Set<() => void>();
  private stopped = false;
  private disposed = false;
  private locked = false;
  get cancelled(): boolean { return this.stopped || this.disposed; }
  get busy(): boolean { return this.locked; }
  async exclusive(work: () => Promise<void>): Promise<boolean> {
    if (this.locked || this.disposed) { return false; }
    this.locked = true;
    this.stopped = false;
    try { await work(); return true; } finally { this.locked = false; }
  }
  async run(plan: RunPlan, folder?: vscode.WorkspaceFolder): Promise<void> {
    this.host?.assert();
    for (const step of plan.steps) {
      this.host?.assert();
      if (this.stopped || this.disposed) { throw new RunnerError('Run stopped.'); }
      const command = await resolveTool(step.command, step.cwd,processEnvironment(step.env));
      if (step.terminal === false) { this.captured ??= new CapturedExecutor(); await this.captured.run({ ...step, command }); }
      else { await this.runStep({ ...step, command }, folder); }
    }
  }
  private runStep(step: Step, folder?: vscode.WorkspaceFolder): Promise<void> {
    const id = randomUUID();
    const task = new vscode.Task({ type: 'sakuraRunner', sakuraId: id }, folder ?? vscode.TaskScope.Global, t(step.label), this.source, new vscode.ProcessExecution(step.command, step.args, { cwd: step.cwd, env: step.env }), step.problemMatchers ?? []);
    task.presentationOptions = { echo: this.source.includes('SDK Manager'), reveal: step.terminal === false ? vscode.TaskRevealKind.Never : vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Shared, focus: step.terminal !== false, clear: true, showReuseMessage: false };
    return this.execute(task, execution => execution.task.definition.sakuraId === id);
  }
  async runExisting(task: vscode.Task): Promise<void> {
    this.host?.assert();
    if (task.isBackground) { throw new RunnerError('Background tasks are not supported as run targets. Use a foreground run task.', true); }
    if (vscode.tasks.taskExecutions.some(x => x.task.name === task.name && x.task.scope === task.scope)) { throw new RunnerError(`Task "${task.name}" is already running.`); }
    await this.execute(task, execution => this.active.has(execution));
  }
  private execute(task: vscode.Task, matches: (execution: vscode.TaskExecution) => boolean): Promise<void> {
    if (this.stopped || this.disposed) { return Promise.reject(new RunnerError('Run stopped.')); }
    return new Promise((resolve, reject) => {
      let settled = false;
      let execution: vscode.TaskExecution | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: Error) => {
        if (settled) { return; }
        settled = true;
        if (timer) { clearTimeout(timer); }
        endProcess.dispose(); endTask.dispose(); this.pending.delete(cancel);
        if (execution) { this.active.delete(execution); }
        if (error) { reject(error); } else { resolve(); }
      };
      const cancel = () => finish(new RunnerError('Run stopped.'));
      this.pending.add(cancel);
      const endProcess = vscode.tasks.onDidEndTaskProcess(event => {
        if (matches(event.execution)) {
          finish(event.exitCode === 0 ? undefined : new RunnerError(event.exitCode === undefined ? 'Task terminated without an exit code.' : `Task "${task.name}" failed (exit ${event.exitCode}). See its terminal output.`));
        }
      });
      const endTask = vscode.tasks.onDidEndTask(event => {
        if (matches(event.execution)) {
          // Task-only/custom executions may have no process event. Never treat that as compile success.
          timer = setTimeout(() => finish(new RunnerError(`Task "${task.name}" ended without a successful process result.`)), 50);
        }
      });
      void vscode.tasks.executeTask(task).then(value => {
        execution = value;
        if (!settled) { this.active.add(value); }
        if (this.stopped || this.disposed) { value.terminate(); cancel(); }
      }, error => finish(new RunnerError(`Could not start task: ${String(error)}`)));
    });
  }
  stop(): void {
    this.stopped = true;
    this.captured?.stop();
    for (const execution of this.active) { execution.terminate(); }
    for (const cancel of [...this.pending]) { cancel(); }
    this.active.clear();
  }
  async shutdown(): Promise<void> { this.dispose(); await this.captured?.shutdown(); }
  dispose(): void { this.host?.signal.removeEventListener('abort',this.stopForHost);this.disposed = true; this.stop(); }
}
