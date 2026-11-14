import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { parseIoc } from './ioc';
import { buildViewModel, decideLaunch, renderIocPage, LaunchContext } from './iocView';
import { createToolRegistry } from '../toolsCommand';
import { resolveUiLanguage, translateEmbedded } from '../strings';

export const iocViewType = 'sakuraAtelier.iocViewer';
interface IocDocument extends vscode.CustomDocument { readonly uri: vscode.Uri }

/** Read-only `.ioc` page. Opening it only reads the file; STM32CubeMX starts only after the user clicks the button. */
export class IocEditorProvider implements vscode.CustomReadonlyEditorProvider<IocDocument> {
  constructor(private readonly context: vscode.ExtensionContext) {}
  openCustomDocument(uri: vscode.Uri): IocDocument { return { uri, dispose() { /* nothing to release */ } }; }

  private language() { return resolveUiLanguage(vscode.workspace.getConfiguration('sakuraAtelier').get<string>('language', 'zh-cn'), vscode.env.language); }

  private async launchContext(uri: vscode.Uri): Promise<LaunchContext> {
    // Registry lookup only reads saved paths and file metadata; it never executes CubeMX.
    const status = vscode.workspace.isTrusted ? (await createToolRegistry(this.context).discover()).stm32cubemx : undefined;
    return { scheme: uri.scheme, remoteName: vscode.env.remoteName, trusted: vscode.workspace.isTrusted, cubemxPath: status?.selected?.path };
  }

  private async render(document: IocDocument, panel: vscode.WebviewPanel): Promise<void> {
    let info; try { info = parseIoc(Buffer.from(await vscode.workspace.fs.readFile(document.uri)).toString('utf8')); } catch { info = undefined; }
    const nonce = randomBytes(16).toString('base64');
    panel.webview.html = renderIocPage(buildViewModel(document.uri.path, info, await this.launchContext(document.uri)), this.language(), nonce, panel.webview.cspSource);
  }

  async resolveCustomEditor(document: IocDocument, panel: vscode.WebviewPanel): Promise<void> {
    panel.webview.options = { enableScripts: true };
    await this.render(document, panel);
    const language = this.language();
    panel.webview.onDidReceiveMessage(async (message: unknown) => {
      const type = (message as { type?: unknown } | undefined)?.type;
      try {
        if (type === 'openText') { await vscode.commands.executeCommand('vscode.openWith', document.uri, 'default'); }
        else if (type === 'locate') {
          const picked = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: true, canSelectMany: false, openLabel: translateEmbedded(language, 'Locate STM32CubeMX...'), title: translateEmbedded(language, 'Locate STM32CubeMX...') });
          if (picked?.[0]) { await createToolRegistry(this.context).locate('stm32cubemx', picked[0].fsPath); await this.render(document, panel); }
        } else if (type === 'openCubeMX') {
          // The decision is recomputed here; the page's disabled state is never trusted.
          const decision = decideLaunch(await this.launchContext(document.uri), document.uri.fsPath);
          if (!decision.ok) { await this.render(document, panel); return; }
          const child = spawn(decision.command, decision.args, { detached: true, stdio: 'ignore', windowsHide: false });
          child.once('error', error => { void vscode.window.showErrorMessage(`Sakura Atelier: ${translateEmbedded(language, 'Could not start STM32CubeMX: {0}', error.message)}`); });
          child.unref();
        }
      } catch (error) { void vscode.window.showErrorMessage(`Sakura Atelier: ${error instanceof Error ? error.message : String(error)}`); }
    });
  }
}
