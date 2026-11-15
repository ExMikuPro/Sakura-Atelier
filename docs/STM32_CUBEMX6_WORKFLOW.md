# 经典 STM32CubeMX 6.x 工作流

Sakura Atelier 接入经典 **STM32CubeMX 6.x** 内置 CLI 与 `.ioc` 工程文件，支持在 VS Code 内完成工程生成、交互配置与 CMake 构建（主验证环境为 macOS Apple Silicon + CMake + Arm GNU Toolchain）。

## 工具准备

在命令面板打开 **Sakura Atelier: Embedded Tools...** 检查或手动定位以下工具：
- **STM32CubeMX 6.x**（macOS 自动探测 `/Applications/STMicroelectronics/STM32CubeMX.app` 并校验 6.x 版本元数据）
- **Arm GNU Toolchain**（`arm-none-eabi-gcc`）、**CMake** 与 **Ninja**

> **注意**：所选 MCU 对应的 STM32Cube 固件包需提前在 STM32CubeMX 中安装准备；扩展不下载固件包，也不存储或写入 ST 账号凭据。

## 新建 STM32CubeMX 工程

1. 在新建项目向导中选择 **嵌入式项目 → STM32CubeMX**，选定目标 MCU 型号或 ST 开发板，填写项目名称与路径（默认工具链为 `CMake`，CLI 模式支持静默 `-q` 或界面 `-s`）。
2. 扩展排他创建目标目录后，通过安全参数调用经典 CubeMX CLI 执行芯片/开发板加载、工程生成与 `.ioc` 保存：
   ```text
   load <MCU_OR_BOARD>
   project name "<ProjectName>"
   project path "<ProjectDir>"
   project toolchain "CMake"
   project compiler GCC
   config save "<ProjectDir>/<ProjectName>.ioc"
   project generate
   exit
   ```
3. 仅当进程正常退出且 `.ioc`、CMake 构建文件与 ARM 工具链文件均校验存在时才标记创建成功；失败时保留现场文件供排查。

## 配置修改与重新生成

在编辑器中打开 `.ioc` 文件进入专用视图，或通过命令面板调用：
- **使用 STM32CubeMX 打开**：启动经典 GUI 配置引脚、时钟与外设。
- **使用 CLI 配置 (`-i`)**：在终端启动 `STM32CubeMX -i` 载入当前 `.ioc` 进行交互式配置。
- **重新生成 CMake 工程**：确认后基于当前 `.ioc` 重新生成源码与构建脚本（请将业务代码编写在 CubeMX 的 `USER CODE` 保护区中）。

## 构建与边界说明

- **构建流程**：执行 `STM32：构建` 时按所选 CMake 预设输出至 `build/<preset>`（无预设时默认 `build/Debug` 或 `build/Release`），仅在当前子进程环境中注入已选工具链目录，不修改全局 `PATH`。
- **验证边界**：代码生成与 CMake 构建绝不触发烧录。当前已完成 TypeScript 编译、打包及参数契约检查，真实 CubeMX 6.x CLI 生成与开发板烧录待实机进一步验收。