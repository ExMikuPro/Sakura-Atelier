# 新建项目指南

Sakura Atelier 提供统一的三栏式新建项目向导，支持在无打开工作区的情况下直接创建通用编程语言与嵌入式工程。

## 打开入口

- 菜单栏：**文件 → 新建文件… → Sakura Atelier：新建项目…**
- 命令面板：**Sakura Atelier：新建项目…**
- 设置中心：左侧导航栏 **新建项目…**

## 支持的项目类型

| 类型 | 生成的主要文件 | 运行与环境条件 |
| :--- | :--- | :--- |
| **空项目** | 仅创建指定名称的空目录 | 无 |
| **Python** | `src/main.py`、`pyproject.toml`（或 `requirements.txt` / `uv.toml`） | Python 3.9+（支持自动创建 `.venv`） |
| **JavaScript / Node.js** | `src/main.js`、`package.json` | Node.js |
| **TypeScript** | `src/index.ts`、`tsconfig.json`、`package.json` | Node.js（自动安装 `tsx` / `typescript`） |
| **Go** | `main.go`、`go.mod` | Go 1.22+ |
| **Rust / Cargo** | `src/main.rs`、`Cargo.toml` | Rust / Cargo |
| **C** | `src/main.c`、`CMakeLists.txt` | C 编译器（CMake 构建可选） |
| **C++** | `src/main.cpp`、`CMakeLists.txt` | C++ 编译器（CMake 构建可选） |
| **C# / .NET** | `Program.cs`、`App.csproj` | .NET 8+ 或兼容目标框架的 SDK |
| **Java** | 标准 Maven/Gradle 目录结构或 Spring Initializr 工程 | JDK 11+（支持一键配置构建工具） |
| **嵌入式项目** | PlatformIO 工程、STM32CubeMX 6.x 工程或打开已有 STM32 项目 | 对应官方工具链（见嵌入式文档） |

## 工程规范与安全机制

- **开箱即用的标准化配置**：通用语言工程均自动生成 `README.md`、`.gitignore` 与 `.vscode/sakura-atelier.json`。运行配置采用可移植变量（如 `${workspaceFolder}`），绝不将本机 SDK 绝对路径写入共享配置文件。
- **排他写入与目录保护**：创建前完整预览即将生成的文件清单与本地 SDK 检测状态；目标目录必须不存在，目录与文件均采用排他创建机制，绝不覆盖或合并用户已有文件。
- **模板收藏与草稿恢复**：常用语言及嵌入式配置可一键收藏至“我的收藏模板”，下次创建时自动恢复框架与参数（仅需重新填写项目名称与保存目录）。