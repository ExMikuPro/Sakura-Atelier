# 嵌入式开发使用说明

Sakura Atelier 为 **PlatformIO** 与 **STM32** 工程提供统一的项目创建、器件管理、工具链定位及构建/烧录/调试入口，底层协同调用 PlatformIO Core、STM32CubeMX 6.x、STM32CubeProgrammer、Arm GNU Toolchain 与 Cortex-Debug 等官方及社区工具。

## 1. 新建嵌入式项目

通过 **文件 → 新建文件… → Sakura Atelier：新建项目…** 或命令面板打开三栏式向导（无需预先打开工作区）：

| 项目类型 | 说明 |
| :--- | :--- |
| **PlatformIO 项目** | 选择开发板与对应框架，调用官方 `pio project init` 生成标准工程 |
| **STM32CubeMX 项目** | 选择 STM32 MCU 或开发板，调用经典 6.x CLI（`-q` / `-s`）生成 `.ioc` 与 CMake / ARM GCC 工程（详见 [CubeMX 6.x 工作流](STM32_CUBEMX6_WORKFLOW.md)） |
| **打开已有 STM32 项目** | 校验目录内包含 `.ioc` 或 STM32 CMake 工程后直接打开 |

> **注意**：目标目录已存在时拒绝创建，绝不覆盖用户文件；STM32 MCU 型号、ST 开发板与 PlatformIO 开发板 ID 相互独立，不会隐式混用。

## 2. 器件检索、收藏与配置模板

- **本地数据来源**：PlatformIO 开发板通过 `pio boards --json-output` 获取并缓存 7 天；STM32 器件自动读取本机 STM32CubeMX 数据库（`families.xml` 与 `*.pdsc`），并合并工作区 `.ioc` 及手动输入的合法型号（详见 [STM32 器件数据源说明](stm32-device-data.md)）。
- **星标收藏与跨机同步**：点击器件右侧星标（☆/★）即可保存至全局收藏；点击 **收藏此项目配置** 可将器件、框架与构建选项存为模板。收藏数据仅保存器件标识与名称，可通过 VS Code Settings Sync 同步，绝不包含本机路径、串口或密钥。

## 3. 嵌入式工具链管理

运行命令 **Sakura Atelier: Embedded Tools...** 可查看并手动定位 PlatformIO Core、STM32CubeMX 6.x、STM32CubeCLT、Arm GNU Toolchain/GDB、CMake、Ninja、STM32CubeProgrammer 与 ST-LINK GDB Server。

## 4. 构建、烧录、调试与 `.ioc` 查看

- **PlatformIO**：自动读取 `platformio.ini` 中的 `[env:*]` 环境，支持构建、清理、上传、串口监视器、测试与调试（`platformio-debug`）；上传与设备上测试前需用户确认。
- **STM32**：**构建（Build）**、**烧录（Flash）** 与 **调试（Debug）** 为三个独立命令。烧录前需明确确认固件、探针与目标芯片，仅执行编程与校验，不做整片擦除；调试通过 `cortex-debug` 发起。
- **`.ioc` 专用视图**：双击 `.ioc` 文件默认打开 Sakura Atelier 摘要页（展示 MCU 型号与 CubeMX 状态），点击按钮后才启动 STM32CubeMX，远程（SSH/WSL/容器）窗口下自动禁用本机 GUI 启动并保留文本打开入口。