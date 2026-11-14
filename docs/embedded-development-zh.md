# 嵌入式开发使用说明

Sakura Atelier 为 PlatformIO 和 STM32 项目提供统一入口。实际的构建、烧录、调试仍由官方工具完成：PlatformIO Core、STM32CubeMX、STM32CubeProgrammer、Arm GNU Toolchain，以及 PlatformIO IDE、Cortex-Debug 等官方或社区扩展。Sakura Atelier 不修改系统环境变量，不修改其他扩展的文件，也不自行实现调试协议。

统一向导也提供常用语言的基础项目模板，详见 [新建项目](PROJECT_CREATION.md)。

## 新建项目

入口（均不需要先打开工作区）：

- 菜单“文件 → 新建文件…” → **Sakura Atelier：新建项目…**（通过 VS Code 官方的 `file/newFile` 菜单贡献点添加）
- 命令面板 → **Sakura Atelier：新建项目…**

`file/newFile` 对应“新建文件…”打开的类型选择器，不是在 macOS 原生“文件”菜单中增加一级菜单项。

向导分三栏：左侧选择项目类型和“我的收藏模板”，中间选择器件，右侧依次完成框架、SDK 检查、名称与目录、预览并创建。

| 项目类型 | 做什么 |
| --- | --- |
| PlatformIO 项目 | 选择开发板和该开发板支持的框架，用官方 `pio project init` 创建。 |
| STM32CubeMX 项目 | 创建项目目录；确认后才启动 STM32CubeMX 去配置器件和生成代码。 |
| 打开已有 STM32 项目 | 检查目录里有 `.ioc` 或 STM32 CMake 工程后直接打开。 |

要点：

- 目标目录已存在时不会创建，也不会覆盖或合并任何文件。
- STM32 MCU 型号（如 `STM32G0B1RETx`）、ST 开发板（如 `NUCLEO-G071RB`）和 PlatformIO 开发板 ID（如 `nucleo_g071rb`）是三种不同的器件，不会互相当作对方使用。
- Sakura Atelier 不具备 STM32CubeMX 的引脚配置和代码生成能力，这部分由 STM32CubeMX 完成。
- 创建成功后才会把器件记入“最近使用”。

## 器件收藏

- 每个器件右侧有星标：☆ 未收藏，★ 已收藏。点击即保存，再点一次取消，不需要点击保存或应用。
- 收藏保存在 VS Code 的全局状态（`sakuraAtelier.favoriteDevices`），所有工作区共享，不会写入项目目录（`.vscode/`、`platformio.ini`、`CMakeLists.txt`、源码目录）。
- 收藏和收藏模板（`sakuraAtelier.favoriteTemplates`）只包含器件标识和显示名称，可通过 VS Code 设置同步。本机路径、串口、调试探针、密钥和工具链位置不会被保存，也不会同步。“最近使用”只保存在本机。
- 器件列表分为：我的收藏、最近使用、PlatformIO 开发板、STM32 MCU、STM32 开发板、全部器件。打开向导时优先显示收藏；没有收藏则显示最近使用。
- 搜索支持型号、名称、厂商、平台、MCU 系列、开发板 ID，输入时在内存中实时过滤，并有 200 毫秒防抖，不会反复调用外部命令。
- 工具链或开发板暂时不可用时，收藏不会被删除，会显示“工具链未安装”或“不在当前开发板列表中”。
- 手动添加 STM32 型号：在列表下方输入合法的 STM32 型号，会被校验、收藏并选中。

## 收藏项目配置

选好器件、框架和选项后点击 **收藏此项目配置**。以后在左侧“我的收藏模板”里点击它，会恢复器件、框架、构建系统和常用选项；名称和保存目录需要重新填写，工具链会在创建时重新解析。如果其中的开发板或框架当前不可用，会显示原因和修复建议，而不是悄悄丢弃。

## 器件数据来源

- **PlatformIO 开发板**：来自官方 `pio boards --json-output`，不内置开发板清单。结果缓存在全局存储中（7 天），过期后先显示缓存并在后台刷新，失败时保留旧列表。命令 **Sakura Atelier: Reload PlatformIO Boards** 可手动重新加载。
- **STM32 MCU 与开发板**：读取本机 STM32CubeMX 的器件数据库，并合并工作区 `.ioc` 文件及手动输入的型号。自定义安装路径请先在“嵌入式工具”中定位 CubeMX，再点击“重新加载器件”。数据库布局不兼容时保留 `.ioc` 和手动输入。详见 `docs/stm32-device-data.md`。

## 嵌入式工具

命令 **Sakura Atelier: Embedded Tools...** 列出并可手动定位：PlatformIO Core、STM32CubeMX、STM32Cube CLI、STM32CubeCLT、Arm GNU Toolchain 和 GDB、CMake、Ninja、STM32CubeProgrammer、ST-LINK GDB Server。发现顺序为：你保存的位置、`PATH`、CubeCLT 内置工具、Arm 编译器旁的工具、经过校验的常见位置。不依赖固定安装路径，Windows、Linux、macOS 通用。

## 构建、烧录与调试

- **PlatformIO**：环境来自 `platformio.ini` 的 `[env:NAME]`。命令为构建、清理、上传、串口监视器、测试、设备上测试和调试。上传、设备上测试和调试会写入开发板，执行前需要确认。在开发板环境上“测试”默认只构建，不上传。调试使用 PlatformIO IDE 扩展。
- **STM32**：构建、烧录、调试是三个独立命令，没有“运行即烧录”。烧录必须明确选择固件、调试探针并确认目标 MCU；只编程和校验，不做整片擦除，也拒绝擦除和选项字节参数。调试使用 Cortex-Debug 扩展。
- **.ioc 文件**：双击在编辑器区域打开 Sakura Atelier 页面（文件名、MCU、STM32CubeMX 状态、“使用 STM32CubeMX 打开”、“作为文本打开”）。双击不会启动 STM32CubeMX，点击按钮后才会。

## 远程与受限环境

- SSH、WSL、Dev Container 窗口中，PlatformIO 等工具在远程端运行；板卡列表缓存和收藏也在远程端的全局状态中，可通过设置同步在本地与远程之间共享。
- 本机的 STM32CubeMX 无法打开远程路径，因此远程窗口里“使用 STM32CubeMX 打开”会被禁用并说明原因，“作为文本打开”仍可用。
- 工作区未受信任时，不会扫描工具或运行任何程序。

## 与其他扩展的兼容

可与 PlatformIO IDE、STM32CubeIDE for VS Code、Cortex-Debug、CMake Tools 和 C/C++ 扩展同时安装。Sakura Atelier 不替换它们的界面，不调用它们的私有命令，只通过公开的调试类型（`platformio-debug`、`cortex-debug`）发起调试。只安装 Sakura Atelier 时，创建项目、构建和 `.ioc` 查看都可用；调试会提示需要安装对应扩展。

## 尚未实现

- 为新建的 PlatformIO 项目自动生成 Sakura Atelier 运行配置：运行配置的存储格式正在由其他变更调整，待模板注册表合入后再接入。现有的 PlatformIO 命令已经可以直接在新项目中使用。
- 其他芯片平台（TI MSPM0、MSP430、RP2040 专用流程、ESP-IDF、AVR 专用流程）。器件和项目后端已预留扩展接口，但本次没有实现。
