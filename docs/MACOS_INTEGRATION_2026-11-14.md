# Sakura Atelier macOS 集成验收报告

- **验收日期**：2026-11-14（Asia/Tokyo）
- **目标分支 / 版本**：`dev` · `ExMikuPro.sakura-atelier` `v0.1.0`
- **基准环境**：macOS 15.8.2 (ARM64 / Apple Silicon)、Node.js v26.13.0、VS Code 1.85.2（最低兼容）& 1.146.0（完整 UI/调试）

## PR 合并概览

核心功能分支 `#1` 至 `#15` 已按依赖顺序全部合并至 `dev`（`main` 分支保持基线未改动，未执行强制推送或提前发布）：

| PR 编号 | 模块内容 | 状态 | 验证摘要 |
| :--- | :--- | :--- | :--- |
| `#1` · `#2` | 配置管理基础 & Adapter Registry | MERGED | 编译、Lint、单元测试及隔离 Host 通过 |
| `#3` · `#5` · `#6` · `#8` | 嵌入式工具链、PlatformIO / STM32 后端 & `.ioc` 编辑器 | MERGED | 识别、计划构建及只读编辑器通过 |
| `#9` · `#10` · `#11` | 器件收藏与最近使用、PlatformIO & STM32 器件模型 | MERGED | 内存搜索、星标持久化与数据源回退通过 |
| `#12` · `#14` | 新建项目服务 & 三栏式创建向导 | MERGED | 深浅主题、窄窗口自适应与目录防覆盖通过 |
| `#4` · `#7` · `#13` | Project SDK 检测、Python 环境与项目依赖管理 | MERGED | 虚拟环境创建、依赖树读取与确认门禁通过 |
| `#15` | macOS CI 自动化流水线 | MERGED | 覆盖编译、单测、Playwright UI 与 VSIX 打包校验 |

## 集成测试矩阵结果

| 测试维度 | 执行结果 |
| :--- | :--- |
| **TypeScript 编译 & ESLint** | 全部通过，0 错误 |
| **单元测试（`npm test`）** | 267 通过，3 项依赖真实 PlatformIO Core 的可选用例跳过，0 失败 |
| **Playwright UI 回归** | 15 项全通过（总览主区域归属、SDK 别名归组、700ms 自动保存、冲突检测、向导防抖） |
| **Extension Host 集成** | 基础、SDK、Python、依赖管理及真实 Webview Host 全部通过；9 类语言工程成功创建，8 类实机运行通过（C# 因未装 .NET SDK 跳过编译） |
| **高级运行与调试** | Node.js / TypeScript / Python 断点调试与所选解释器绑定、外部任务及 `Stop` 会话所有权隔离通过 |
| **VSIX 打包与隔离安装** | 成功打入 79 个运行时模块与界面资源，排除 `node_modules` 与缓存，隔离目录安装验证通过 |

## 已知限制与待验项

- **无硬件实机验收**：STM32 ST-LINK 真实烧录、Cortex-Debug 实机单步与 PlatformIO 真机连接上传目前仅完成参数与进程生命周期模拟测试。
- **未实测工具与平台**：CodeLLDB（Rust/C/C++ 调试）、Delve（Go 调试）、CMake 完整调试、.NET SDK 实机编译、系统钥匙串原生交互，以及 **Windows / Linux** 原生端到端测试均列为后续验证项。