import * as vscode from 'vscode';
import { IocEditorProvider, iocViewType } from './stm32/iocEditor';
import { DeviceFavorites } from './devices/favorites';
import { enableSettingsSync } from './devices/store';

/** Registers the embedded custom editors. Called from activation inside a guard so an optional editor can never block the runner. */
export function registerEmbeddedEditors(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.window.registerCustomEditorProvider(iocViewType, new IocEditorProvider(context), { supportsMultipleEditorsPerDocument: true }));
}

/** Opts favorites into Settings Sync (ids and names only) and rewrites an older favorites list in the current format. */
export function initializeEmbeddedState(context: vscode.ExtensionContext): void {
  enableSettingsSync(context.globalState);
  void new DeviceFavorites(context.globalState).migrate().catch(error => console.error('Sakura Atelier: favorite devices could not be migrated.', error));
}
