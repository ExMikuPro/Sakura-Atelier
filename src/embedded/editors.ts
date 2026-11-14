import * as vscode from 'vscode';
import { IocEditorProvider, iocViewType } from './stm32/iocEditor';

/** Registers the embedded custom editors. Called from activation inside a guard so an optional editor can never block the runner. */
export function registerEmbeddedEditors(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.window.registerCustomEditorProvider(iocViewType, new IocEditorProvider(context), { supportsMultipleEditorsPerDocument: true }));
}
