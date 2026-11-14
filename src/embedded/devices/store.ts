import type { KeyValueStore } from '../toolRegistry';

/** `vscode.ExtensionContext.globalState` also offers `setKeysForSync`; tests may omit it. */
export interface SyncableStore extends KeyValueStore { setKeysForSync?(keys: readonly string[]): void }

export const favoriteDevicesKey = 'sakuraAtelier.favoriteDevices';
export const recentDevicesKey = 'sakuraAtelier.recentDevices';
export const favoriteTemplatesKey = 'sakuraAtelier.favoriteTemplates';

/**
 * Only favorites and favorite templates sync. They hold ids and display names, never absolute paths, serial ports,
 * probe ids, secrets or toolchain locations. Recent devices stay on the machine.
 */
export const syncedKeys: readonly string[] = [favoriteDevicesKey, favoriteTemplatesKey];
export function enableSettingsSync(store: SyncableStore): void { store.setKeysForSync?.(syncedKeys); }
