import * as vscode from 'vscode';
import * as path from 'node:path';
import { createToolRegistry } from '../toolsCommand';
import { generateWithCubeMx, requireClassicCubeMx, cancelCubeMxGenerations } from './cubeMxCli';
import { mxValue, regenerateCubeMxScript } from './cubeMxScript';
import { parseIoc } from './ioc';

let output: vscode.OutputChannel | undefined;
async function pickIoc(uri?: vscode.Uri): Promise<vscode.Uri | undefined> {
  if (uri) return uri;
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active && /\.ioc$/i.test(active.path)) return active;
  const files = await vscode.workspace.findFiles('**/*.ioc', '**/{node_modules,.git,build,.pio}/**', 100);
  if (files.length === 1) return files[0];
  if (files.length) return (await vscode.window.showQuickPick(files.map(file => ({ label: path.basename(file.fsPath), description: file.fsPath, uri: file })), { title: 'STM32CubeMX 6.x — .ioc' }))?.uri;
  return (await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, canSelectMany: false, filters: { 'STM32CubeMX 6.x': ['ioc'] } }))?.[0];
}

export async function cubeMxAction(context: vscode.ExtensionContext, action: 'generate' | 'interactive', resource?: vscode.Uri): Promise<void> {
  if (!vscode.workspace.isTrusted || vscode.env.remoteName) throw new Error('Use a trusted local workspace for STM32CubeMX 6.x.');
  const uri = await pickIoc(resource);
  if (!uri) return;
  if (uri.scheme !== 'file' || !/\.ioc$/i.test(uri.fsPath)) throw new Error('Select a local classic STM32CubeMX .ioc file.');
  const document = await vscode.workspace.openTextDocument(uri);
  if (document.isDirty && !await document.save()) return;
  const text = document.getText();
  const info = parseIoc(text);
  const version = text.match(/^MxCube\.Version=(.+)$/m)?.[1].trim();
  if (!info.mcu || (version && !/^6\./.test(version))) throw new Error('This phase supports classic STM32CubeMX 6.x .ioc projects only.');
  const executable = await createToolRegistry(context).resolve('stm32cubemx');
  if (!executable) throw new Error('Locate classic STM32CubeMX 6.x in Embedded Tools first.');
  await requireClassicCubeMx(executable);
  if (action === 'interactive') {
    const terminal = vscode.window.createTerminal({ name: 'STM32CubeMX 6.x (-i)', shellPath: executable, shellArgs: ['-i'], cwd: path.dirname(executable), isTransient: true });
    terminal.show();
    terminal.sendText(`config load ${mxValue(uri.fsPath)}`);
    void vscode.window.showInformationMessage('CubeMX CLI: edit configuration with CLI commands; use config save to persist the .ioc, and exit when finished.');
    return;
  }
  const mode = await vscode.window.showQuickPick([
    { label: '静默生成 (-q)', mode: '-q' as const }, { label: '脚本生成并显示界面 (-s)', mode: '-s' as const },
  ], { title: 'STM32CubeMX 6.x → CMake / ARM GCC' });
  if (!mode) return;
  const confirmed = await vscode.window.showWarningMessage(`STM32CubeMX 6.x 将根据 ${uri.fsPath} 重新生成 CMake 工程并更新生成文件。自定义代码应保留在 USER CODE 区域中。`, { modal: true }, '生成代码');
  if (!confirmed) return;
  output ??= vscode.window.createOutputChannel('Sakura Atelier — STM32CubeMX generation');
  if (!context.subscriptions.includes(output)) context.subscriptions.push(output, { dispose: cancelCubeMxGenerations });
  output.show(true);
  const root = path.dirname(uri.fsPath); const name = info.projectName || path.basename(uri.fsPath, path.extname(uri.fsPath));
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'STM32CubeMX 6.x — 生成 CMake 工程', cancellable: true }, (_progress, cancellation) => generateWithCubeMx({ executable, root, ioc: uri.fsPath, projectName: name, script: regenerateCubeMxScript(uri.fsPath, root, name), toolchain: 'CMake', mode: mode.mode }, value => output!.append(value), cancellation));
  void vscode.window.showInformationMessage('STM32CubeMX 已生成 CMake 工程。可运行“STM32：构建”。');
}
