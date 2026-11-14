import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
/** Keeps an isolated minimum-version host open for real toolbar accessibility/screenshot checks. */
export async function run(): Promise<void> {
  const root = vscode.workspace.workspaceFolders![0].uri.fsPath;
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(path.join(root, 'main.go')));
  await fs.writeFile(path.join(root, 'ready'), vscode.version);
  for (let i = 0; i < 900; i++) {
    try { await fs.stat(path.join(root, 'done')); return; } catch { await new Promise(resolve => setTimeout(resolve, 1000)); }
  }
  throw new Error('UI inspection timed out');
}
