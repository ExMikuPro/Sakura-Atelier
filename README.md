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

## Run / Debug Configurations

配置下拉菜单中提供 Edit Configurations、Add Configuration、Manage Toolchains、SDK Manager 和原生调试配置入口。

编辑页使用 VS Code Webview、主题颜色与官方 Codicons：左侧按语言分类，支持新增、复制、删除、重命名；右侧根据语言显示入口、SDK、工作目录、运行/编译参数、环境引用、构建前任务、终端模式以及语言专属字段。Save 保存并关闭，Apply 保存并保留页面，Cancel 放弃未保存修改。可指定项目默认配置。

配置文件为 `.vscode/sakura-atelier.json`，存在旧 `.vscode/sakura-runner.json` 时可读取。不会覆盖 launch.json 或 tasks.json。每个工作区文件夹独立存储；当前项目选择记录在 WorkspaceState。文件写入有校验、并发修订检查与边界检查。

最小示例（其他字段使用模型默认值）：

```json
{
  "version": 1,
  "default": "python-main",
  "configurations": [
    {
      "id": "python-main",
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

Windows 请通过选择器选择 `.venv/Scripts/python.exe`。支持 `${workspaceFolder}`、`${projectDir}`、`${file}`、`${fileDirname}`、`${fileBasenameNoExtension}`、`${cacheDir}`、`${env:NAME}` 与 `${secret:NAME}`。

环境变量值使用 env/secret 引用；密码在原生密码输入框录入 SecretStorage，不返回 Webview。参数使用 JSON 字符串数组，按参数边界传递。不要把凭据写进普通参数。项目内路径保存为可移植变量，机器上的外部 SDK/路径保存在本地状态，通过 `${toolchain:...}` / `${localPath:...}` 引用；换机器后需重新绑定。

SDK 优先级：**单个配置 > 工作区默认 > Sakura Atelier 全局默认 > 自动发现**。不改变系统默认 SDK 或全局环境。选择 SDK 不等于安装后自动切换。

`terminal: true` 使用可输入的原生任务终端；false 使用 OutputChannel（无交互 stdin）。编译步骤成功才运行产物，默认产物放缓存目录。复用终端并抑制重复触发，停用时清理拥有的执行。

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

Installed SDKs、Available SDKs、Updates、Custom SDKs 共用主题界面，可搜索、刷新、查看版本/来源/安装路径、定位现有 SDK、设工作区或全局默认。

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
  adapters.ts / projects.ts / toolchains.ts
  debugService.ts / launchConfigurations.ts
  pythonEnvironments.ts / activation.ts
  sdkManager.ts / packageManagers.ts
  executor.ts / capturedExecutor.ts / cargoBuild.ts
media/                         主题化配置与 SDK 页面
configuration.schema.json      项目配置校验
scripts/                       构建和隔离 Host 启动器
test/                          单元、集成与界面检查入口
```

后续 Test 扩展可在现有 operation=test 和 RuntimeAdapter 计划之上接 VS Code Testing API；调试继续复用语言扩展，并优先补齐 Go/.NET/CMake 的真实平台测试，再增加动态配置来源和复杂 launch compound 支持。不要增加独立的语言按钮或自行实现调试适配器。
