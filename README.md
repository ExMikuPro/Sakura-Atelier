# Sakura Atelier

统一的项目运行、调试、运行配置与 SDK 管理扩展。

- 名称：**Sakura Atelier**
- 扩展 ID：**ExMikuPro.sakura-atelier**
- 版本：**0.1.0**（按项目要求，发布 Marketplace 前保持此版本）
- VS Code：**1.85.0+**；开发构建使用 Node.js 22+、npm。

沿用现有 `sakura-runner` 项目增量开发，不依赖 Sakura White Theme 或 Code Runner。

## 安装与工具栏

通过扩展视图 → 更多 → Install from VSIX 安装 `sakura-atelier-0.1.0.vsix`，然后 Reload Window。如果安装过 `sakura-runner-local.sakura-runner`，请禁用或卸载旧扩展，避免两份扩展同时提供按钮。新 ID 是独立扩展，不会自动替换旧 ID 的安装或迁移旧扩展的私有 WorkspaceState。

打开受支持的本地代码文件后，在**编辑器标签栏右上角、分屏和更多菜单旁**显示 Run、Debug、Select Configuration。Stop 仅在本扩展拥有运行或调试执行时显示。全部使用内置 Codicons 与官方 `editor/title` 菜单。采用 `navigation@1` 至 `@4`：VS Code 1.85 会将 `1_run` 分组放进更多菜单。其他扩展也可能提供自己的运行按钮。

不绑定 F5、不修改用户快捷键或 VS Code 内部文件。未信任工作区禁止运行、调试、发现工具链和安装。启动时只做工作区范围内的项目元数据发现，不执行项目命令。

## 命令

| 命令 ID | 用途 |
| --- | --- |
| `sakuraAtelier.run` | 用当前配置运行 |
| `sakuraAtelier.debug` | 用同一配置调试；缺少适配器明确报错 |
| `sakuraAtelier.selectConfiguration` | 原生 QuickPick 选择 Auto、文件、项目、测试、已有任务或 launch 配置 |
| `sakuraAtelier.editConfigurations` | 编辑配置 |
| `sakuraAtelier.addConfiguration` | 添加配置 |
| `sakuraAtelier.manageToolchains` | 工具链发现与选择 |
| `sakuraAtelier.sdkManager` | SDK 搜索、详情、安装入口与本地绑定 |
| `sakuraAtelier.pythonTerminal` | 创建使用所选 Python 环境的新终端 |
| `sakuraAtelier.runFile` / `runProject` | 保留原有直接运行模式 |
| `sakuraAtelier.stop` | 停止本扩展拥有的执行/调试 |

旧 `sakuraRunner.*` 命令和已有设置继续兼容。`sakuraRunner.defaultMode` 支持 auto/file/project；不会首次启动就写入 settings.json。

## 设置中心与配置模板

通过“选择运行配置 → 编辑配置…”打开同一个设置中心。左侧是可展开的设置树，右侧是详情；侧栏支持拖动、方向键调整宽度和窄窗口收起。没有顶部横向标签，也没有底部 Save/Apply/Cancel。

- **运行与调试配置**：统一列表、新增模板、复制、重命名、删除及默认配置。
- **开发环境**：总览、Go、Rust、Python、Node.js、独立 C / C++ 编译器、.NET、Java。
- **SDK 安装与更新**：已安装、可安装、更新；软件包列表与固定详情区域分开。

点击“添加配置…”后，按钮旁弹出紧凑模板选择器。所有语言始终可访问，当前文件与项目清单只影响推荐顺序。支持模糊搜索、最近使用、分组折叠、方向键、Enter、Esc 和点击外部关闭；焦点会返回入口。可在选择器中切换工作区 / 检测到的项目根目录。

首批 **25 个模板**直接绑定已有执行后端：

| 分组 | 模板 |
| --- | --- |
| Go | 应用程序、构建、测试 |
| Rust / Cargo | 运行、构建、测试、示例 |
| Python | 脚本、模块、Pytest |
| JavaScript / TypeScript / Node.js | Node.js 应用程序、JavaScript 文件、TypeScript 文件、npm / pnpm / yarn 脚本 |
| C / C++ / CMake | C 源文件、C++ 源文件、CMake 应用程序 |
| C# / .NET | 应用程序、构建、测试 |
| Java | 应用程序、Maven / Gradle 任务 |
| 通用 | 已有 VS Code 前台任务 |

Kotlin、Node Attach、Compound、独立 CMake Debug / Preset 模板暂未实现，不显示虚假入口。CMake 应用程序仍可通过已有执行器和对应调试扩展调试，但需要项目、构建目标及实际产物路径；不猜测二进制文件位置。

选择模板只生成草稿，不执行项目命令、不扫描 SDK 版本、不安装软件。新配置的有效字段随后按自动保存策略保存；未完成的模块名称、目标和 JSON 输入留在草稿中。跨语言模板不会把当前活动文件当作所有语言的入口。配置表单按模板展示字段，参数和环境变量使用逐行编辑器，编译参数、原生任务、调试覆盖及复杂 JSON 放在高级选项。

配置中的 SDK 下拉可直接选择项目默认、已发现 SDK、扫描本机、选择已有路径或进入安装页。缺少 SDK 不妨碍编辑，但不会标为已就绪；“尚未检查”只表示定位到可执行文件，仍由 Run 验证版本、目标与依赖。扫描是用户显式操作，安装另外确认。不修改系统默认 SDK 或全局环境。

## 自动保存、草稿与冲突

文本输入停止约 **700ms** 后保存，下拉 / 勾选立即排队，失焦与切换页面时尝试提交。每个工作区一个串行写入器，保存期间的新编辑被合并到下一笔，不替换新草稿或错误写入另一个配置。

状态包含已保存、等待保存、正在保存、输入无效、磁盘冲突与保存失败。无效输入旁显示错误，保留编辑内容；失败可重试。外部文件修订冲突会阻止后续写入，可查看差异、明确确认后重新加载，或保留草稿；没有静默覆盖入口。浏览器原生文本撤销仍可使用。

关闭页面前尽量提交有效的待保存配置。未完成草稿经 VS Code SecretStorage 本地加密保存，可在下次打开时恢复；不会把可能包含误输入凭据的草稿降级保存成明文。如果系统钥匙串不可用，会明确提示：有效配置仍正常自动保存，未完成草稿只能留在当前页面内存。原生测试应用的独立身份遇到此限制，不能据此宣称该环境的加密草稿恢复已实际通过。

删除配置、移除 SDK 记录及个人 / 项目保存位置迁移，均有原生确认。移除 SDK 记录只删除本机记录，不删除真实 SDK 文件。SDK 安装 / 更新仍有独立确认，不因自动保存而执行。

## 个人与项目配置

所有配置共用同一个列表、运行入口与调试入口，来源通过锁或团队 Codicon 和悬停文字区分：

- **个人配置（默认）**：保存到扩展的本地 WorkspaceState，按工作区文件夹隔离，不创建 `.vscode` 配置文件，不进入 Git，不配置同步上传。
- **项目配置**：保存到所属工作区文件夹的 `.vscode/sakura-atelier.json`，可提交 Git；编辑区域显示所属项目文件夹和路径，并可只读打开已有文件。要在另一工作区创建配置，在模板选择器或“当前工作区”中选择它。

旧 `.vscode/sakura-atelier.json` 格式继续读取；旧 `sakura-runner.json` 也保留兼容入口。现有项目配置不自动迁移。来源标记与个人配置不会塞入项目 JSON 或 launch.json。个人与项目 ID 冲突会明确报错。

迁移在原生确认后进行；保存前校验并检查磁盘修订，本地恢复记录确保跨存储写入被中断时仍保有配置数据。若中断后项目文件又被外部更改，会暂停恢复并提示人工检查，避免覆盖外部修改。launch.json 与 tasks.json 不被改写。

项目文件示例（通常通过表单创建，以下仅供高级编辑）：

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
      "env": { "API_TOKEN": "${secret:API_TOKEN}" },
      "terminal": true
    }
  ]
}
```

`templateId` 是可选的模板身份字段；没有它的旧配置仍使用兼容表单。其他字段使用原模型默认值。Windows 请通过选择器选择 `.venv/Scripts/python.exe`。

环境变量使用 `${env:名称}` 或 `${secret:名称}` 引用；密钥由原生密码框保存到 SecretStorage，不返回 Webview。共享文件中的工作区路径转为 `${workspaceFolder}`；外部 SDK / 路径保存在本机，通过 `${toolchain:...}` / `${localPath:...}` 引用。换机器后需重新绑定。支持的其他变量包括 `${projectDir}`、`${file}`、`${fileDirname}`、`${fileBasenameNoExtension}`、`${cacheDir}`。

SDK 优先级：**单个配置 > 工作区默认 > Sakura Atelier 全局默认 > 自动发现**。终端运行支持标准输入，Output 模式用于非交互执行。编译成功后才启动产物，临时产物使用缓存目录。

## 简体中文与 English

`sakuraAtelier.language`：`zh-cn`（默认）、`auto`（跟随 VS Code）、`en`。设置中心、模板、运行状态、错误解释、安装确认及命令菜单即时切换；用户自定义名称、源码内容、路径、语言 / 产品名称和工具原始输出不会被翻译改写。

贡献点使用官方 `package.nls*.json`；运行时与 Webview 共用参数化消息资源和可靠的英文回退。中英文菜单采用上下文条件切换的兼容命令入口，保留所有原命令与 `sakuraRunner.*` 别名，不修改 keybindings.json。VS Code 设置编辑器的静态描述受官方 NLS 机制控制，随 VS Code 显示语言，不能通过扩展自己的设置动态替换；其他扩展自身 UI 遵从上述语言选项。

## 语言与调试

统一 RuntimeAdapter 契约覆盖项目发现、工具链发现、目标与配置建议、校验、Run/Debug 计划及终端环境；所有语言共用按钮与配置页面。

| 语言/运行时 | 已实现入口 | 调试依赖/边界 |
| --- | --- | --- |
| Go | go.mod/go.work、run/build/test、package、构建参数、GOTOOLCHAIN、GOROOT | Go 扩展 + 已安装 Delve；不自动下载 Delve |
| Rust | Cargo/workspace、run/build/test、package/bin/example/features/profile/target、已安装 rustup toolchain | CodeLLDB；使用 Cargo 实际产物路径 |
| Python | 文件、module、项目入口、pytest、解释器/虚拟环境、参数与 cwd | Python Debugger；Run/Debug 使用同一解释器 |
| JavaScript / Node.js | 文件、package scripts、npm/pnpm/yarn、ESM/CommonJS、指定 Node 可执行文件 | 内置 JavaScript Debugger；脚本复杂启动使用已有 launch 配置 |
| TypeScript | 项目 scripts、本地 tsx/ts-node、tsc 构建后运行 | source maps；tsx/ts-node 路径依赖已安装项目工具，不使用 npx 自动下载 |
| C | 单/多源文件、GCC/Clang/MSVC 参数、C 标准、include/link/output、Make/CMake 入口 | CodeLLDB / C++ 调试扩展；Windows 依赖原生工具链环境 |
| C++ | 独立 C++ 编译器/标准、源文件与链接设置、Make/CMake target | 同上；复杂项目字段交给原生构建文件/tasks |
| C# | csproj/sln/slnx、dotnet run/build/test、framework/profile/launchSettings | 已有 launch 配置 + 官方 C# 调试支持；同安装内 SDK 版本由 global.json 控制 |
| Java（保留） | JDK 单文件、Maven/Gradle 项目已有运行任务 | 已有 launch 配置 + Java Debugger |

选择已有 launch 配置时保留原生字段；preLaunchTask 成功后才启动 Debug。缺少语言调试扩展不降级成 Run。Sakura Atelier 不实现 DAP，断点/单步/变量/调用栈由对应调试器提供。Stop 根据会话标记与父子关系识别本扩展会话，不停止用户另外启动的调试会话。

## Python 环境与终端

优先查询微软 Python Environments 与 Python 扩展的公开 API，显示解释器、版本、管理器与所属项目；无可用 API 时可发现工作区 `.venv`/`venv`、PATH 或手动路径。支持从官方发现结果选择 Conda、uv、pyenv、Poetry 等环境，但不声称已逐个验证。

显式选择解释器时尝试同步官方项目环境；失败会显示两者不一致，运行不会悄悄换成其他 Python。普通新终端由官方扩展管理；不接管已有终端。

`sakuraAtelier.python.autoActivateTerminal` 控制自己创建的新终端。兼容 `python-envs.terminal.autoActivationType`（command/shellStartup/off）与旧 `python.terminal.activateEnvironment`；不改写这些设置。可用时由官方 API 创建/激活终端，不重复激活。缺少官方集成时仅对具有真实激活脚本的 venv 做 shell 适配，不只设置 VIRTUAL_ENV；复杂 Conda 激活要求官方环境支持。支持 bash/zsh/fish/PowerShell/cmd 的参数处理，Windows shell 的危险路径会明确拒绝并提供替代入口。

## SDK Manager

左侧“SDK 安装与更新”包含已安装、可安装和更新三个子视图，可搜索、刷新、查看真实版本 / 来源 / 安装路径；本机自定义 SDK 记录在“开发环境”中定位和管理。

- macOS：检测 Homebrew，分别查询 formula/cask，结构化解析包信息。
- Ubuntu/Debian 及明确兼容发行版：先解析 os-release，再使用当前 APT 源查询候选版本/来源。不会添加源。
- Windows：WinGet 精确 Package ID、source 与 version；多个来源可分别选择。
- 缺包管理器：显示状态及官方安装说明，不自动安装。其他 Linux 发行版不调用 APT。

安装前重新验证真实包详情，原生确认窗口展示包、版本、来源和实际命令；用户确认后才在原生终端启动安装。APT 使用 sudo，由系统接收密码；不记录密码，不自动接受许可证或升级整个系统。Homebrew formula 使用 skip-link，禁止自动清理/依赖检查，不为切换项目 SDK 执行 link/alternatives 或修改全局 PATH。安装成功后重新发现工具链，是否切换由用户决定。

系统 SDK、rustup 等工具链管理器、TypeScript/tsx 等项目开发依赖分别展示。项目依赖不强制全局安装，Python venv 由 Python 环境入口创建。SDK Manager 不安装 rustup 的新渠道，不提供任意历史版本；可选版本来自当前管理器真实查询结果。

**本次仅实际验证 Homebrew 的只读搜索/详情/已安装状态；没有执行真实 SDK 安装。APT/WinGet 在当前 macOS 上仅做解析、命令和错误流程测试。**

## 开发、验证与限制

```sh
npm ci
npm run compile
npm test
npm run test:integration
npm run test:ui
npm run package
```

集成测试使用独立的临时工作区、用户与扩展目录，不修改现有项目设置。详细结果、复现命令、分阶段状态和手动验收见 随包附带的 TESTING.md。

已在 macOS ARM64 实际验证 JavaScript、TypeScript、Python、Rust、C、C++ 调试，以及 Python/Go/Rust/JS 原有运行。Go 实际 Delve、CMake 全流程、C# SDK/Debug、不同 Node 版本及 Linux/Windows 仍未验证。缺依赖不会标记为成功。完整调试配置生成、复杂 background task/compound 调试配置、多种版本管理器的全部版本枚举仍有边界；可复用原生 launch/tasks 或手动绑定 SDK。

VSIX 仅包含运行时代码、界面资源、schema 与文档，不包含开发 node_modules、测试缓存、临时编译产物或用户设置。不自动发布 Marketplace、不自动提交或推送 Git。

## 项目结构与后续扩展

```text
src/
  extension.ts                 命令与原有 Run 入口
  controller.ts                共用选择、执行与状态
  configuration.ts / configurationStore.ts
  templates.ts / templateCatalog.ts
  localization.ts / i18n.ts / ui.ts
  adapters.ts / projects.ts / toolchains.ts
  debugService.ts / launchConfigurations.ts
  pythonEnvironments.ts / activation.ts
  sdkManager.ts / packageManagers.ts
  executor.ts / capturedExecutor.ts / cargoBuild.ts
media/                         设置中心、模板选择器、自动保存状态机与插件图标
configuration.schema.json      项目配置校验
scripts/                       构建和隔离 Host 启动器
test/                          单元、集成与界面检查入口
```

后续 Test 扩展可在现有 operation=test 和 RuntimeAdapter 计划之上接 VS Code Testing API；调试继续复用语言扩展，并优先补齐 Go/.NET/CMake 的真实平台测试，再增加动态配置来源和复杂 launch compound 支持。不要增加独立的语言按钮或自行实现调试适配器。
