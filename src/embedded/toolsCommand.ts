import * as vscode from 'vscode';
import { nodeHost } from './discoveryHost';
import { EmbeddedToolRegistry } from './toolRegistry';
import { embeddedToolIds, EmbeddedToolId, ToolStatus } from './toolchainDiscovery';

const sourceText: Record<string, string> = { manual: 'set by you', env: 'environment', path: 'PATH', cubeclt: 'bundled in STM32CubeCLT', sibling: 'next to the Arm compiler', hint: 'found in a common location' };

export function createToolRegistry(context: vscode.ExtensionContext): EmbeddedToolRegistry { return new EmbeddedToolRegistry(context.globalState, nodeHost()); }

function describe(status: ToolStatus): vscode.QuickPickItem {
  const found = status.selected;
  return {
    label: `${found ? '$(check)' : '$(warning)'} ${status.label}`,
    description: found ? `${found.version ?? ''} · ${sourceText[found.source]}`.replace(/^ · /, '') : 'not found',
    detail: found?.path ?? (status.staleManual ? `Saved location no longer valid: ${status.staleManual}` : 'Use "Locate..." to select it manually.')
  };
}

/** Lists every embedded tool and lets the user locate or forget one. Nothing is installed, executed or downloaded. */
export async function manageEmbeddedTools(registry: EmbeddedToolRegistry): Promise<void> {
  if (!vscode.workspace.isTrusted) { void vscode.window.showWarningMessage('Sakura Atelier: Trust this workspace before scanning for tools; discovery runs version queries.'); return; }
  for (;;) {
    const statuses = await registry.discover();
    const picked = await vscode.window.showQuickPick(embeddedToolIds.map(id => ({ ...describe(statuses[id]), id })), { title: 'Sakura Atelier — Embedded Tools', placeHolder: 'Select a tool to locate manually' });
    if (!picked) { return; }
    const id = picked.id as EmbeddedToolId;
    const actions = ['Locate...', ...(registry.manual()[id] ? ['Forget saved location'] : []), 'Back'];
    const action = await vscode.window.showQuickPick(actions, { title: statuses[id].label });
    if (action === 'Locate...') {
      const uris = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: true, canSelectMany: false, openLabel: 'Use this location', title: `Locate ${statuses[id].label}` });
      if (!uris?.[0]) { continue; }
      try { await registry.locate(id, uris[0].fsPath); } catch (error) { void vscode.window.showErrorMessage(`Sakura Atelier: ${error instanceof Error ? error.message : String(error)}`); }
    } else if (action === 'Forget saved location') { await registry.forget(id); }
  }
}
