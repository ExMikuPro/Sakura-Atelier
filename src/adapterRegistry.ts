import { platformioBackend } from './embedded/platformio/project';
import { stm32Backend } from './embedded/stm32/project';
import type { RuntimeLanguage } from './configuration';
import type { ProjectTemplate } from './embedded/projects/template';
import type { BackendHost, BackendProject, BuildSystemDescriptor, ProjectBackend, RunTargetDescriptor, RuntimeAdapter } from './adapterTypes';

/** Small keyed registry with duplicate protection. Read access mirrors `Map` so existing `adapters.get(...)` callers keep working. */
export class Registry<K extends string, V> {
  private readonly entries = new Map<K, V>();
  constructor(private readonly kind: string) {}
  register(key: K, value: V): { dispose(): void } {
    if (this.entries.has(key)) { throw new Error(`${this.kind} "${key}" is already registered.`); }
    this.entries.set(key, value);
    return { dispose: () => { if (this.entries.get(key) === value) { this.entries.delete(key); } } };
  }
  get(key: K): V | undefined { return this.entries.get(key); }
  has(key: K): boolean { return this.entries.has(key); }
  keys(): K[] { return [...this.entries.keys()]; }
  values(): V[] { return [...this.entries.values()]; }
  get size(): number { return this.entries.size; }
}

/** Language, build system, run target and project backend are registered independently. */
export class AdapterRegistry {
  readonly languages = new Registry<RuntimeLanguage, RuntimeAdapter>('Language adapter');
  readonly buildSystems = new Registry<string, BuildSystemDescriptor>('Build system');
  readonly runTargets = new Registry<string, RunTargetDescriptor>('Run target');
  readonly backends = new Registry<string, ProjectBackend>('Project backend');
  /** Templates for creating new embedded projects. */
  readonly projectTemplates = new Registry<string, ProjectTemplate>('Project template');

  /** Runs every backend's metadata-only detection for one directory. A failing backend never hides the others. */
  async detectBackendProjects(root: string, host: BackendHost): Promise<BackendProject[]> {
    const found: BackendProject[] = [];
    for (const backend of this.backends.values()) {
      try { const project = await backend.detect(root, host); if (project) { found.push(project); } }
      catch { /* Detection is best effort; one unreadable marker must not break the inventory. */ }
    }
    return found;
  }
}

/** Build systems and run targets that the existing language adapters already use. Descriptive only; behaviour is unchanged. */
export function registerBuiltinDescriptors(registry: AdapterRegistry): void {
  registry.backends.register('platformio',platformioBackend);
  registry.backends.register('stm32',stm32Backend);
  const buildSystems: BuildSystemDescriptor[] = [
    {id:'platformio',label:'PlatformIO',markers:['platformio.ini']},
    { id: 'direct', label: 'Direct compiler / interpreter', markers: [] },
    { id: 'cmake', label: 'CMake', markers: ['CMakeLists.txt'] },
    { id: 'make', label: 'Make', markers: ['Makefile'] },
    { id: 'cargo', label: 'Cargo', markers: ['Cargo.toml'] },
    { id: 'go', label: 'Go modules', markers: ['go.mod', 'go.work'] },
    { id: 'npm', label: 'npm / pnpm / yarn', markers: ['package.json'] },
    { id: 'dotnet', label: '.NET', markers: ['*.csproj', '*.sln', '*.slnx'] },
    { id: 'maven', label: 'Maven', markers: ['pom.xml'] },
    { id: 'gradle', label: 'Gradle', markers: ['build.gradle', 'build.gradle.kts'] }
  ];
  for (const system of buildSystems) { registry.buildSystems.register(system.id, system); }
  registry.runTargets.register('host', { id: 'host', label: 'This computer', kind: 'host' });
}
