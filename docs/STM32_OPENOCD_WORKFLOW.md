# STM32 / OpenOCD 与 IntelliSense 工作流

Sakura Atelier 为基于 CMake 的 STM32 工程提供独立的编译、OpenOCD 烧录、Cortex-Debug 调试与 C/C++ 代码补全支持。

## 核心操作（严格分离）

编辑器工具栏仅在打开 STM32 工程内的 C/C++、汇编、`.ioc` 或构建文件时展示专用动作：
- **构建（Build）**：执行 CMake 配置与增量编译，定位生成的 `.elf` 产物，绝不触发烧录或运行。
- **运行（Flash）**：增量编译后弹出模态确认窗口，核对目标 `.elf` 与芯片型号，通过 OpenOCD 执行 `program <elf> verify reset exit` 完成烧录、校验与复位，绝不执行整片擦除。
- **调试（Debug）**：必要增量编译后启动独立托管的 OpenOCD 进程，并调用 `marus25.cortex-debug` 发起调试会话（支持运行至 `main`、断点与单步）；停止调试时自动回收本次启动的 OpenOCD 进程，不影响其他扩展的调试会话。

## 自动配置示例（`.vscode/sakura-atelier.json`）

首次打开或新建 STM32 CMake 工程时自动生成编译、烧录运行与 OpenOCD 调试配置（工具自定义路径通过 `${localPath:...}` 保存在本机，不写入共享文件）：

```json
{
  "version": 1,
  "configurations": [
    {
      "id": "stm32-f407-run",
      "name": "STM32 — 运行（烧录并启动）",
      "language": "c",
      "kind": "project",
      "templateId": "stm32",
      "target": "${workspaceFolder}",
      "cwd": "${workspaceFolder}",
      "operation": "run",
      "stm32Action": "run",
      "stm32Preset": "Debug",
      "stm32BuildBefore": "true",
      "stm32Target": "target/stm32f4x.cfg",
      "stm32Probe": "",
      "stm32Interface": "",
      "stm32Transport": "swd",
      "stm32Speed": "4000",
      "stm32Port": "3333",
      "stm32Load": "true",
      "stm32Main": "true",
      "stm32Elf": ""
    }
  ]
}
```

## 默认 C/C++ 代码补全

- 设置项 `sakuraAtelier.stm32.autoIntelliSense` 默认开启。识别 STM32 工程后，通过 Microsoft C/C++ 官方配置提供程序接口自动注入芯片宏定义、HAL/CMSIS 头文件路径与 ARM 编译参数。
- 首次构建前即可解析 CubeMX 生成的工程元数据；构建时自动导出 `compile_commands.json` 并在更新后刷新符号补全。已有 `c_cpp_properties.json` 或手动配置会被完整保留，不会被强行覆盖。

## 手动硬件测试要点与验证状态

- **已验证**：macOS ARM64 下 CMake/Ninja + ARM GCC 15.3.1 增量编译生成 `.elf`、Microsoft C/C++ 结构体与条件宏补全，以及设置面板与进程生命周期单元测试。
- **待实机验收**：连接真实 STM32 开发板（如 STM32F407ZET6 + ST-LINK）进行真实 OpenOCD 烧录校验、Cortex-Debug 断点/单步/寄存器查看及端口占用异常测试。