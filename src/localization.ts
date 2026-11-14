/** Shared parameterized messages for the extension host and Webview. English keys are the fallback. */
export type UiLanguage = "zh-cn" | "en";
export const chinese: Record<string, string> = {
  "Project Dependencies...": "项目依赖检查与修复…",
  "No dependency declarations found in this project.": "当前项目未发现依赖声明。",
  "Dependency inspection": "项目依赖检查",
  "Inspect only; do not run a repair": "仅查看诊断，不执行修复",
  "Select a repair plan to review its native confirmation.": "选择修复计划后，仍需在原生确认框中核对命令。",
  "Dependency operation: {0}": "依赖操作结果：{0}",
  "Target host: {0} · {1}/{2}": "目标环境：{0} · {1}/{2}",
  "Installation scope: {0}": "安装范围：{0}",
  "Current container only": "当前容器内部，不修改容器宿主",
  "Current target host": "当前目标宿主",
  "Privileges: {0}": "权限：{0}",
  "Confirmed by the system in the terminal": "由终端中的系统权限机制确认",
  "New Embedded Project...": "新建嵌入式项目…",
  "Run / Debug Configurations": "运行 / 调试配置",
  "Sakura Atelier · one configuration for running, debugging and testing":
    "Sakura Atelier · 统一运行、调试与测试配置",
  Configurations: "运行配置",
  "Configuration Templates": "配置模板",
  "Add New Configuration": "添加运行配置",
  "Search templates...": "搜索模板…",
  "Recommended for Current Project": "为当前项目推荐",
  "All Templates": "所有模板",
  "Recently Used": "最近使用",
  "No matching templates": "没有匹配的模板",
  "Try another name, language or description.": "试试其他名称、语言或描述。",
  "Choose a project": "选择项目",
  "Close template picker": "关闭模板选择器",
  "Template selection": "模板选择",
  Template: "模板",
  "Go Application": "Go 应用程序",
  "Go Build": "Go 构建",
  "Go Test": "Go 测试",
  "Cargo Run": "Cargo 运行",
  "Cargo Build": "Cargo 构建",
  "Cargo Test": "Cargo 测试",
  "Cargo Example": "Cargo 示例",
  "Python Script": "Python 脚本",
  "Python Module": "Python 模块",
  Pytest: "Pytest 测试",
  "Node.js Application": "Node.js 应用程序",
  "JavaScript File": "JavaScript 文件",
  "TypeScript File": "TypeScript 文件",
  "npm Script": "npm 脚本",
  "pnpm Script": "pnpm 脚本",
  "yarn Script": "yarn 脚本",
  "C File": "C 源文件",
  "C++ File": "C++ 源文件",
  "CMake Application": "CMake 应用程序",
  ".NET Application": ".NET 应用程序",
  ".NET Build": ".NET 构建",
  ".NET Test": ".NET 测试",
  "Java Application": "Java 应用程序",
  "Maven / Gradle Task": "Maven / Gradle 任务",
  "Existing VS Code Task": "已有 VS Code 任务",
  General: "通用",
  "Go / Golang": "Go / Golang",
  "Rust / Cargo": "Rust / Cargo",
  "JavaScript / TypeScript / Node.js": "JavaScript / TypeScript / Node.js",
  "C / C++ / CMake": "C / C++ / CMake",
  "C# / .NET": "C# / .NET",
  "Run a package or a Go entry file.": "运行 Go 包或入口文件。",
  "Build a package without running it.": "构建 Go 包，不执行程序。",
  "Run tests in the selected package tree.": "运行所选包及其子包的测试。",
  "Run a Cargo package or binary.": "运行 Cargo 包或二进制目标。",
  "Compile a Cargo package.": "编译 Cargo 包。",
  "Run the Cargo test suite.": "运行 Cargo 测试套件。",
  "Run a named Cargo example.": "运行指定的 Cargo 示例。",
  "Run a Python file with its selected interpreter.":
    "使用所选解释器运行 Python 文件。",
  "Run python -m with a module name.": "通过 python -m 运行模块。",
  "Use the selected interpreter to run pytest.": "使用所选解释器执行 pytest。",
  "Run a Node.js entry point.": "运行 Node.js 入口文件。",
  "Run a JavaScript file using Node.js.": "使用 Node.js 运行 JavaScript 文件。",
  "Run with project tsx, ts-node or a tsc build.":
    "使用项目中的 tsx、ts-node 或 tsc 编译运行。",
  "Run an existing package.json script with {0}.":
    "使用 {0} 运行已有的 package.json 脚本。",
  "Compile and run C source files.": "编译并运行 C 源文件。",
  "Compile and run C++ source files.": "编译并运行 C++ 源文件。",
  "Configure, build and run an existing CMake target.":
    "配置、构建并运行已有 CMake 目标。",
  "Run a startup .csproj.": "运行启动项目 .csproj。",
  "Build a project or solution.": "构建 .NET 项目或解决方案。",
  "Test a .NET project or solution.": "测试 .NET 项目或解决方案。",
  "Run a JDK source file; link launch.json for debugging.":
    "运行 JDK 源文件；调试请关联 launch.json 配置。",
  "Delegate to an existing foreground VS Code task.":
    "使用已有的 VS Code 前台任务。",
  "Reuse a foreground task without rewriting tasks.json.":
    "复用前台任务，不改写 tasks.json。",
  Ready: "已就绪",
  Recommended: "推荐",
  "Not checked": "尚未检查",
  "Needs configuration": "需要配置",
  "Not Installed": "尚未安装",
  "Toolchain not configured": "尚未配置工具链",
  "Install SDK": "安装 SDK",
  "Select Existing Toolchain": "选择已有工具链",
  Run: "运行",
  Debug: "调试",
  "Run / Debug": "运行 / 调试",
  Test: "测试",
  Build: "构建",
  "Auto Detect": "自动检测",
  "Run Current File": "运行当前文件",
  "Run Project": "运行项目",
  "Test Project": "测试项目",
  "Use the original project-first runner": "自动识别项目，优先运行项目",
  "Original single-file runner": "使用原有单文件运行器",
  "Original project runner": "使用原有项目运行器",
  "Native language test command": "使用语言原生测试命令",
  "Existing launch.json configuration": "已有的 launch.json 调试配置",
  "Task · Run": "任务 · 运行",
  "Edit Configurations...": "编辑配置…",
  "Add Configuration...": "添加配置…",
  "Manage Toolchains...": "工具链管理…",
  "SDK Manager...": "SDK 管理器…",
  "Configure Run/Debug...": "配置运行 / 调试…",
  "Sakura Atelier — Run / Debug Configurations":
    "Sakura Atelier — 运行 / 调试配置",
  "Select Run / Debug Configuration": "选择运行 / 调试配置",
  "Configuration needs attention": "运行配置需要检查",
  "Missing configuration": "配置不存在",
  "Open launch.json / Add Debug Configuration":
    "打开 launch.json / 添加调试配置",
  "Open Tasks Configuration": "打开任务配置",
  "Configure Run/Debug": "配置运行 / 调试",
  "Select compatible Debug configuration": "选择兼容的调试配置",
  "Select Cargo executable": "选择 Cargo 可执行目标",
  Workspace: "工作区文件夹",
  Project: "项目",
  Add: "添加配置",
  Copy: "复制",
  Delete: "删除",
  Locate: "定位 SDK",
  "Custom SDK": "自定义 SDK",
  Remove: "移除",
  Toolchains: "工具链管理",
  "SDK Manager": "SDK 管理器",
  "Loading…": "正在加载…",
  Cancel: "取消",
  Apply: "应用",
  Save: "保存",
  "Browse...": "浏览…",
  "Unsaved changes": "存在尚未保存的修改",
  " (copy)": "（副本）",
  "Apply or Cancel your changes before switching workspaces.":
    "切换工作区前，请先应用或取消当前修改。",
  "Apply changes before switching project context.":
    "切换项目之前请先应用修改。",
  "Installed SDKs": "已安装的 SDK",
  "Available SDKs": "可安装的 SDK",
  Updates: "可用更新",
  "Custom SDKs": "自定义 SDK",
  "TypeScript / tsx are normally project dependencies. Virtual environments are not system SDK packages.":
    "TypeScript / tsx 通常属于项目依赖；虚拟环境不是系统 SDK 安装包。",
  "Choose how your project runs": "选择项目的运行方式",
  "Add a configuration to choose its entry, SDK, arguments and debug configuration. Existing launch.json and tasks.json remain unchanged.":
    "从模板添加运行配置，选择入口、SDK、参数及调试配置；不会改写已有的 launch.json 和 tasks.json。",
  "Detected project": "检测到的项目",
  "Configuration name": "配置名称",
  "Language / Runtime": "语言 / 运行时",
  "Configuration type": "配置类型",
  Action: "操作",
  "Entry point": "入口文件",
  "Package / entry file": "包 / 入口文件",
  Package: "包",
  "Package pattern": "包匹配模式",
  Module: "模块",
  "Module name": "模块名称",
  "Script path": "脚本路径",
  "Test file / directory": "测试文件 / 目录",
  "JavaScript file": "JavaScript 文件",
  "TypeScript file": "TypeScript 文件",
  "Package directory": "package.json 所在目录",
  "C source file": "C 源文件",
  "C++ source file": "C++ 源文件",
  "Build directory": "构建目录",
  "Startup project (.csproj)": "启动项目（.csproj）",
  "Project / solution": "项目 / 解决方案",
  "Test project / solution": "测试项目 / 解决方案",
  "Java source file": "Java 源文件",
  "Task label": "任务标签",
  "launch.json configuration name": "launch.json 配置名称",
  "tasks.json task label": "tasks.json 任务标签",
  "CMake build directory / Make project": "CMake 构建目录 / Make 项目",
  "Target file / package / project": "目标文件 / 包 / 项目",
  "This configuration delegates to the existing native task/launch entry. Its SDK, working directory, parameters and environment remain in tasks.json / launch.json; they are not overwritten.":
    "此配置使用已有的原生任务或调试配置。SDK、工作目录、参数和环境由 tasks.json / launch.json 管理，不会被覆盖。",
  "Additional pre-launch task label": "额外的运行前任务",
  "Corresponding launch.json Debug Configuration":
    "对应的 launch.json 调试配置",
  "Choose a Debug configuration": "选择调试配置",
  "Configure launch.json...": "配置 launch.json…",
  "Project default configuration": "设为默认运行配置",
  "Working directory": "工作目录",
  "Interpreter / Virtual Environment": "解释器 / 虚拟环境",
  "Cargo executable": "Cargo 可执行文件",
  "Go executable / SDK": "Go 可执行文件 / SDK",
  ".NET SDK executable": ".NET SDK 可执行文件",
  "Compiler executable": "编译器可执行文件",
  "Node Runtime": "Node.js 运行时",
  "JDK executable": "JDK 可执行文件",
  "Empty inherits workspace → Sakura Atelier global default → automatic discovery. Project paths support ${workspaceFolder}; external SDK paths are saved locally.":
    "留空时依次使用工作区默认值、Sakura Atelier 全局默认值和自动检测结果。项目路径支持 ${workspaceFolder}；外部 SDK 路径仅保存在本机。",
  "Choose discovered SDK": "选择已发现的 SDK",
  "Choose a discovered SDK...": "选择已发现的 SDK…",
  "Discover Python Environments": "发现 Python 环境",
  "Discover SDKs": "发现 SDK",
  "Discovering installed toolchains...": "正在发现已安装的工具链…",
  "Activate environment in new Sakura Atelier terminals":
    "在新的 Sakura Atelier 终端中自动激活环境",
  "Open Python Terminal": "打开 Python 环境终端",
  "Apply this configuration before opening its terminal.":
    "打开对应终端前，请先应用此配置。",
  "Language options": "语言选项",
  "Build profile": "构建模式",
  "C standard (e.g. c11)": "C 标准（例如 c11）",
  "C++ standard (e.g. c++20)": "C++ 标准（例如 c++20）",
  "Source files (JSON array)": "源文件列表（高级 JSON 数组）",
  "Include paths (JSON array)": "头文件路径（高级 JSON 数组）",
  "Library paths (JSON array)": "库路径（高级 JSON 数组）",
  "Linker arguments (JSON array)": "链接参数（高级 JSON 数组）",
  "For CMake/Make projects, sources, include paths and libraries remain in the existing build files. CMake compiler changes require a separate build directory; Make controls its own build profile.":
    "CMake/Make 项目的源文件、头文件和库由原生构建文件管理。切换 CMake 编译器需要独立的构建目录；Make 的构建模式由 Makefile 管理。",
  "CMake / Make target": "CMake / Make 目标",
  "Defaults to local; no global Go environment is changed.":
    "默认使用 local，不修改全局 Go 环境。",
  "Build output": "构建输出",
  "Installed rustup toolchain (stable / beta / nightly / custom)":
    "已安装的 rustup 工具链（stable / beta / nightly / 自定义）",
  "Cargo profile": "Cargo 构建模式",
  "Cargo package": "Cargo 包",
  "Cargo binary": "Cargo 二进制目标",
  "Cargo example": "Cargo 示例",
  "Features (JSON array)": "Feature 列表",
  "Cargo target triple": "Cargo 目标平台",
  "Package manager": "包管理器",
  "package.json script (optional)": "package.json 脚本（可选）",
  "TypeScript execution": "TypeScript 执行方式",
  "Compiled JavaScript entry (tsc)": "编译后的 JavaScript 入口（tsc）",
  ".NET configuration": ".NET 构建模式",
  "Target framework": "目标框架",
  "launchSettings.json profile": "launchSettings.json 启动配置",
  "For dotnet run select a startup .csproj; .sln/.slnx are valid build/test targets. SDK version policy within one dotnet installation follows the project global.json.":
    "dotnet run 请选择启动项目 .csproj；构建和测试也可使用 .sln/.slnx。同一 .NET 安装中的 SDK 版本由项目 global.json 决定。",
  "Classpath entries (JSON array)": "Classpath 条目（高级 JSON 数组）",
  "Module path entries (JSON array)": "模块路径（高级 JSON 数组）",
  "Executable output (optional for single files)":
    "可执行文件输出路径（单文件可选）",
  "Empty single-file outputs use an extension-owned temporary directory. CMake/Make requires the actual output path.":
    "单文件留空时使用扩展的临时目录；CMake/Make 需要填写实际产物路径。",
  "Build / compiler arguments (JSON array)": "编译参数",
  "Program / test arguments (JSON array)": "程序 / 测试参数",
  "Environment and launch": "运行环境与启动",
  "Environment references (JSON object)": "环境变量引用",
  'Use {"API_TOKEN":"${secret:API_TOKEN}"} or {"MODE":"${env:MODE}"}. Plaintext environment values are rejected.':
    "使用 ${secret:名称} 或 ${env:名称} 引用；不保存明文环境变量值。",
  "Store Secret...": "保存密钥引用…",
  "Pre-launch build task label": "运行前执行的构建任务",
  "Existing launch.json Debug Configuration": "已有的 launch.json 调试配置",
  "Automatic compatible debugger": "自动选择兼容的调试器",
  "Debug adapter override (optional)": "指定调试适配器（可选）",
  "Go / debugpy / lldb / cppdbg / cppvsdbg / pwa-node, when installed.":
    "可填写已安装的 go / debugpy / lldb / cppdbg / cppvsdbg / pwa-node。",
  "Run in an interactive terminal / use a debug terminal":
    "在交互式终端中运行 / 使用调试终端",
  "Discover existing SDKs or locate an executable. Machine-specific SDK paths stay in local VS Code state; project files refer to an SDK ID. No global PATH or shell initialization files are changed.":
    "发现已有 SDK 或手动定位可执行文件。本机路径保存在 VS Code 本地状态，项目文件只引用 SDK 标识，不修改全局 PATH 和 Shell 初始化文件。",
  Discover: "发现工具链",
  "Discovering...": "正在发现工具链…",
  "No SDK selected. Discover installed SDKs or click Locate to add a custom executable.":
    "尚未选择 SDK。请发现已安装的 SDK，或点击“定位 SDK”添加可执行文件。",
  "SDK name": "SDK 名称",
  Language: "语言",
  "Executable path": "可执行文件路径",
  "Installed version": "已安装版本",
  "Environment / version manager": "环境 / 版本管理器",
  "SDK details (GOROOT / installed SDKs / rustup toolchains)":
    "SDK 详情（GOROOT / 已安装 SDK / rustup 工具链）",
  "Set Workspace Default": "设为工作区默认 SDK",
  "Set Atelier Global Default": "设为 Atelier 全局默认 SDK",
  "Locate Existing SDK": "定位已有 SDK",
  "Create Virtual Environment...": "创建虚拟环境…",
  "Querying package manager...": "正在查询包管理器…",
  "System SDKs are installed only after a native confirmation showing the exact version, source and command. Project dependencies such as TypeScript/tsx should normally be installed through the project package manager.":
    "系统 SDK 仅在原生对话框中确认版本、来源与命令后才会安装。TypeScript/tsx 等项目依赖应通过项目包管理器安装。",
  "Search Go, Rust, Python, Node, Clang, .NET...":
    "搜索 Go、Rust、Python、Node.js、Clang、.NET…",
  Search: "搜索",
  Refresh: "刷新",
  "Package Manager Instructions": "包管理器安装说明",
  "Refresh Toolchains": "刷新工具链",
  "Refreshing SDKs...": "正在刷新 SDK…",
  "SDK / Package": "SDK / 软件包",
  Version: "版本",
  Installed: "已安装",
  Source: "来源",
  Kind: "类型",
  "Query details": "查看详情",
  "Querying exact package details...": "正在查询软件包详情…",
  "Search a package or choose Installed SDKs / Updates. Empty results and missing package managers are reported without installing anything.":
    "搜索软件包或查看已安装 SDK、可用更新。没有结果或缺少包管理器时会明确提示，不会自动安装。",
  Unclassified: "未分类",
  "Locate the executable in Toolchains": "请在工具链管理中定位可执行文件",
  "not installed": "尚未安装",
  "SDK version": "SDK 版本",
  Install: "安装",
  "Installation may prompt for administrator permission or licenses in the terminal. Sakura Atelier does not read passwords or accept licenses for you.":
    "安装可能在终端中请求管理员权限或确认许可。Sakura Atelier 不读取密码，也不代为接受许可协议。",
  "Saving...": "正在保存…",
  "Installed toolchains refreshed. Unsaved configuration edits were preserved.":
    "已刷新工具链，尚未保存的配置修改已保留。",
  "Applied. Selected configuration is ready for Run / Debug.":
    "已应用配置；运行或调试时将检查目标和依赖。",
  "Verified package details. Install requires a separate native confirmation.":
    "已核对软件包详情；安装仍需单独在原生对话框中确认。",
  "Save location": "保存位置",
  "Personal configuration (this machine only)": "个人配置（仅本机）",
  "Project configuration (shareable)": "项目配置（可共享）",
  "Store as project file": "将配置保存到项目文件",
  "Stored only on this machine": "仅保存在本机",
  "Stored in .vscode/sakura-atelier.json": "保存在 .vscode/sakura-atelier.json",
  "Project folder": "项目文件夹",
  "Save path": "保存路径",
  "Open configuration file": "打开配置文件",
  "Advanced options": "高级选项",
  "Edit as JSON": "以 JSON 编辑",
  "One argument per row; spaces stay inside the argument.":
    "每行一个参数；参数中的空格会原样保留。",
  "Environment variable": "环境变量名称",
  Reference: "环境 / 密钥引用",
  "Add row": "添加一行",
  Value: "值",
  "Use the project selector to create a configuration in another workspace folder.":
    "使用项目选择器，可在其他工作区文件夹中创建配置。",
  "Template draft created. Save or Apply to retain it.":
    "已创建配置草稿，点击“保存”或“应用”后才会持久化。",
  "Selected SDK was not found. Choose another toolchain.":
    "所选 SDK 不存在，请重新选择工具链。",
  "Existing task selected; its own toolchain applies.":
    "已选择已有任务，使用该任务自身的工具链配置。",
  "Create or select an existing foreground VS Code task.":
    "请创建或选择已有的 VS Code 前台任务。",
  "Toolchain has not been checked.": "尚未检查工具链。",
  "Executable located; Run validates its version and dependencies.":
    "已定位可执行文件；运行时会检查版本和依赖。",
  "Configured SDK. Run validates the target and installed dependencies.":
    "已配置 SDK；运行时会检查入口和依赖。",
  "{0} not configured or not found on PATH.":
    "尚未配置 {0}，或 PATH 中未找到对应程序。",
  "CMake is not installed or not on PATH.":
    "尚未安装 CMake，或 PATH 中未找到 CMake。",
  "Select a project script or install a project tsx / ts-node / TypeScript dependency.":
    "请选择项目脚本，或在项目中安装 tsx / ts-node / TypeScript 依赖。",
  "{0} CLI not found. Select an existing VS Code task for Windows batch wrappers.":
    "未找到 {0} 命令行程序；Windows 批处理入口请使用已有 VS Code 任务。",
  "Python is available; pytest must be installed in the chosen environment.":
    "Python 可用；所选环境中还需安装 pytest。",
  "Workspace trust is required to check or run toolchains.":
    "检查或运行工具链需要先信任工作区。",
  "Choose the entry, script or output in the configuration form.":
    "请在表单中选择入口、脚本或产物路径。",
  "SDK state is based on cached discovery and executable lookup, not a test run.":
    "SDK 状态来自已缓存的发现结果及路径检查，不代表实际执行验证。",
  file: "文件",
  project: "项目",
  module: "模块",
  executable: "可执行文件",
  task: "任务",
  launch: "原生调试配置",
  run: "运行",
  build: "构建",
  test: "测试",
  debug: "调试模式",
  release: "发布模式",
  command: "命令激活",
  shellStartup: "Shell 启动时激活",
  off: "关闭",
  unavailable: "不可用",
  "Choose a task": "选择任务",
  "Choose a script": "选择脚本",
  None: "无",
  "Go SDK": "Go SDK",
  "Cargo / Rust toolchain": "Cargo / Rust 工具链",
  "Python interpreter": "Python 解释器",
  "Node.js runtime": "Node.js 运行时",
  "Node.js + project TypeScript runner": "Node.js 与项目 TypeScript 运行工具",
  "Python interpreter + pytest": "Python 解释器与 pytest",
  "C compiler": "C 编译器",
  "C++ compiler": "C++ 编译器",
  "CMake + C++ compiler": "CMake 与 C++ 编译器",
  "Existing VS Code task": "已有 VS Code 任务",
  "Official terminal activation: {0}; legacy activateEnvironment: {1}":
    "官方终端激活方式：{0}；旧版自动激活：{1}",
  "{0} installed SDK(s) found. Apply to retain this local SDK list.":
    "发现 {0} 个已安装 SDK，工具链记录将自动保存。",
  "{0} package(s) returned by the package manager.":
    "包管理器返回 {0} 个软件包。",
  "Invalid JSON field: {0}": "JSON 输入尚未完成或格式错误：{0}",
  "Run stopped.": "运行已停止。",
  "Sakura Atelier: {0}": "Sakura Atelier：{0}",
  "Configuration: {0}": "配置错误：{0}",
  "Missing toolchain: {0}. Install it yourself or configure its executable in Sakura Atelier settings.":
    "缺少工具链：{0}。请安装对应工具，或在 Sakura Atelier 中选择可执行文件。",
  "No {0} debug adapter is installed/enabled. Install {1} from Extensions, then create or select a compatible launch configuration.":
    "尚未安装或启用 {0} 调试适配器。请在扩展视图中安装 {1}，然后创建或选择兼容的调试配置。",
  'Debug adapter "{0}" is missing. Install or enable the corresponding extension.':
    "缺少调试适配器“{0}”，请安装或启用对应扩展。",
  'No package.json script named "{0}".': "package.json 中没有名为“{0}”的脚本。",
  "{0} is missing or is a Windows batch wrapper. Configure a native JS CLI path or an existing VS Code task.":
    "未找到 {0}，或其入口是 Windows 批处理文件。请选择 JavaScript 命令行入口或已有 VS Code 任务。",
  "{0} CLI entry was not found. Use an existing package-manager task.":
    "未找到 {0} 的命令行入口，请使用已有包管理器任务。",
  "Rust toolchain {0} is not installed. Use SDK Manager; no toolchain was installed automatically.":
    "尚未安装 Rust 工具链 {0}。请使用 SDK 管理器，本扩展不会自动安装工具链。",
  "Install {0} as a project development dependency, or select an existing script/task. It is never installed automatically.":
    "请将 {0} 安装为项目开发依赖，或选择已有脚本 / 任务。本扩展不会自动安装依赖。",
  "tsc requires an explicit compiled JavaScript entry (Output executable/file), with sourceMap enabled in tsconfig.json.":
    "tsc 模式需要填写编译后的 JavaScript 入口，并在 tsconfig.json 中启用 sourceMap。",
  "JSX requires a configured project script or build task.":
    "运行 JSX 需要配置项目脚本或构建任务。",
  "For CMake/Make projects, configure sources/includes/libraries in the existing build files or a VS Code task. These fields apply to direct compiler configurations.":
    "CMake/Make 项目的源文件、头文件和库需要在原生构建文件或 VS Code 任务中配置；这些字段只适用于直接编译。",
  "Choose a separate CMake build directory in Target. In-source build files will not be created automatically.":
    "请为 CMake 选择独立的构建目录，本扩展不会在源码目录中创建构建文件。",
  "This CMake build directory is cached for another compiler. Choose a separate build directory; no user cache was deleted.":
    "此 CMake 构建目录已缓存其他编译器，请使用独立构建目录；没有删除用户缓存。",
  "Select a numeric C/C++ standard such as c11 or c++20.":
    "请选择有效的 C/C++ 标准，例如 c11 或 c++20。",
  "Set the language standard in the Makefile or its native build task. Direct compiler configurations support the Standard field.":
    "请在 Makefile 或原生构建任务中设置语言标准；直接编译配置可以使用“标准”字段。",
  "Set the actual executable output for this build target, or choose an existing launch configuration.":
    "请填写构建目标的实际可执行文件路径，或选择已有调试配置。",
  "Build/Test configurations require a dedicated debug launch configuration. Choose a runnable target.":
    "构建 / 测试配置需要专用调试配置，请选择可运行目标。",
  "Delve is missing. Use Go: Install/Update Tools to install dlv, or configure go.alternateTools.dlv. No debugger was installed automatically.":
    "缺少 Delve。请通过 Go 扩展的安装 / 更新工具命令安装 dlv，或设置 go.alternateTools.dlv。本扩展不会自动安装调试器。",
  "Debug a package script through an existing JavaScript launch configuration, so its actual entry and child-process behavior stay under user control.":
    "请通过已有 JavaScript 调试配置调试包脚本，明确指定实际入口和子进程行为。",
  "tsx source-map debugging requires Node 18.19+, 20.6+, or a later LTS. Select a supported Node runtime or use tsc plus source maps.":
    "tsx 源映射调试需要 Node 18.19+、20.6+ 或更新的 LTS；请选择受支持的运行时，或使用 tsc 与源映射。",
  "A local {0} installation is required for TypeScript debugging.":
    "TypeScript 调试需要项目中已安装的 {0}。",
  "{0} debugging needs an existing launch.json configuration to identify the built assembly/main class. Set Debug Configuration in this run configuration.":
    "{0} 调试需要已有的 launch.json 配置来确定程序集或主类，请为此运行配置选择对应调试配置。",
  "Configuration language does not match its adapter.":
    "配置语言与执行适配器不匹配。",
  "Python build actions require an explicit build task.":
    "Python 构建需要明确指定构建任务。",
  "Choose a Cargo binary or example, not both.":
    "Cargo 二进制目标与示例只能选择其中一个。",
  "Module entry is supported for Python/Java; select a file or project for this language.":
    "模块入口仅适用于 Python / Java；请为当前语言选择文件或项目。",
  "Choose a startup .csproj for dotnet run. Solutions are supported as build/test targets.":
    "dotnet run 需要选择启动项目 .csproj；解决方案可用于构建和测试。",
  "{0} managed configurations require a project or executable. Run Current File remains available through the original runner.":
    "{0} 托管配置需要项目或可执行文件；也可使用原有的“运行当前文件”。",
  "Unable to launch {0}: {1}": "无法启动 {0}：{1}",
  "{0} failed (exit {1}). See Sakura Atelier Output.":
    "{0} 执行失败（退出码 {1}），请查看 Sakura Atelier 输出。",
  "Unresolved variable: ${{0}}. Configure it before running.":
    "无法解析变量：${{0}}。请在运行前完成配置。",
  ".vscode points outside the workspace.":
    ".vscode 指向工作区之外，已拒绝访问。",
  "Configuration points outside the workspace.":
    "配置文件指向工作区之外，已拒绝访问。",
  "Invalid toolchain list.": "工具链列表无效。",
  "Invalid toolchain entry.": "工具链条目无效。",
  "A configuration migration was interrupted and the project file changed. The original personal data is retained locally; restore or review the project file before retrying.":
    "配置迁移曾被中断，且项目文件已被修改。原个人数据仍保存在本机，请先检查或恢复项目文件再重试。",
  "Configuration ID conflict between personal and project storage: {0}. Rename the project ID before continuing.":
    "个人与项目配置的 ID 冲突：{0}。请先修改项目中的配置 ID。",
  "Another configuration operation is in progress.":
    "另一项配置操作正在进行中。",
  "Configuration changed on disk. Reload the editor before applying your changes.":
    "磁盘上的配置已被修改，请重新加载后再保存。",
  "Invalid configuration storage locations.": "配置保存位置无效。",
  "Configuration changed while saving. Reload before trying again.":
    "保存过程中配置已被外部修改，请重新加载后再试。",
  "Open or select a workspace folder to manage project configurations.":
    "请打开或选择工作区文件夹以管理运行配置。",
  "Configuration id was not found in this project.":
    "当前项目中没有此配置 ID。",
  "Code execution is disabled in an untrusted workspace. Trust it before running or debugging.":
    "未信任工作区中禁止执行代码，请先信任工作区再运行或调试。",
  "Save failed; execution cancelled.": "文件保存失败，已取消执行。",
  "Selected configuration no longer exists. Select another configuration.":
    "所选配置已不存在，请重新选择。",
  "Create or choose a launch.json configuration for this language, or add an executable run configuration.":
    "请为此语言创建或选择 launch.json 调试配置，或添加可执行文件运行配置。",
  'Task "{0}" was not found or is ambiguous in {1}.':
    "在 {1} 中找不到任务“{0}”，或存在多个同名任务。",
  'Debug configuration "{0}" is missing or ambiguous in {1}.':
    "在 {1} 中找不到调试配置“{0}”，或存在多个同名配置。",
  "Selected default SDK no longer exists. Open Toolchains Manager.":
    "所选默认 SDK 已不存在，请打开工具链管理重新选择。",
  "No supported executable was found in this SDK directory. Select its exact executable.":
    "SDK 目录中未找到受支持的可执行文件，请选择准确的可执行文件路径。",
  "This task has no corresponding Debug Configuration. Select a launch.json entry.":
    "此任务尚未关联调试配置，请选择 launch.json 中的配置。",
  "Cargo did not produce a runnable executable.":
    "Cargo 没有生成可运行的产物。",
  "Select a Python run configuration before opening its terminal.":
    "请先选择 Python 运行配置，再打开对应终端。",
  "Trust this workspace before debugging.": "请先信任工作区再启动调试。",
  "A Sakura Atelier debug session is already starting or running. Stop it before starting another.":
    "Sakura Atelier 调试会话正在启动或运行，请先停止当前会话。",
  "Debug adapter startup timed out. Check the debugger extension output and installation.":
    "调试适配器启动超时，请检查调试扩展的安装和输出。",
  "The debug adapter did not start a session. See the Debug Console and adapter extension output.":
    "调试适配器未启动会话，请查看调试控制台和扩展输出。",
  "The owned debugger is still stopping. Check the debug adapter output before restarting.":
    "当前调试器仍在停止，请检查调试扩展输出后再启动。",
  "Background tasks are not supported as run targets. Use a foreground run task.":
    "不支持将后台任务作为运行目标，请选择前台任务。",
  'Task "{0}" is already running.': "任务“{0}”已在运行。",
  'Task "{0}" ended without a successful process result.':
    "任务“{0}”结束，但没有成功的进程退出结果。",
  "Could not start task: {0}": "无法启动任务：{0}",
  "Sakura Atelier: Code execution is disabled in an untrusted workspace. Trust this workspace before running.":
    "Sakura Atelier：未信任工作区中禁止执行代码，请先信任工作区。",
  "Sakura Atelier has a new extension ID. Disable the old Sakura Runner extension to avoid duplicate toolbar buttons.":
    "Sakura Atelier 已使用新的扩展 ID，请禁用旧 Sakura Runner，避免工具栏按钮重复。",
  "Open a supported code file to run.": "请先打开受支持的代码文件。",
  "File could not be saved; run cancelled.": "文件无法保存，已取消运行。",
  'Configured task "{0}" was not found in this workspace folder.':
    "当前工作区文件夹中没有任务“{0}”。",
  "No runnable targets found. Add an explicit run configuration.":
    "未找到可运行目标，请添加运行配置。",
  "launch.json points outside the workspace.":
    "launch.json 指向工作区之外，已拒绝访问。",
  "launch.json contains invalid JSONC at offset {0}.":
    "launch.json 在偏移量 {0} 处存在 JSONC 格式错误。",
  "launch.json configurations must be an array.":
    "launch.json 的 configurations 必须是数组。",
  "tasks.json points outside the workspace.":
    "tasks.json 指向工作区之外，已拒绝访问。",
  "Workspace folder is no longer open.": "工作区文件夹已关闭。",
  "Invalid configuration editor message.": "配置编辑器消息无效。",
  "Choose a detected project inside this workspace.":
    "请选择当前工作区内检测到的项目。",
  "Invalid template project.": "模板项目无效。",
  "Unsupported template.": "此模板尚不受支持。",
  "No project configuration file exists. Save a project configuration first.":
    "尚不存在项目配置文件，请先保存项目配置。",
  "Missing editor revision.": "缺少编辑器修订标识。",
  "Configuration changed on disk. Reload before saving.":
    "磁盘上的配置已被修改，请重新加载后再保存。",
  "Invalid file picker field.": "文件选择字段无效。",
  "Choose a supported language.": "请选择受支持的语言。",
  "Discover or save this Python interpreter first.":
    "请先发现或保存此 Python 解释器。",
  "Trust the workspace before creating an environment.":
    "创建环境之前请先信任工作区。",
  "Select a discovered Python interpreter first.":
    "请先选择已发现的 Python 解释器。",
  "That directory already exists; it will not be overwritten.":
    "目录已存在，不会覆盖。",
  "Discover or save this SDK first.": "请先发现或保存此 SDK。",
  "Invalid SDK query.": "SDK 查询无效。",
  "Invalid install request.": "安装请求无效。",
  "Unsupported editor operation.": "不支持此编辑器操作。",
  "Enter a search keyword of 1–80 characters without leading options.":
    "请输入 1–80 个字符的搜索词，不得以命令选项开头。",
  "The package manager returned an invalid package identifier.":
    "包管理器返回的软件包标识无效。",
  "Select a version returned by the current configured package source.":
    "请选择当前已配置软件源返回的版本。",
  "Invalid Homebrew package kind.": "Homebrew 软件包类型无效。",
  "Homebrew returned no package details.": "Homebrew 未返回软件包详情。",
  "Package is not available from the configured APT repositories. No repository was added.":
    "当前 APT 软件源中没有此软件包；没有添加任何软件源。",
  "Select an explicit WinGet source.": "请明确选择 WinGet 软件源。",
  "WinGet did not return a parseable version list. Inspect the package in a normal terminal; no install command was generated.":
    "无法解析 WinGet 返回的版本列表，请在普通终端中检查；未生成安装命令。",
  "A verified WinGet source is required.": "需要经过核对的 WinGet 软件源。",
  "Invalid Sakura Atelier configuration.": "Sakura Atelier 配置无效。",
  "No supported project found inside the current workspace. Use Run File or configure a project command.":
    "当前工作区中未找到受支持的项目，请运行当前文件或配置项目命令。",
  'package.json script "{0}" does not exist.': "package.json 中没有脚本“{0}”。",
  "npm CLI not found. Configure an existing VS Code task for your package manager.":
    "未找到 npm 命令行程序，请为包管理器配置已有的 VS Code 任务。",
  "No project start/dev/run script. Set sakuraRunner.script, projectTask or configurations.":
    "项目没有 start/dev/run 脚本，请配置脚本、任务或运行配置。",
  "JSX requires a project script or configured runner.":
    "JSX 需要项目脚本或已配置的运行器。",
  "TypeScript needs a project script, an installed local tsx, or an explicit run configuration. No runner is installed automatically.":
    "TypeScript 需要项目脚本、本地 tsx 或明确的运行配置；不会自动安装运行工具。",
  "{0} detected. Set sakuraRunner.projectTask to an existing CMake/Make run task, or add a run configuration.":
    "检测到 {0}。请选择已有 CMake/Make 运行任务，或添加运行配置。",
  "C# requires a .csproj project or an explicit run configuration.":
    "C# 需要 .csproj 项目或明确的运行配置。",
  "{0} detected. Select an existing Maven/Gradle run task via sakuraRunner.projectTask, or configure its explicit command and main class.":
    "检测到 {0}。请选择已有 Maven/Gradle 运行任务，或配置明确的命令与主类。",
  "Trust the workspace before discovering interpreters.":
    "发现解释器之前请先信任工作区。",
  "Trust the workspace before creating a Python terminal.":
    "创建 Python 终端之前请先信任工作区。",
  "Python Environments could not resolve the configured interpreter.":
    "Python Environments 无法解析所选解释器。",
  "Python terminal auto-activation is off in the official extension settings. No duplicate activation command was injected. Run/Debug still use the selected interpreter.":
    "官方扩展设置已关闭终端自动激活，没有注入额外激活命令。运行和调试仍使用所选解释器。",
  "Conda activation requires the official Python Environments extension. No partial activation was attempted.":
    "Conda 激活需要官方 Python Environments 扩展，没有尝试不完整的激活。",
  "Trust the workspace before querying or installing SDKs.":
    "查询或安装 SDK 之前请先信任工作区。",
  "Open package details first; unverified package requests cannot be installed.":
    "请先打开软件包详情，未核对的软件包不能安装。",
  "Package identity/source changed. Refresh and confirm the new source first.":
    "软件包标识或来源已变化，请刷新并重新确认。",
  "Another SDK installation is already running.": "另一项 SDK 安装正在进行中。",
  "SDK installation completed, but toolchain refresh failed: {0}. Use Refresh or Locate Existing SDK.":
    "SDK 安装完成，但刷新工具链失败：{0}。请刷新或定位已有 SDK。",
  "Tool query failed: {0} {1}. {2}": "工具查询失败：{0} {1}。{2}",
  "Trust the workspace before querying toolchains.":
    "查询工具链之前请先信任工作区。",
  "Invalid executable name.": "可执行文件名称无效。",
  "Windows wrapper {0} requires an existing VS Code task. Set sakuraRunner.projectTask to its label.":
    "Windows 批处理入口 {0} 需要通过已有 VS Code 任务执行，请配置对应任务标签。",
  "This cmd activation path needs the official Python Environments extension because it contains cmd metacharacters.":
    "激活路径包含 cmd 特殊字符，需要使用官方 Python Environments 扩展。",
  "Shell {0} has no verified venv activation recipe. Install Python Environments or select bash/zsh/fish/PowerShell/cmd.":
    "尚未支持 Shell {0} 的可靠 venv 激活。请安装 Python Environments，或选择 bash/zsh/fish/PowerShell/cmd。",
  "Install {0} {1}": "安装 {0} {1}",
  "Source: {0}": "来源：{0}",
  "Administrator permission will be requested by sudo in the terminal.":
    "sudo 将在终端中请求管理员权限。",
  "Homebrew formulae use --skip-link; automatic cleanup and dependent upgrades are disabled.":
    "Homebrew formula 使用 --skip-link；已禁用自动清理和依赖升级检查。",
  "Package-manager permission and license prompts remain interactive.":
    "包管理器的权限和许可提示仍需由你交互确认。",
  "Select executable / output path": "选择可执行文件 / 输出路径",
  "Locate existing file or SDK": "定位已有文件或 SDK",
  "Synchronized with the official Python environment selection.":
    "已与官方 Python 扩展的环境选择同步。",
  "Create virtual environment in this workspace": "在当前工作区创建虚拟环境",
  "Use one new directory name.": "请输入一个新的目录名称。",
  "Create Python venv": "创建 Python 虚拟环境",
  "Create Python environment": "创建 Python 环境",
  "Secret reference name": "密钥引用名称",
  "Stored locally in VS Code SecretStorage, never in the project file.":
    "仅保存在 VS Code 本机密钥存储中，不写入项目文件。",
  "Use letters, digits, dots, underscores and hyphens.":
    "请使用字母、数字、点、下划线或连字符。",
  "Store {0}": "保存密钥 {0}",
  "Saved secret reference: {0}": "已保存密钥引用：{0}",
  "Installation cancelled.": "已取消安装。",
  "Installation completed. Toolchains were refreshed; your selected SDK was not changed.":
    "安装完成，已刷新工具链，未更改所选 SDK。",
  "Unsupported platform/distribution. Only macOS Homebrew, Ubuntu/Debian-compatible APT and Windows WinGet are enabled.":
    "暂不支持此操作系统或发行版。仅支持 macOS Homebrew、Ubuntu/Debian 兼容 APT 和 Windows WinGet。",
  "{0} is missing from PATH. Use the official installation instructions. No package manager was installed.":
    "PATH 中未找到 {0}，请参考官方安装说明；没有自动安装包管理器。",
  "Other package": "其他软件包",
  "{0} is now the {1} default. System defaults were not changed.":
    "已将 {0} 设为 {1} 默认值，系统默认版本未改变。",
  workspace: "工作区",
  "Sakura Atelier global": "Sakura Atelier 全局",
  "Compile {0}": "编译 {0}",
  "Run binary": "运行可执行文件",
  "Go project": "Go 项目",
  "Rust project": "Rust 项目",
  "Python file": "Python 文件",
  "Node.js file": "Node.js 文件",
  "Java source file (JDK 11+)": "Java 源文件（JDK 11+）",
  "Configure CMake target": "配置 CMake 目标",
  "Build CMake target": "构建 CMake 目标",
  "Build Make target": "构建 Make 目标",
  "Compile TypeScript": "编译 TypeScript",
  "Python environment mismatch: {0}": "Python 环境不一致：{0}",
  Saved: "已保存",
  Pending: "等待保存",
  Saving: "正在保存…",
  "Fix configuration": "请修正配置",
  "Save failed": "保存失败",
  "Configuration changed externally": "配置已被外部修改",
  Retry: "重试",
  "Compare changes": "查看差异",
  Reload: "重新加载",
  "Keep draft": "保留草稿",
  "Draft restored": "已恢复上次未保存的草稿",
  "Current workspace": "当前工作区",
  "Run and Debug": "运行与调试配置",
  "Development Environments": "开发环境",
  Overview: "总览",
  "SDK Installation and Updates": "SDK 安装与更新",
  "Rust toolchain": "Rust 工具链",
  "Python interpreters": "Python 解释器",
  "C / C++ compilers": "C / C++ 编译器",
  ".NET SDK": ".NET SDK",
  "Toggle sidebar": "展开 / 收起侧栏",
  "Resize sidebar": "调整侧栏宽度",
  "Scan this machine": "扫描本机",
  "Use project default": "使用项目默认值",
  "Choose existing SDK": "选择已有 SDK",
  "Install new SDK": "安装新 SDK",
  Configured: "已配置",
  "No SDK configured": "尚未配置 SDK",
  "Environment overview": "开发环境总览",
  "Manage installed SDKs, interpreters and compilers for this workspace.":
    "为当前工作区管理已安装的 SDK、解释器和编译器。",
  "Remove SDK record": "移除 SDK 记录",
  "Only removes the local record; SDK files are not deleted.":
    "仅移除本机记录，不删除电脑上的 SDK 文件。",
  Confirm: "确认",
  'Delete configuration "{0}"?': "确定删除运行配置“{0}”吗？",
  'Move "{0}" to {1}?': "将“{0}”迁移为{1}吗？",
  "Configuration migration requires confirmation.":
    "配置保存位置迁移需要明确确认。",
  "Configuration deletion requires confirmation.": "删除运行配置需要明确确认。",
  "Draft retained. External changes were not overwritten.":
    "草稿已保留，没有覆盖外部修改。",
  "Invalid input": "输入无效",
  "Configuration name is required.": "配置名称不能为空。",
  "Target is required.": "请填写运行目标。",
  "Use an environment or secret reference.": "请使用环境变量或密钥引用。",
  "Missing SDK does not prevent editing; Run will validate it.":
    "缺少 SDK 不影响编辑配置；运行时会检查依赖。",
  "No packages yet": "尚无软件包结果",
  "Select a package to view details.": "请选择软件包以查看详情。",
  "Back to configuration": "返回运行配置",
  "Discard the editor draft and reload saved configurations?":
    "放弃当前编辑草稿并重新加载已保存的配置吗？",
  "Removing a toolchain record requires confirmation.":
    "移除工具链记录需要明确确认。",
  "Editor draft is too large.": "编辑草稿过大，请减少配置内容。",
  "Invalid confirmation request.": "确认请求无效。",
  "expected a JSON object.": "应为 JSON 对象。",
  "unknown top-level field.": "存在未知的顶层字段。",
  "version must be 1 and configurations must be an array of at most 200 items.":
    "version 必须为 1，configurations 必须为不超过 200 项的数组。",
  "item {0} must be an object.": "第 {0} 项必须为对象。",
  "item {0}: unknown field.": "第 {0} 项包含未知字段。",
  "item {0}: unsupported language.": "第 {0} 项的语言不受支持。",
  "{0} must be a bounded string.": "{0} 必须是长度受限的字符串。",
  "item {0}: id must be unique and contain only letters, digits, dots, underscores or hyphens.":
    "第 {0} 项的 ID 必须唯一，且只能包含字母、数字、点、下划线或连字符。",
  "name is required.": "配置名称不能为空。",
  "{0} must be a string array.": "{0} 必须为字符串数组。",
  "invalid {0}.": "{0} 的值无效。",
  "terminal and autoActivate must be booleans.":
    "terminal 和 autoActivate 必须为布尔值。",
  "env must be an object of environment/secret references.":
    "env 必须为环境变量或密钥引用组成的对象。",
  "env.{0}: use a reference such as ${env:API_TOKEN} or ${secret:API_TOKEN}; plaintext values are not stored.":
    "env.{0} 必须使用 ${env:API_TOKEN} 或 ${secret:API_TOKEN} 之类的引用，不能保存明文值。",
  "pass sensitive arguments through environment or secret references.":
    "敏感参数请通过环境变量或密钥引用传入。",
  "default must refer to an existing configuration id.":
    "默认配置必须引用已有的配置 ID。",
  "Official Python selection is unavailable; Sakura Atelier will use the explicitly configured interpreter.":
    "官方 Python 环境选择不可用，Sakura Atelier 将使用明确配置的解释器。",
  "Python selection mismatch: {0}. Run/Debug will use {1}.":
    "Python 环境选择不一致：{0}。运行与调试将使用 {1}。",
  ID: "标识",
  "Installation path": "安装位置",
  system: "系统级工具链",
  manager: "环境管理器",
  formula: "Homebrew formula",
  cask: "Homebrew cask",
  true: "已启用",
  false: "已关闭",
  "Choose a Cargo example.": "请选择 Cargo 示例。",
  "Compiled JavaScript output is required for tsc.":
    "tsc 模式需要填写编译后的 JavaScript 入口。",
  "Choose a Cargo project containing Cargo.toml.":
    "请选择包含 Cargo.toml 的 Cargo 项目。",
  "Choose an existing CMake project and its actual output executable.":
    "请选择已有的 CMake 项目，并填写实际可执行产物。",
  auto: "自动检测",
  "Build/test arguments": "构建 / 测试参数",
  configured: "已配置",
  PATH: "PATH",
  local: "本机",
  "No supported SDK was found.": "未找到受支持的 SDK。",
  "Build arguments": "编译参数",
  "Program arguments": "程序参数",
  "Select run task": "选择运行任务",
  "Sakura Atelier: Select run target": "Sakura Atelier：选择运行目标",
  "Configure Runner": "配置运行器",
  "Task terminated without an exit code.": "任务已终止，但未返回退出码。",
  'Task "{0}" failed (exit {1}). See its terminal output.':
    "任务“{0}”执行失败（退出码 {1}），请查看终端输出。",
  "PATH / custom": "PATH / 手动配置",
  "Secure draft storage is unavailable. Valid configurations still autosave; unfinished drafts remain in memory until this page closes. Check the VS Code system keyring.":
    "本机安全草稿存储不可用。有效配置仍会自动保存；未完成的草稿暂留内存，关闭页面后可能无法恢复。请检查 VS Code 的系统钥匙串。",
};
export function resolveLanguage(
  setting: string | undefined,
  vscodeLanguage = "en",
): UiLanguage {
  return setting === "en"
    ? "en"
    : setting === "auto"
      ? /^zh(?:-|$)/i.test(vscodeLanguage)
        ? "zh-cn"
        : "en"
      : "zh-cn";
}
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patterns = Object.entries(chinese)
  .filter(([key]) => /\{\d+\}/.test(key))
  .map(([key, value]) => ({
    pattern: new RegExp(
      "^" +
        key
          .split(/(\{\d+\})/)
          .map((part) =>
            /^\{\d+\}$/.test(part) ? "([\\s\\S]*?)" : escape(part),
          )
          .join("") +
        "$",
    ),
    value,
  }));
export function translate(
  language: UiLanguage,
  key: string,
  ...args: unknown[]
): string {
  if (key.includes("\n") && !args.length)
    return key
      .split("\n")
      .map((line) => translate(language, line))
      .join("\n");
  let text = language === "zh-cn" ? (chinese[key] ?? key) : key;
  if (language === "zh-cn" && text === key) {
    for (const { pattern, value } of patterns) {
      const match = key.match(pattern);
      if (match) {
        text = value.replace(/\{(\d+)\}/g, (_, index) =>
          translate(language, match[Number(index) + 1] ?? ""),
        );
        break;
      }
    }
  }
  return text.replace(/\{(\d+)\}/g, (_, index) =>
    String(args[Number(index)] ?? "{" + index + "}"),
  );
}
