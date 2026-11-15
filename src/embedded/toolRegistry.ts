import type { DiscoveryHost } from './discoveryHost';
import { discoverEmbeddedTools, embeddedToolIds, normalizeManualPath, EmbeddedToolId, ManualPaths, ToolStatus } from './toolchainDiscovery';

/** The subset of `vscode.Memento` the registry needs, so it works with `globalState` and with tests. */
export interface KeyValueStore { get<T>(key: string, fallback: T): T; update(key: string, value: unknown): PromiseLike<void> }

export const embeddedToolsKey = 'atelier.embeddedTools';

/** Machine-wide registry of embedded tool locations. Holds only paths the user chose; discovery results are never persisted. */
export class EmbeddedToolRegistry {
  constructor(private readonly store: KeyValueStore, private readonly host: DiscoveryHost) {}

  manual(): ManualPaths {
    const raw = this.store.get<Record<string, unknown>>(embeddedToolsKey, {});
    const result: ManualPaths = {};
    for (const id of embeddedToolIds) { const value = raw?.[id]; if (typeof value === 'string' && value && !/[\0\r\n]/.test(value)) { result[id] = value; } }
    return result;
  }

  /** Validates what the user picked and stores the resolved executable (or CubeCLT folder). Throws a readable error when it does not fit the tool. */
  async locate(id: EmbeddedToolId, picked: string): Promise<string> {
    const resolved = await normalizeManualPath(id, picked, this.host);
    if (!resolved) { throw new Error(`The selected location does not contain ${id === 'stm32cubeclt' ? 'a recognizable STM32CubeCLT layout' : 'the expected executable'} for this tool. Nothing was saved.`); }
    await this.store.update(embeddedToolsKey, { ...this.manual(), [id]: resolved });
    return resolved;
  }

  async forget(id: EmbeddedToolId): Promise<void> {
    const next = { ...this.manual() }; delete next[id];
    await this.store.update(embeddedToolsKey, next);
  }

  async discover(): Promise<Record<EmbeddedToolId, ToolStatus>> {
    const result = await discoverEmbeddedTools(this.host, this.manual());
    await this.store.update('atelier.embeddedTools.discovered', result);
    return result;
  }

  async resolve(id: EmbeddedToolId): Promise<string | undefined> { return (await this.discover())[id].selected?.path; }
}
