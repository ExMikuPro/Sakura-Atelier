import { embeddedChinese, UiLanguage } from '../strings';

/** Chinese text for the project wizard. Same English-key convention as the shared dictionary of PR #1. */
export const wizardChinese: Record<string, string> = {
  'STM32 devices come from your local STM32CubeMX database and workspace .ioc files.': 'STM32 器件来自本机 STM32CubeMX 数据库和工作区 .ioc 文件。',
  'No STM32 devices loaded. Locate STM32CubeMX, then reload devices, or enter a part number manually.': '尚未加载 STM32 器件。请定位 STM32CubeMX 后点击“重新加载器件”，也可以手动添加型号。',
  'Empty project': '空项目',
  'Create an empty folder without source files, dependencies or run configurations.': '仅创建空文件夹，不生成源码、依赖或运行配置。',
  'No files will be created.': '不生成任何文件。',
  'Programming languages': '编程语言', 'Embedded projects': '嵌入式项目', 'Files to create': '将创建的文件',
  'Python project': 'Python 项目', 'JavaScript / Node.js project': 'JavaScript / Node.js 项目', 'TypeScript project': 'TypeScript 项目',
  'Go project': 'Go 项目', 'Rust / Cargo project': 'Rust / Cargo 项目', 'C project': 'C 项目', 'C++ project': 'C++ 项目', 'C# / .NET project': 'C# / .NET 项目', 'Java project': 'Java 项目',
  'Create source files, project metadata and a Sakura Atelier run configuration.': '创建示例代码、项目文件和现有 Sakura Atelier 运行配置。',
  'warning.no-runtime': '项目可以创建。运行或调试前，请在开发环境中选择或配置对应 SDK。',
  'warning.project-dependencies': 'TypeScript 项目运行前需要安装所声明的项目依赖。可通过项目依赖检查审阅安装计划。',

  'New project': '新建项目',
  'Project types': '项目类型',
  'PlatformIO project': 'PlatformIO 项目',
  'STM32CubeMX project': 'STM32CubeMX 项目',
  'Open existing STM32 project': '打开已有 STM32 项目',
  'My favorite templates': '我的收藏模板',
  'Create a project for a PlatformIO board with the official PlatformIO CLI.': '使用官方 PlatformIO CLI 为开发板创建项目。',
  'Create the project folder and configure the device in STM32CubeMX. Code generation is done by STM32CubeMX.': '创建项目目录，并在 STM32CubeMX 中配置器件。代码生成由 STM32CubeMX 完成。',
  'Open a folder that already has an .ioc file or an STM32 CMake project.': '打开已有 .ioc 文件或 STM32 CMake 工程的目录。',
  'My favorites': '我的收藏', 'Recently used': '最近使用', 'PlatformIO boards': 'PlatformIO 开发板', 'STM32 MCUs': 'STM32 MCU', 'STM32 boards': 'STM32 开发板', 'All devices': '全部器件',
  'Search by name, part number, vendor, platform or board id': '按名称、型号、厂商、平台或开发板 ID 搜索',
  'Add to favorites': '收藏', 'Remove from favorites': '取消收藏',
  'Toolchain not installed': '工具链未安装', 'Not in the current board list': '不在当前开发板列表中', 'Platform not installed yet': '平台尚未安装',
  'No favorites yet. Click the star next to a device.': '还没有收藏。点击器件旁的星标即可收藏。',
  'No recent devices. Devices are recorded after a project is created.': '还没有最近使用的器件。成功创建项目后才会记录。',
  'No matching devices': '没有匹配的器件', 'Loading devices...': '正在加载器件…',
  'Reload devices': '重新加载器件', 'Clear recent devices': '清除最近使用',
  'Device': '器件', 'Framework': '框架', 'Build system': '构建系统', 'SDK and toolchain': 'SDK 与工具链',
  'Project name': '项目名称', 'Save location': '保存目录', 'Browse...': '浏览…', 'Preview': '预览',
  'Create project': '创建项目', 'Open project': '打开项目',
  'Save this configuration as favorite': '收藏此项目配置', 'Remove this favorite configuration': '取消收藏此项目配置',
  'Select a device': '请选择器件', 'Select a framework': '请选择框架', 'Choose...': '请选择…',
  'PlatformIO Core': 'PlatformIO Core', 'Found': '已找到', 'Locate...': '定位…',
  'Add an STM32 part number manually': '手动添加 STM32 型号', 'Add': '添加',
  'Monitor speed': '串口监视器波特率', 'Include sample code': '包含示例代码',
  'Toolchain in STM32CubeMX': 'STM32CubeMX 中的工具链', 'Steps': '步骤',
  'Project type': '项目类型', 'Choose a device': '选择器件', 'Framework and build system': '框架与构建系统', 'Check the SDK and toolchain': '检查 SDK 与工具链', 'Name and location': '名称与目录', 'Preview and create': '预览并创建',
  'Favorite configuration saved. Next time pick it under "My favorite templates".': '已收藏此配置。下次可在“我的收藏模板”中直接选择。',
  'Created {0}.': '已创建 {0}。', 'Could not create the project: {0}': '无法创建项目：{0}',
  'Cancel': '取消', 'Reload': '重新加载',
  'Restored from "{0}".': '已从“{0}”恢复配置。', 'Cannot use this favorite yet:': '暂时无法使用此收藏：',
  'Not available': '不可用', 'None': '无',
  // Plan blockers (by code)
  'blocker.template': '项目模板不可用。',
  'blocker.name': '项目名称无效：只能包含字母、数字、点、连字符和下划线，以字母或数字开头，最长 64 个字符。',
  'blocker.parent': '请选择一个已存在的保存目录。',
  'blocker.exists': '该目录下已存在同名文件夹。不会覆盖已有文件，请换一个名称。',
  'blocker.device-required': '请先选择器件。',
  'blocker.device-kind': '所选器件类型与此模板不匹配。STM32 MCU 或开发板名称不会被当作 PlatformIO 开发板 ID。',
  'blocker.board-unknown': 'PlatformIO 未收录该开发板，请重新加载开发板列表或选择其他开发板。',
  'blocker.framework': '请选择该开发板支持的框架。',
  'blocker.option': '包含不支持的选项。',
  'blocker.no-pio': '未找到 PlatformIO Core。请在“嵌入式工具…”中手动定位。',
  'blocker.not-stm32': '该目录不是 STM32 项目（没有 .ioc 文件，也不是 STM32 CMake 工程）。',
  'warning.remote-cubemx': '当前是远程窗口，本机的 STM32CubeMX 无法打开远程目录。目录仍会创建；请在本地打开该项目后再使用 STM32CubeMX。',
  'warning.no-cubemx': '未找到 STM32CubeMX。目录仍会创建；请在“嵌入式工具…”中定位 STM32CubeMX 后再配置器件。',
  // Favorite restore problems (by code)
  'problem.template-missing': '当前版本没有该项目模板。', 'fix.template-missing': '请更新 Sakura Atelier 或选择其他模板。',
  'problem.device-unavailable': '暂时无法列出 PlatformIO 开发板，因此无法检查已收藏的开发板。', 'fix.device-unavailable': '请在“嵌入式工具…”中定位 PlatformIO Core，或重新加载开发板。',
  'problem.device-unknown': 'PlatformIO 已不再收录所收藏的开发板。', 'fix.device-unknown': '请重新加载开发板，或选择相近的开发板后重新收藏。',
  'problem.framework-unsupported': '该开发板已不支持所收藏的框架。', 'fix.framework-unsupported': '请选择该开发板支持的其他框架。'
};

/** Strings the wizard shows. Wizard text falls back to the shared embedded dictionary, then to English. */
export function wizardText(language: UiLanguage, message: string, ...args: unknown[]): string {
  const text = language === 'zh-cn' ? wizardChinese[message] ?? embeddedChinese[message] ?? message : message;
  return text.replace(/\{(\d+)\}/g, (_, i: string) => String(args[Number(i)] ?? ''));
}

/** Static labels the page needs. The page itself contains no text of its own; everything comes translated from here. */
export const wizardLabelKeys = [
  'No files will be created.',
  'Programming languages', 'Embedded projects', 'Files to create', 'New project', 'Project types', 'My favorite templates', 'Search by name, part number, vendor, platform or board id', 'Reload devices', 'Clear recent devices',
  'Add to favorites', 'Remove from favorites', 'Device', 'Framework', 'Build system', 'SDK and toolchain', 'Project name', 'Save location', 'Browse...', 'Preview',
  'Create project', 'Save this configuration as favorite', 'Remove this favorite configuration', 'Select a device', 'Select a framework', 'Choose...', 'Locate...',
  'Add an STM32 part number manually', 'Add', 'Monitor speed', 'Include sample code', 'Toolchain in STM32CubeMX', 'Steps', 'Cancel', 'Found', 'Not found', 'Cannot use this favorite yet:', 'None'
] as const;
