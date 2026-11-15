# Python、TypeScript 与 Java 项目初始化

Sakura Atelier 在统一新建项目向导中为 **Python**、**TypeScript** 与 **Java** 增加了完整的工程脚手架、依赖初始化与构建工具准备流程。

## 1. Python 项目初始化

- **虚拟环境自动创建**：支持在向导中选择已发现的 Python SDK 与包管理器（`pip` 或 `uv`）。`pip` 模式执行 `python -m venv .venv` 并生成 `requirements.txt`；`uv` 模式执行 `uv venv` 与 `uv sync` 并生成 `uv.toml`。
- **可移植路径引用**：共享配置 `.vscode/sakura-atelier.json` 中仅保存 `${workspaceFolder}/.venv` 引用，运行时按当前操作系统自动解析 `bin/python` 或 `Scripts/python.exe`。
- **环境修复**：若 `.venv` 损坏，可通过命令面板运行 **Python：重新创建项目虚拟环境**，确认后将旧目录备份为 `.venv.backup-<时间戳>` 再重新创建。

## 2. TypeScript 项目初始化

- **标准化工程与脚本**：自动生成 `src/index.ts`、`tsconfig.json`（`NodeNext` 模块、开启 `sourceMap`）及 `package.json`：
  ```json
  {
    "type": "module",
    "scripts": {
      "dev": "tsx src/index.ts",
      "build": "tsc -p tsconfig.json",
      "start": "node dist/index.js"
    }
  }
  ```
- **依赖安装与验证**：自动调用所选 `npm` 或 `pnpm` 安装 `typescript`、`tsx` 与 `@types/node`，随后执行 `tsc --noEmit` 与入口校验；支持内置 Node 调试器直接对 `.ts` 源码断点调试。

## 3. Java 与 Spring Initializr 初始化

- **工程类型支持**：支持标准 **Java Application**（`src/main/java`、`src/test/java`）与官方 **Spring Boot Application**（实时对接 Spring Initializr 元数据接口，支持依赖搜索、版本兼容性过滤与安全 ZIP 解压）。
- **构建工具支持**：支持 **Maven**、**Gradle Groovy** 与 **Gradle Kotlin**。
- **一键配置 Maven / Gradle / Wrapper**：
  - 向导与命令面板（**Java：一键配置 Maven / Gradle / Wrapper**）优先复用本机已有工具；若缺失则从官方源下载并校验 SHA-256 / SHA-512，独立安装在扩展宿主 `globalStorage/java-tools` 目录中，绝不修改全局 `PATH` 或默认 JDK。
  - 自动生成标准 `mvnw` / `gradlew` Wrapper 脚本，运行与构建时优先调用项目级 Wrapper。
  - 自动识别并拒绝直接运行 Maven `packaging=pom` 等多模块聚合根目录，引导用户指向具体应用模块。

## 安全与验证边界

- **进程安全与失败保留**：初始化过程实时输出进度并支持随时取消；若因网络或环境原因失败，保留已生成文件并明确提示原因，绝不执行危险的目录递归删除。
- **验证状态**：已在 macOS ARM64 完成 Python（`pip`/`uv`）、TypeScript（`npm`/`pnpm` 含 `.ts` 断点调试）、普通 Java 与 Spring Boot（Maven / Gradle Groovy & Kotlin）全矩阵真实创建与构建验证；Quarkus / Micronaut 扩展点已预留，Windows / Linux 端到端适配待进一步测试。