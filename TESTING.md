# Sakura Atelier 测试与验收

版本 **0.1.0**，扩展 ID **ExMikuPro.sakura-atelier**，最低 API 保持 VS Code **1.85.0**（实际最低版本测试 1.85.2）。本次在 macOS ARM64 验证，不能代表 Linux / Windows 已通过。

当前全量集成结果见 [macOS 集成验收报告](docs/MACOS_INTEGRATION_2026-11-14.md)。

## 命令

```sh
npm ci
npm test
npm run test:ui
node scripts/integration-p1.cjs p1-a
node scripts/integration-p1.cjs p1-b
node scripts/integration-p1.cjs p1-c
npm run test:wizard
SAKURA_TEST_JAVA_BIN=/opt/homebrew/opt/openjdk@17/bin npm run test:projects
SAKURA_TEST_JAVA_BIN=/opt/homebrew/opt/openjdk@17/bin npm run test:integration
SAKURA_TEST_SUITE=advanced SAKURA_TEST_ADAPTERS=1 \
SAKURA_VSCODE_EXECUTABLE='/Applications/Visual Studio Code.app/Contents/MacOS/Code' \
npm run test:integration
npm run package
```

Java 路径只是本机测试时显式提供的 SDK，不是扩展的默认目录。集成脚本使用隔离的多根工作区、用户与扩展目录。高级测试只复制本机已有的微软 Python / Debugger / Environments 与 CodeLLDB，不自动安装 SDK。新 Python 环境 API 的实际验证使用 VS Code 1.146.0；最低版本保留兼容回退。

## 本次结果

| 检查 | 结果 | 范围 |
| --- | --- | --- |
| TypeScript 编译 + ESLint | 通过 | 包括新 Registry、双存储、主机消息协议 |
| 单元测试 | 267 项通过，3 项可选 CLI 未执行 | 保留所有测试；本机无 PlatformIO Core |
| Firefox Webview 界面脚本测试 | 15 项通过 | 真实 HTML/CSS/JS；主机桥接采用测试适配器，存储使用实际 ConfigurationStore |
| 基础 Extension Host | 18 项通过 | VS Code 1.85.2，原 Run 回归完整保留 |
| 高级 Extension Host | 19 项通过，5 项未验证 | VS Code 1.146.0，多语言运行 / 调试 / 多工作区 |
| 配置页原生手动交互（#1 既有记录） | 保留原分支记录 | 新增功能以本次自动化结果和集成报告为准 |
| 语言项目创建 | 9 类创建通过，8 类实际执行 | C# 无 .NET SDK，仅文件和配置验证；TypeScript 使用仓库现有 tsx |
| 真实 Webview 自动化 | 通过 | 1.146.0：总览主区域、文件新建选择器、向导搜索/收藏/创建/恢复、深浅主题、窄窗口 |
| SDK 真实安装与管理员流程 | 未执行 | 确认 / 取消 / 失败 / 刷新契约用模拟测试；只读 Homebrew 查询实际通过 |

Browser 插件未提供，界面自动化按 frontend-testing-debugging 工作流使用现有 Firefox Playwright。浅色樱花、深色、高对比度使用 VS Code 主题变量的测试夹具；这些截图证明变量适配和布局，不等同于分别加载三个真实主题。小窗口 540 × 560 与桌面 1240 × 860 已检查，无相关页面脚本异常。

截图位于 `docs/images/`。`settings-*.png` 是原有界面夹具；`integration-*.png` 来自隔离的真实 Extension Host，不包含用户源码。新建项目入口是“文件 → 新建文件…”选择器或命令面板，不是原生文件菜单的一级项。

## 新增自动化覆盖

- 25 个模板 ID 唯一、所有已有语言均可访问；工厂返回独立且符合 Schema 的草稿，不执行命令或安装。
- 当前 Go 文件优先、多语言推荐、多根项目所有权；无项目时仍保留全模板目录；跨语言不复用 Go 文件。
- 缺少 SDK、未检查依赖、最近使用、中文模板标签 / 描述、参数消息 / 英文回退、语言设置默认值与贡献点资源完整性。
- 个人配置创建 / 重启 / 默认值且不创建项目文件；两种来源统一读取；迁移双向、删除隔离、旧格式兼容、ID 冲突、外部改动、写入中断恢复。
- 外部 SDK 路径本机绑定、秘密只存引用，不改写 tasks.json / launch.json。
- 防抖、快速输入 / 配置切换 / 工作区切换、异步串行 / 合并、失败重试、冲突冻结、无效草稿保留、关闭前提交。
- 主机真实消息处理器的确认门禁、未确认迁移 / 删除拒绝、同时写入修订冲突、无效模块关闭时不写盘。
- 浏览器中的搜索空状态、方向键 / Enter / Esc / 焦点返回、点击外部关闭、弹窗边界 / 滚动、侧栏调整 / 折叠、结构化参数 / 环境引用、迁移确认、SDK 详情固定分区。
- JSON 输入中间状态、改正后自动保存、重载恢复草稿、原生文本撤销、中英文切换不改用户名称；三个主题变量集截图。

## 原有执行 / 调试验证范围

| 场景 | 本机结果 | 限制 |
| --- | --- | --- |
| Python .venv Run / Debug / 新终端激活 | 实际通过 | Conda / uv / pyenv / Poetry 未逐个实测 |
| Go run / build / test | 实际通过 | Delve 不存在，真实 Go Debug 未验证；缺失提示通过 |
| Cargo run / test / workspace / features / CodeLLDB | 实际通过 | 新 rustup 渠道安装未实现 |
| JS / Node Run / Debug | 实际通过 | 仅一个真实 Node 版本；另一个自定义可执行路径是同版本复制品 |
| TS tsx / 源映射断点与单步 | 实际通过 | ts-node / tsc 分支未端到端实测 |
| npm / pnpm scripts | 实际通过 | yarn 未实测，模板不会自动安装依赖 |
| C / C++ Clang 编译及 CodeLLDB | 实际通过 | GCC / GDB / MSVC 未实测 |
| CMake 目标 / Make | 后端计划已有，未完成实际验证 | CMake 缺失；CMake Profile / Preset 的完整管理尚未实现，不提供假字段 |
| C# run / build / Debug | 只验证参数契约和项目发现 | 缺少 .NET SDK，真实执行 / 调试未验证 |
| Java 单文件 / 原生 Maven 运行任务 | 实际基础回归通过 | 完整 Maven / Gradle 构建与 Java Debug 未实测 |
| Homebrew 搜索 / 结构化详情 / 已安装状态 | 实际只读通过 | 未执行真实安装或升级 |
| APT / WinGet | fixture 解析与命令测试通过 | 非对应系统，真实查询 / 安装未验证 |
| Linux x86_64 / Windows x64 | 未验证 | 不宣称跨平台原生 Host 通过 |

## 真实 Host 的草稿加密限制

为避免误操作用户日常 Code 窗口，原生 UI 使用独立的本地测试应用身份。该身份的 VS Code 系统钥匙串不可用：有效个人配置自动保存、扫描 SDK 和窗口重载恢复已通过；未完成草稿的真实 SecretStorage 加密恢复无法在此身份验证。扩展对此明确提示，**不使用明文文件或 WorkspaceState 保存未验证的原始草稿**。浏览器重载恢复与主机协议测试使用本地模拟 SecretStorage，不能当作 OS 钥匙串通过。

若迁移写入中断后项目文件又被外部修改，恢复会暂停并保留本机记录，要求人工检查；不自动覆盖外部文件。文件系统与 VS Code 状态不是一个跨进程数据库事务，修订检查和恢复日志提供保留数据的保护，不声称解决所有外部编辑器同时写入的极小时间窗口。

## 手动验收步骤

1. 安装 VSIX，禁用旧 ID 的 Sakura Runner，重载窗口。受支持代码文件右上角保留运行 / 调试 / 选择配置，默认中文。通过设置将 `sakuraAtelier.language` 切换为 English 或跟随 VS Code，确认菜单、通知和已有 Webview 更新；VS Code 设置页静态描述由官方 NLS 随 VS Code 显示语言。
2. 编辑配置，点击左树“添加配置…”，检查当前项目推荐、全语言分组、搜索、最近使用、键盘与小窗口边界。创建 Go / Python / Cargo 配置，检查模板专属字段。
3. 新配置默认个人来源；等待“已保存”，确认项目没有新配置文件，重载后仍存在。输入未完成的高级 JSON，确认字段错误、有效磁盘数据不变；修正后自动保存。
4. 修改名称后立即切换配置、页面和工作区，确认输入没有串用。保存失败点击重试。手动修改项目 JSON，再编辑界面，检查冲突状态 / 差异 / 保留草稿，不应覆盖磁盘。
5. 选择项目保存位置，在原生迁移确认中检查目的地；先取消，再确认。核对共享 JSON 不含 UI 来源字段、私人 SDK 绝对路径和明文密钥。移回个人后其他配置保持不变。
6. 在配置内选择 SDK、扫描、定位已有文件。开发环境总览和语言子页应显示真实版本 / 路径 / 来源；选择不同 SDK 不修改系统 PATH。移除记录前确认，不删除真实 SDK 文件。
7. SDK 安装与更新页查询真实软件包，查看固定详情。点击安装只进入原生确认，先取消，确认没有任务启动；真实安装由用户另外明确确认，本次未执行。
8. 设断点并用原有语言适配器调试，检查 Stop 不影响用户另外启动的会话。故意让构建前任务失败，确认不启动调试；原 launch.json / tasks.json 不被改写。
9. 关闭页面前有效修改应尽量提交。若系统钥匙串正常，未完成草稿下次打开可恢复；若钥匙串失败，应看到明确说明，且不产生明文回退文件。

## 打包

`npm run package` 生成本地 `sakura-atelier-0.1.0.vsix`。包括运行时代码、schema、本地化资源、设置页面、官方 Codicons 和用户提供的 PNG 图标；排除开发依赖、测试、截图、测试应用、用户设置与缓存。检查包内 ID / 版本 / 最低 API 与全部 Webview 脚本。不会发布 Marketplace、创建 Release 或自动合并 PR。

## 本轮 macOS 优先 CI

自动 CI 仅在 `macos-latest` 上运行编译、ESLint、全部单元测试、Extension Host 集成测试和 VSIX 打包；不自动发布。纯 Windows/Linux 路径与平台规则单元测试继续保留。主要验收平台为 Apple Silicon；macOS x86_64 需另行实测。

Windows 与 Linux 原生支持验证暂缓，现有跨平台实现保留。Windows Extension Host 已知存在 JDK source launcher、C 编译失败及进程卸载测试挂起的问题，尚未修复或验证通过。取消自动原生任务不代表这些问题已解决。WSL、SSH 与 Dev Containers 保留架构，尚未实机验收。

