# PlatformIO 工作流

Sakura Atelier 将 PlatformIO 深度接入日常编辑、运行、调试、串口监视与 IntelliSense 工作流，兼容多工作区、深层目录及与 CMake / `.ioc` 共存的项目结构。

## 核心能力

- **全工作区递归识别**：自动扫描工作区中的 `platformio.ini`（排除 `.pio`、构建及依赖目录），打开 `.cpp`、`.h` 或 `.ini` 时自动关联所属 PlatformIO 工程上下文，优先使用 PlatformIO 构建入口。
- **六类自动化运行配置**：在 `.vscode/sakura-atelier.json` 中生成稳定 ID 的六类配置，重复扫描仅补充缺失项，保留用户的手动修改：
  - **编译（Build）**：执行 `pio run -d <PROJECT> -e <ENV>`，支持 GCC 问题匹配器（Problem Matcher）与进度通知。
  - **运行（Upload / Exec）**：嵌入式环境执行 `pio run -d <PROJECT> -e <ENV> -t upload`（串联构建与上传，失败即中止）；`native` 环境执行 `-t exec`，不触发硬件烧录。支持独立上传端口与临时协议覆盖，不修改原始 `platformio.ini`。
  - **调试（Debug）**：自动检测开发板支持的调试探针或配置的 `debug_tool`，通过官方 PlatformIO 调试类型与 VS Code Debug API 启动会话；`Stop` 仅终止 Sakura Atelier 拥有的会话。
  - **串口监视（Monitor）**：独立运行 `pio device monitor`，支持选择端口、波特率与过滤器；切换项目、移除工作区或关闭窗口时自动清理串口子进程并释放端口。
  - **测试（Test）**：执行 `pio test`。
  - **清理（Clean）**：执行 `pio run -t clean`。
- **多环境记忆与共享**：若工程仅含单一环境或 `default_envs` 则自动选中；存在多个环境时提供选择列表，并将所选环境保存在工作区状态中供六类操作共享。
- **Arduino 入口自动补齐**：新建 Arduino 框架工程，或打开源码目录为空的纯 Arduino 工程时，自动在 `src_dir` 下排他生成包含 `setup()` 与 `loop()` 的 `main.cpp`（已有任何源码文件时保持原样）。
- **C/C++ IntelliSense 自动配置**：复用 Sakura C/C++ 配置提供程序，读取 `.pio/build/<env>/idedata.json` 或官方元数据中的头文件路径（`includes.build` / `compatlib` / `toolchain`）、宏定义与编译器参数，无需手动配置即可获得 `Arduino.h` 等 SDK 补全（可通过 `sakuraAtelier.platformio.autoIntelliSense` 开关，不覆盖用户自定义 `includePath`）。

## 自动配置示例

```json
{
  "version": 1,
  "configurations": [
    {
      "id": "pio-demo-build",
      "name": "PlatformIO — 编译",
      "language": "cpp",
      "kind": "project",
      "templateId": "platformio",
      "target": "${workspaceFolder}/firmware",
      "cwd": "${workspaceFolder}/firmware",
      "pioAction": "build",
      "pioEnvironment": "esp32dev"
    },
    {
      "id": "pio-demo-upload",
      "name": "PlatformIO — 运行（编译并上传）",
      "language": "cpp",
      "kind": "project",
      "templateId": "platformio",
      "target": "${workspaceFolder}/firmware",
      "cwd": "${workspaceFolder}/firmware",
      "pioAction": "upload",
      "pioEnvironment": "esp32dev",
      "pioBuildBefore": "true",
      "pioUploadPort": "",
      "pioUploadProtocol": "",
      "pioMonitorAfter": "false"
    }
  ]
}
```

## 安全与验证边界

- **安全边界**：Core 路径缓存在本机 `globalState`，绝不将本机绝对路径写入项目配置文件或修改系统 `PATH`；未受信任工作区禁止执行 CLI 或生成源文件；检测到官方扩展正在运行任务时主动提示避免端口冲突。
- **验证状态**：已在 macOS ARM64 + PlatformIO Core 6.2.0 完成多根工程识别、任务终端、串口进程回收及 Microsoft C/C++ 成员补全/定义跳转验证；真实硬件烧录、探针断点调试及 Windows / Linux 端到端实机测试仍待手动验收。