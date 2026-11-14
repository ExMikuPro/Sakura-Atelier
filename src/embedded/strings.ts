/**
 * UI strings for embedded features. Keys are the English text, values the Simplified Chinese text, so a missing entry falls back to English.
 * The key/value convention matches the shared dictionary in PR #1 (`localization.ts`); these entries can be merged into it unchanged.
 */
export type UiLanguage = 'zh-cn' | 'en';

export const embeddedChinese: Record<string, string> = {
  'STM32CubeMX project': 'STM32CubeMX 工程',
  'File name': '文件名',
  'MCU': 'MCU 型号',
  'Not recognized': '未识别',
  'Board': '开发板',
  'STM32CubeMX': 'STM32CubeMX',
  'Installed': '已安装',
  'Not found': '未找到',
  'Open with STM32CubeMX': '使用 STM32CubeMX 打开',
  'Open as text': '作为文本打开',
  'Locate STM32CubeMX...': '手动定位 STM32CubeMX…',
  'STM32CubeMX is not started until you click "Open with STM32CubeMX".': '只有点击“使用 STM32CubeMX 打开”后才会启动 STM32CubeMX。',
  'This file is in a remote or virtual workspace. A local STM32CubeMX cannot open a remote path, so launching is disabled. Open the project locally, or use "Open as text".': '此文件位于远程或虚拟工作区。本机的 STM32CubeMX 无法打开远程路径，因此已禁用启动。请在本地打开该工程，或使用“作为文本打开”。',
  'Trust this workspace to launch STM32CubeMX.': '请先信任此工作区，才能启动 STM32CubeMX。',
  'STM32CubeMX was not found. Locate it manually; no fixed install path is assumed.': '未找到 STM32CubeMX。请手动定位；本扩展不依赖固定安装路径。',
  'Part number': '完整型号',
  'Family': '系列',
  'Package': '封装',
  'Could not start STM32CubeMX: {0}': '无法启动 STM32CubeMX：{0}',
  'The file could not be read.': '无法读取该文件。',
  'Read-only view. Sakura Atelier does not edit .ioc files or generate code.': '只读视图。Sakura Atelier 不编辑 .ioc 文件，也不生成代码。'
};

export function resolveUiLanguage(configured: string | undefined, vscodeLanguage: string | undefined): UiLanguage {
  const value = (configured ?? 'zh-cn').toLowerCase();
  if (value === 'en') { return 'en'; }
  if (value === 'auto') { return (vscodeLanguage ?? '').toLowerCase().startsWith('zh') ? 'zh-cn' : 'en'; }
  return 'zh-cn';
}

export function translateEmbedded(language: UiLanguage, message: string, ...args: unknown[]): string {
  const text = language === 'zh-cn' ? embeddedChinese[message] ?? message : message;
  return text.replace(/\{(\d+)\}/g, (_, i: string) => String(args[Number(i)] ?? ''));
}
