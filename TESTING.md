# Sakura Atelier 验证记录

验证环境：macOS ARM64；扩展版本 0.1.0；ID ExMikuPro.sakura-atelier。当前机器验证结果不能代表 Linux x86_64 或 Windows x64 通过。

## 可复现命令

开发 Node.js 22+，先执行 `npm ci`。

```sh
npm test
SAKURA_TEST_JAVA_BIN=/opt/homebrew/opt/openjdk@17/bin npm run test:integration
SAKURA_TEST_SUITE=advanced SAKURA_TEST_ADAPTERS=1 \
SAKURA_VSCODE_EXECUTABLE='/Applications/Visual Studio Code.app/Contents/MacOS/Code' \
npm run test:integration
npm run package
```

Java 路径只是本机测试时显式提供的 SDK，不是扩展的默认路径或安装假设。集成脚本支持 SAKURA_VSCODE_EXECUTABLE / SAKURA_VSCODE_VERSION 与 SAKURA_TEST_EXTENSION_PATH；默认测试最低支持的 VS Code 1.85.2。所有集成工作区、用户配置与调试扩展目录均隔离。

高级实际调试测试需要预先安装官方 Python、Python Debugger、Python Environments 与 CodeLLDB。SAKURA_TEST_ADAPTERS=1 仅把已存在的本机扩展复制到测试目录；不会为用户自动安装 SDK。新 Python Environments API 依赖较新版本 VS Code，因此官方环境激活端到端验证使用 VS Code 1.146.0；最低版本使用兼容回退。

## 自动化范围

- 单元测试：44 项，包含原有运行计划、支持语言、工具链缺失、路径/参数边界、工作区信任，以及新增配置校验/持久化/并发修改/多工作区、环境引用、SDK 本地绑定、Windows 环境变量大小写、shell 激活、包管理器结构化解析、精确 ID/来源/版本、安装取消/失败/成功后刷新、调试会话归属和 toolbar URI 参数回归。
- 基础 Extension Host 回归：16 项，涵盖 Python/.venv、Go、Rust、JS npm/Node、TS 本地 tsx、C/C++、Java、已有 Maven 任务、标准输入、终端复用、编译失败不运行旧产物、缺少 SDK、重复触发与卸载清理进程。
- 高级 Extension Host：21 项通过、4 项明确未验证。实际验证混合项目、多工作区、配置切换、参数/env/cwd、Output 执行、指定 Node 可执行文件、Go build/test、npm/pnpm、Cargo workspace/features/test、独立 C/C++ 编译器参数、真实断点与单步、launch/preLaunchTask、Stop 不停止外部会话、Python 环境切换/激活、Homebrew 只读查询。

机器可读报告位于本地 `.test-output/integration.json` 和 `.test-output/advanced-integration.json`，不打包进 VSIX。基础回归 16 项已在 VS Code 1.85.2 通过。最终包已在隔离的 1.85.2 配置中成功安装；高级 Host 同时验证解包后的运行时代码。原生页面的新增/复制/删除/保存/重载与工具链、Homebrew 查询做过手动检查；最后一次原生窗口定位遇到重复 Code bundle ID，未重复执行 SDK 安装确认交互。

## 实际运行与调试矩阵

| 场景 | 本机验证 | 限制 |
| --- | --- | --- |
| Python .venv Run / Debug / 新终端激活 | 实际验证 | 通过微软扩展；Conda/uv/pyenv/Poetry 未分别实测 |
| Go Run / build / test | 实际验证 | Delve 缺失；缺失依赖提示通过，真实 Debug 未验证 |
| Rust Run / Cargo test / CodeLLDB | 实际验证 | workspace package/bin/features 与实际产物调试通过；新渠道安装未实现 |
| JS / Node Run / Debug | 实际验证 | 自定义可执行路径通过；仅一个 Node 版本，不能声称不同版本通过 |
| TS tsx / source-map Debug | 实际验证 | yarn、ts-node、tsc 分支未做端到端实测 |
| npm / pnpm scripts | 实际验证 | yarn 未实测；复杂脚本 Debug 使用已有 launch |
| C / C++ Clang 编译与 CodeLLDB | 实际验证 | GCC/GDB/MSVC 未实测 |
| C++ CMake / Make | 计划和参数逻辑已实现 | CMake 未安装，全流程未验证；复杂项目依赖原生构建配置 |
| C# run / build / Debug | 仅模型、项目发现与参数契约 | .NET 未安装，真实执行与调试未验证 |
| Java JDK 单文件/已有 Maven task | 基础回归覆盖 | 完整 Maven/Gradle 构建、Java Debug 未实测 |
| Homebrew 搜索/详情/已安装状态 | 实际只读验证 | 没有执行真实安装或升级 |
| APT / WinGet | fixture 解析/安全命令测试 | 当前非对应平台，真实查询/安装未验证 |
| Linux x86_64 / Windows x64 | 未验证 | 不标记跨平台执行通过 |

## 六阶段状态

| 阶段 | 已完成与测试 | 尚未实现/已知限制 |
| --- | --- | --- |
| 1 统一模型/接口 | 共用配置、适配器契约、旧按钮与命令兼容；单元及 Host | 原生复杂 compound/task 特性仍委托 VS Code |
| 2 全语言基础 Run/工具链 | 全部要求语言纳入发现、SDK 绑定、配置字段和计划；多语言 Host | 工具链未安装的语言只有契约验证；未枚举所有版本管理器的历史版本 |
| 3 调试 | 官方 Debug API、已有 launch、依赖提示、会话归属；6 类实际调试 | Go/Java/C# 实际 Debug 未验证；不自动生成不确定的配置 |
| 4 配置编辑页 | 原生主题 Webview、CRUD、默认配置、持久化、schema | 本地机器 SDK 绑定不随项目分享；换机器需要重新绑定 |
| 5 环境与终端 | Python 官方 API 协作、单次激活、Node/Go/Rust/.NET 子进程环境 | 复杂 Conda 需官方扩展；没有修改普通终端/全局 Shell；同 .NET 安装版本由 global.json 管理 |
| 6 多项目/回归 | 隔离多根工作区、路径含空格、错误/清理/源映射测试 | Linux/Windows 原生 Host 及真实管理员安装未验证 |

## 手动验收

1. 在 VS Code 1.85+ 安装本次 VSIX，禁用旧 ID 的 Sakura Runner；Reload Window。打开受支持文件，确认编辑器右上角 Run、Debug、下拉按钮，悬停显示 Sakura Atelier。
2. 在受信任工作区下拉 → Edit Configurations，新增 Python 配置，选择 `.venv` 解释器、main.py、cwd；参数填写 JSON 数组，环境填写引用。设默认并 Apply。
3. 复制、重命名、删除副本；关闭并重载窗口，确认配置与当前选择恢复。第二工作区创建同名配置，确认不会串用。
4. 点击 Run，程序打印 sys.executable、参数与 cwd；设断点点 Debug，确认同一解释器、断点、变量与单步。另开用户调试会话，Sakura Stop 仅结束自己启动的会话。
5. 执行 Sakura Atelier Python Terminal，检查 python 指向所选环境；重复调用不重复激活。切换解释器后下一次 Run 使用新解释器。普通终端激活仍由官方扩展设置决定。
6. 用 C/C++ 配置选择编译器、标准、源文件与参数；制造编译错误，确认不会运行上次二进制。复杂 CMake/Make 使用原生项目文件/tasks。
7. 创建已有 launch.json（可带注释）及 preLaunchTask，通过选择器运行；故意让任务失败，确认不会启动 Debug，原文件不被覆盖。
8. SDK Manager → Available SDKs → Search。检查真实来源、版本、安装路径。点击 Install 查看原生确认中的完整命令，选择 Cancel，确认没有安装任务。真实安装需由用户审阅后另行明确确认；本次验证未执行。
9. Toolchains 定位现有 SDK，设置工作区/全局默认，再设置配置级 SDK，验证优先级；不要修改系统 PATH。
10. 禁用扩展/关闭测试 Host，确认自己启动的进程结束；不应影响用户另外启动的进程。

## 打包检查

`npm run package` 生成 `sakura-atelier-0.1.0.vsix`。清单只允许 package.json、运行时 out/src/*.js、schema、界面 JS/CSS/Codicon 字体及许可、公开文档。开发依赖、测试、缓存、用户配置和临时产物均排除。安装兼容性检查使用隔离的 VS Code 1.85.2 用户/扩展目录，不发布 Marketplace。

## 本轮 macOS 优先 CI

自动 CI 仅在 `macos-latest` 上运行编译、ESLint、全部单元测试、Extension Host 集成测试和 VSIX 打包；不自动发布。纯 Windows/Linux 路径与平台规则单元测试继续保留。主要验收平台为 Apple Silicon；macOS x86_64 需另行实测。

Windows 与 Linux 原生支持验证暂缓，现有跨平台实现保留。Windows Extension Host 已知存在 JDK source launcher、C 编译失败及进程卸载测试挂起的问题，尚未修复或验证通过。取消自动原生任务不代表这些问题已解决。WSL、SSH 与 Dev Containers 保留架构，尚未实机验收。
