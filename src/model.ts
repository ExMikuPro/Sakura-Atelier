export const languages = ['go', 'python', 'rust', 'c', 'cpp', 'csharp', 'java', 'javascript', 'javascriptreact', 'typescript', 'typescriptreact'] as const;
export type Language = typeof languages[number];
export type Mode = 'auto' | 'file' | 'project';
export interface Step { command: string; args: string[]; cwd: string; label: string; env?: Record<string,string>; terminal?: boolean; problemMatchers?: string[] }
/** A plan is independent of execution, so Debug/Test can supply other executors later. */
export interface RunPlan { name: string; steps: Step[] }
/** Future Debug/Test backends can consume the same resolved plan without adding fake UI. */
export interface ExecutionBackend { run(plan: RunPlan): Promise<void>; stop(): void; dispose(): void }
export interface Project { root: string; marker: string }
export interface RunConfiguration { name: string; language: Language; command: string; args?: string[] }
export interface Settings { javaPath?: string; script: string; pythonPath: string; cCompiler: string; cppCompiler: string; configurations: RunConfiguration[] }
export class RunnerError extends Error {
  constructor(message: string, public readonly configure = false) { super(message); this.name = 'RunnerError'; }
}
export function supports(language: string): language is Language { return (languages as readonly string[]).includes(language); }

/** Automatic suggestions must not select another language's task provider. Explicit task names remain unrestricted. */
export function relevantTaskType(language: string, type: string): boolean {
  if (['process', 'shell'].includes(type)) { return true; }
  if (language === 'java') { return ['java', 'maven', 'gradle'].includes(type); }
  if (language === 'c' || language === 'cpp') { return ['cmake', 'cmake.build', 'cppbuild', 'make'].includes(type); }
  return false;
}
