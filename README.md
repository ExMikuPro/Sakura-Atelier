<div align="center">

<img src="media/icon.png" alt="Sakura Atelier Logo" width="160" />

# 🌸 Sakura Atelier

**连接桌面软件与嵌入式系统的统一多语言跨平台 VS Code 开发工作空间**

[![VS Code](https://img.shields.io/badge/VS%20Code-1.85.0%2B-007ACC?style=flat-square&logo=visual-studio-code)](https://code.visualstudio.com/)
[![Version](https://img.shields.io/badge/Version-0.1.0-f48fb1?style=flat-square)](https://github.com/ExMikuPro/Sakura-Atelier)
[![Language](https://img.shields.io/badge/Language-简体中文%20%7C%20English-880e4f?style=flat-square)](#5-双语支持与架构特性)
[![Platform](https://img.shields.io/badge/Platform-macOS%20(ARM64)%20%7C%20Linux%20%7C%20Windows-lightgrey?style=flat-square)](#当前状态与验证范围)

[核心理念](#核心理念) • [核心功能](#核心功能) • [支持的语言与嵌入式生态](#支持的语言与嵌入式生态) • [快速开始](#快速开始) • [配置与安全机制](#配置与安全机制) • [项目结构](#项目结构)

</div>

---

## 核心理念

**Sakura Atelier**（扩展 ID：`ExMikuPro.sakura-atelier`）是一款基于 Visual Studio Code 开发的开源、多语言、跨平台开发辅助扩展。

在日常开发中，开发者往往需要在不同的语言插件、构建脚本、终端命令行与硬件烧录软件之间频繁切换。Sakura Atelier 致力于将**项目创建、代码运行、断点调试、运行配置、SDK 管理与嵌入式工具链**整合到统一、简洁且可移植的工作流中：

- **统一入口，拒绝割裂**：所有语言与硬件工程共用同一套编辑器顶部工具栏（`Run` / `Debug` / `Select Configuration` / `Stop`）与可视化设置中心，不抢占快捷键（如 `F5`），不侵入修改用户全局配置或已有 `launch.json` / `tasks.json`。
- **生态复用，克制设计**：采用模块化适配器架构（`RuntimeAdapter`），充分复用官方编译器、调试扩展（如 CodeLLDB、Python Debugger、Cortex-Debug、PlatformIO IDE）与系统包管理器，不重复造轮子。
- **边界清晰，安全可控**：个人本地路径与项目共享配置严格隔离；所有涉及安装、烧录、删除或覆写的操作均设有原生二次确认，未信任工作区默认禁止执行扫描与外部命令。

---

## 核心功能

### 1. 统一运行、调试与配置中心
- **可视化设置中心**：提供左侧树状导航与右侧表单的统一管理界面，支持**停止输入 700ms 自动保存**、外部磁盘文件冲突检测与差异对比，以及基于 VS Code `SecretStorage` 的本地加密草稿恢复。
- **25 套内置配置模板**：覆盖主流语言的运行、构建、测试与现有前台任务，支持逐行编辑启动参数（`args`）与环境变量（支持 `${env:NAME}` 与 `${secret:NAME}` 密钥引用）。
- **个人与项目双存储模式**：
  - **个人配置（默认）**：保存在本机工作区状态中，不产生 `.vscode/` 文件，不污染 Git 仓库。
  - **项目配置**：保存至 `.vscode/sakura-atelier.json`，自动将工作区路径转换为 `${workspaceFolder}` 等可移植变量，便于团队协作共享。

### 2. 统一项目创建向导与语言初始化
通过菜单 **文件 → 新建文件… → Sakura Atelier：新建项目…** 或命令面板启动三栏式创建向导（详见 [新建项目说明](docs/PROJECT_CREATION.md) 与 [语言项目初始化说明](docs/LANGUAGE_PROJECT_INITIALIZATION.md)）：
- **通用软件工程**：一键生成包含规范目录结构、基础源码、`.gitignore` 与初始运行配置的 Python、JavaScript/Node.js、TypeScript、Go、Rust、C、C++、C#、Java 及空项目工程。
- **Python、TypeScript 与 Java 深度初始化**：
  - **Python**：按所选 SDK 自动创建并验证 `.venv`，支持 `pip` / `uv`。
  - **TypeScript**：按所选 `npm` / `pnpm` 安装依赖，自动生成开发、编译与产物启动脚本。
  - **Java / Spring Initializr**：支持普通应用与官方 Spring Initializr，提供 Maven、Gradle（Groovy/Kotlin）、JDK、项目坐标及框架依赖选项；支持**一键配置 Maven / Gradle / Wrapper**（复用已有工具或下载至本机独立存储，优先使用项目内的 `mvnw` / `gradlew`）。
  - **安全可控的初始化流程**：全程显示进度，失败时保留已创建项目并清晰报告原因；绝不修改全局 `PATH` 或系统默认 SDK。
- **嵌入式工程与器件收藏**：支持按型号、厂商、MCU 系列检索 PlatformIO 开发板与 STM32 MCU/开发板；支持一键星标收藏常用器件及“项目配置模板”（仅同步器件与框架标识，绝不泄露本机路径与串口信息）。
- **严格目录保护**：创建前完整预览文件清单，采用排他写入机制，绝不覆盖或合并已存在的非空目录。

### 3. SDK Manager 与开发环境检测
- **多语言环境自动发现**：自动探测本机已安装的 Python（支持虚拟环境 `.venv` 与终端自动激活）、Node.js、Go、Rust（`rustup` 工具链）、GCC/Clang/MSVC、.NET SDK 与 JDK，支持按**单个配置 > 工作区默认 > 全局默认 > 自动发现**的优先级解析。
- **原生包管理器对接**：内置“SDK 安装与更新”视图，在用户明确确认后调用原生终端执行安装，支持 **Homebrew**（macOS）、**APT**（Debian/Ubuntu）与 **WinGet**（Windows），不擅自修改系统全局 `PATH` 或符号链接。

### 4. 嵌入式开发工作流（PlatformIO & STM32）
更多细节请参阅 [嵌入式开发使用说明](docs/embedded-development-zh.md)：
- **PlatformIO 集成**：自动解析 `platformio.ini` 中的多环境（`[env:*]`），提供构建（Build）、清理（Clean）、上传（Upload）、串口监视器（Monitor）、测试及调试入口。
- **STM32 独立工程流**：支持识别 STM32CubeMX 与 STM32 CMake 工程，自动发现 Arm GNU Toolchain、CMake、Ninja、STM32CubeProgrammer 与 ST-LINK GDB Server。
- **经典 STM32CubeMX 6.x 工程生成**：通过内置 CLI `-q` / `-s` 创建 `.ioc` 和 CMake 工程，支持 `-i` 配置及已有工程重新生成（详见 [STM32CubeMX 6.x 工作流说明](docs/STM32_CUBEMX6_WORKFLOW.md)）。
- **操作严格分离**：将 **Build（构建）**、**Flash（烧录）** 与 **Debug（调试）** 拆分为独立动作，普通运行绝不会误触发硬件烧录，烧录过程仅执行编程与校验，拒绝整片擦除参数。
- **专用 `.ioc` 只读视图**：双击 `.ioc` 文件即可在 VS Code 内直观查看工程与 MCU 摘要，并提供安全唤起本地 STM32CubeMX 的入口（SSH/WSL/容器远程环境下自动禁用本地启动并给出提示）。

### 5. 双语支持与架构特性
- **即时中英双语切换**：通过 `sakuraAtelier.language`（支持 `zh-cn`、`en`、`auto`）即时切换设置中心、模板、状态提示与确认弹窗语言，同时保持用户自定义名称与工具原始输出不被篡改。
- **向后兼容**：完整保留旧版 `sakuraRunner.*` 命令别名与 `.vscode/sakura-runner.json` 配置兼容。

---

## 支持的语言与嵌入式生态

| 类别 | 语言 / 平台 | 核心能力 | 协同调试 / 底层工具 |
| :--- | :--- | :--- | :--- |
| **通用软件** | **Python** | 脚本、模块（`-m`）、Pytest、`.venv` 自动初始化与终端激活 | Python Debugger |
| | **JavaScript / TypeScript** | Node.js 运行、npm/pnpm/yarn 脚本与依赖初始化、本地 `tsx` / `ts-node` / `tsc` | 内置 JavaScript Debugger |
| | **Go** | `go run` / `build` / `test`、`go.mod` / `go.work`、`GOROOT` 管理 | Go 扩展 + Delve |
| | **Rust** | Cargo 运行 / 构建 / 测试 / 示例、多 `toolchain` 与 `profile` 切换 | CodeLLDB |
| | **C / C++** | 单/多源文件编译（GCC/Clang/MSVC）、标准与链接参数、Make/CMake | CodeLLDB / C++ 调试扩展 |
| | **C# / .NET** | `csproj` / `sln` / `slnx`、`dotnet run` / `build` / `test` | 官方 C# 调试支持 |
| | **Java** | 单文件运行、Spring Initializr、Maven / Gradle / Wrapper 一键配置与任务联动 | Java Debugger |
| **嵌入式** | **PlatformIO** | 开发板数据库检索、多环境构建/上传/串口监视/调试 | PlatformIO Core / IDE |
| | **STM32** | CubeMX 6.x 生成与 CMake 工程识别、`.ioc` 查看器、独立固件烧录与调试 | CubeCLT / CubeProgrammer / Cortex-Debug |

---

## 快速开始

### 环境要求
- **Visual Studio Code**：`1.85.0` 或更高版本
- **源码构建要求**：Node.js `22+` 与 `npm`

### 安装方式
1. 从 Release 页面下载最新的 `sakura-atelier-0.1.0.vsix`（或通过源码自行打包）。
2. 打开 VS Code，进入 **扩展视图（Extensions） → 右上角 `...` 菜单 → Install from VSIX...** 选择安装包。
3. 安装完成后执行 **Reload Window**。

### 常用命令
打开任意受支持的代码文件后，可直接使用编辑器右上角工具栏图标，或通过命令面板（`Ctrl+Shift+P` / `Cmd+Shift+P`）调用：

| 命令 ID | 说明 |
| :--- | :--- |
| `sakuraAtelier.run` | 使用当前选定的配置运行项目或文件 |
| `sakuraAtelier.debug` | 使用当前配置启动调试会话 |
| `sakuraAtelier.selectConfiguration` | 快速切换运行配置（Auto / 文件 / 项目 / 测试 / 已有任务） |
| `sakuraAtelier.editConfigurations` | 打开可视化设置中心与配置管理 |
| `sakuraAtelier.addConfiguration` | 从 25 套内置模板中新增运行配置 |
| `sakuraAtelier.sdkManager` | 打开 SDK 安装、版本查询与包管理器集成视图 |
| `sakuraAtelier.manageToolchains` | 扫描或手动绑定本地语言工具链与嵌入式工具路径 |
| `sakuraAtelier.pythonTerminal` | 创建并自动激活所选 Python 虚拟环境的新终端 |
| `sakuraAtelier.stop` | 仅停止由 Sakura Atelier 启动的运行或调试进程 |

---

## 配置与安全机制

### 配置文件示例（`.vscode/sakura-atelier.json`）
在项目配置模式下，所有路径自动使用跨平台变量存储，本机工具链路径则通过 `${toolchain:...}` 保存在本机状态中，确保团队成员拉取代码后互不干扰：

```json
{
  "version": 1,
  "default": "python-main",
  "configurations": [
    {
      "id": "python-main",
      "templateId": "python.script",
      "name": "Python — main.py",
      "language": "python",
      "kind": "file",
      "target": "${workspaceFolder}/src/main.py",
      "cwd": "${workspaceFolder}",
      "toolchain": "${workspaceFolder}/.venv/bin/python",
      "args": ["--name", "hello world"],
      "env": {
        "API_TOKEN": "${secret:API_TOKEN}"
      },
      "terminal": true
    }
  ]
}
```

### 从源码构建与测试

```bash
# 安装依赖
npm ci

# 编译与代码检查
npm run compile
npm run lint

# 运行单元测试、集成测试与界面回归测试
npm test
npm run test:integration
npm run test:ui

# 打包生成 VSIX 安装包
npm run package
```

---

## 项目结构

```text
Sakura-Atelier/
├── src/
│   ├── extension.ts                 # 扩展生命周期与命令注册入口
│   ├── controller.ts                # 核心调度控制器与状态管理
│   ├── adapters.ts / projects.ts    # 多语言与嵌入式项目识别及 RuntimeAdapter 实现
│   ├── toolchains.ts / sdkManager.ts# 工具链自动探测与包管理器（Brew/APT/WinGet）集成
│   ├── configuration*.ts            # 双存储配置引擎、Schema 校验与冲突保护
│   ├── templates.ts                 # 25 套配置模板与项目创建脚手架
│   ├── debugService.ts              # 外部调试扩展桥接与会话所有权追踪
│   ├── pythonEnvironments.ts        # Python 环境接口集成与终端激活脚本生成
│   └── localization.ts / i18n.ts    # 简体中文 / English 双语资源管理
├── media/                           # 设置中心 Webview 界面、状态机与图标资源（icon.png）
├── docs/                            # 详细设计文档、新建项目、语言初始化与嵌入式使用说明
├── scripts/                         # 构建脚本与隔离 Extension Host 测试启动器
├── test/                            # 单元测试、集成测试与 Playwright UI 测试
└── configuration.schema.json        # .vscode/sakura-atelier.json 智能提示校验架构
```

---

## 当前状态与验证范围

本项目目前处于持续开发阶段（`v0.1.0`），核心集成测试与 UI 回归主要在 **macOS ARM64 (Apple Silicon)** 环境下完成：

- **已真实验证**：macOS ARM64 下的编译打包、可视化设置中心、项目创建向导（全语言工程生成与依赖初始化）、多语言运行与 Node.js / TypeScript / Python 断点调试、虚拟环境自动创建与激活、Homebrew 只读包查询以及 `.ioc` 只读编辑器。
- **实现完成待实机深化测试**：
  - 嵌入式硬件端到端真机烧录（ST-LINK / `STM32_Programmer_CLI`）、Cortex-Debug 实机单步调试、STM32CubeMX 6.x 真实工程生成以及 PlatformIO 真机连接上传（目前已完成参数构建与模拟执行验证）。
  - Go（Delve）、CMake 完整调试流与 C#（.NET SDK）在不同环境下的实机调试。
  - **Windows** 与 **Linux** 平台的原生端到端兼容性验收（已内置跨平台路径与 APT / WinGet 逻辑，欢迎社区提交测试反馈与 Issue）。

---

<div align="center">

Made with 🌸 by [ExMikuPro](https://github.com/ExMikuPro)

</div>