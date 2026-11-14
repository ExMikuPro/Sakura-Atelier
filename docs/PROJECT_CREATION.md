# 新建项目

入口：**文件 → 新建文件… → Sakura Atelier：新建项目…**、命令面板，或配置页左侧“新建项目…”。文件菜单入口位于新建类型选择器中，不是原生文件菜单的一级条目。

统一向导包含“编程语言”和“嵌入式项目”两组。“空项目”位于首项，只创建命名后的空目录，不写入源码、隐藏文件、依赖或运行配置；创建后可选择打开该目录，且不会覆盖已有目录。当前语言模板为基础应用/控制台项目：

| 类型 | 主要文件 | 运行条件 |
| --- | --- | --- |
| Python | `src/main.py`、`pyproject.toml` | Python 3.9+ |
| JavaScript / Node.js | `src/main.js`、`package.json` | Node.js |
| TypeScript | `src/main.ts`、`tsconfig.json`、`package.json` | Node.js；安装声明的 tsx/TypeScript 项目依赖 |
| Go | `main.go`、`go.mod` | Go 1.22+ |
| Rust / Cargo | `src/main.rs`、`Cargo.toml` | Rust / Cargo |
| C | `src/main.c`、`CMakeLists.txt` | C 编译器；CMake 构建可选 |
| C++ | `src/main.cpp`、`CMakeLists.txt` | C++ 编译器；CMake 构建可选 |
| C# / .NET | `Program.cs`、`App.csproj` | .NET 8+ 或兼容目标框架的 SDK |
| Java | `Main.java` | JDK 11+ source launcher |

每个语言项目还会创建 README、`.gitignore` 和 `.vscode/sakura-atelier.json`。运行配置来自现有 25 个运行模板的同一工厂与 schema，使用可移植变量，不写入机器 SDK 路径，也不创建第二套配置管理系统。打开新项目目录后即可在原有配置页选择 SDK 和运行配置。

创建前展示文件清单与 SDK 状态。缺少 SDK 时仍可创建源代码，运行/调试前需要配置 SDK。创建过程仅写入新目录中的文件，不执行语言初始化器，不自动安装 SDK、npm 包或其他依赖。TypeScript 依赖可通过已有项目依赖检查审阅修复计划，执行仍需原生确认。

目标目录必须不存在；目录创建和文件写入都采用排他创建，若规划后出现同名目录/文件则停止，保留已有内容。失败后保留已经创建的文件供用户检查，不删除用户数据。

PlatformIO、STM32CubeMX 和已有 STM32 项目入口保留在“嵌入式项目”组，器件搜索、收藏与最近使用继续可用。语言模板也可以收藏并恢复草稿；无需选择嵌入式器件。

本轮在 macOS ARM64 实际创建了全部 9 类项目，使用现有工具执行了其中 8 类示例；TypeScript 验证使用仓库已有的 tsx，没有安装到用户项目。C# 文件/schema 通过验证，但本机无 .NET SDK，未宣称原生编译通过。框架脚手架（如 React/Vue/Django）尚未提供。
