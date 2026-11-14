# 经典 STM32CubeMX 6.x 工作流

本阶段只接入经典 STM32CubeMX 6.x 的内置 CLI 和 `.ioc`，以 macOS Apple Silicon、CMake、ARM GCC 为主要工作流。没有 CubeMX2 Provider、`.ioc2` 或 `cube mx` 调用。工具、器件和项目后端继续使用现有注册表。

## 工具准备

在“嵌入式工具”中检查或定位 STM32CubeMX 6.x、CMake、ARM GNU Toolchain 的 `arm-none-eabi-gcc`，以及 Ninja（使用 Ninja 预设时需要）。macOS 会查找 `/Applications/STMicroelectronics/STM32CubeMX.app`；生成前读取 app 的版本元数据，非 6.x 或无法确认版本时停止。Apple Silicon 应使用 ARM64 版 CubeMX 和本机可执行的工具链；插件不下载 Rosetta、Java 或 SDK。

所选 MCU 对应的 STM32Cube 固件包需先在 CubeMX 中准备好。生成脚本不写入 ST 账号密码，也不安装固件包。需要登录或缺少依赖时请在 CubeMX 中处理后重试。

## 新建项目

“新建项目 → STM32CubeMX”选择 MCU 或开发板、名称、保存位置，工具链默认 CMake，CLI 默认 `-q`。也可选择 `-s` 显示界面的脚本模式。

创建先排他建立新目录，再调用经典 CubeMX。脚本依次执行：

```text
load STM32F401RETx
project name "Blink"
project path "/path/to/Blink"
project toolchain "CMake"
project compiler GCC
config save "/path/to/Blink/Blink.ioc"
project generate
config save "/path/to/Blink/Blink.ioc"
exit
```

开发板使用 `loadboard <board> allmodes`，由 CubeMX 应用其默认外设配置。`.ioc`、初始化代码、HAL/启动文件和构建文件均由 CubeMX 生成，插件不手写 `.ioc` 或伪造芯片配置。CLI 参数通过独立 argv 传递，脚本参数中的双引号、换行和 NUL 会被拒绝。

只有进程成功退出、生成的 `.ioc` 与选择的器件匹配，且 CMake 文件和 ARM 工具链文件存在时才提示成功。缺少 CubeMX、远程窗口、版本不符或生成失败均不会被当作成功创建空项目；失败后保留已生成的文件供排查，不清空目录。已存在的目标目录不合并、不覆盖。

## 修改配置与重新生成

打开 `.ioc` 页面：

- **使用 STM32CubeMX 打开**：使用经典 GUI 配置引脚、时钟、外设并保存同一个 `.ioc`。
- **使用 CLI 配置 (-i)**：在 VS Code 终端运行经典 `STM32CubeMX -i`，载入当前 `.ioc`，可使用其交互命令；修改后用 `config save "<完整路径>.ioc"` 保存，结束用 `exit`。
- **生成 CMake 工程**：选择 `-q` 或 `-s`，确认更新已有工程后，执行 `config load`、项目参数设置、`project generate` 并保存 `.ioc`。保留现有项目名称，将生成位置设为当前 `.ioc` 所在目录。自定义代码应放在 CubeMX 的 USER CODE 区域，不能承诺保留生成文件中的任意手工修改。

命令面板也提供“STM32CubeMX 6.x：生成 CMake 工程”和“使用 CLI 配置 (-i)”。只打开或查看 `.ioc` 不启动生成器。

## 构建与诊断

运行“STM32：构建”，选择 CMake 配置预设（如有）。构建步骤在自己的环境中加入已选 ARM GCC、CMake 和 Ninja 的目录，不修改全局 PATH。配置预设的输出目录显式设为 `build/<preset>`，再通过 `cmake --build <目录>` 构建，因此不要求存在同名构建预设。没有预设时使用 `build/Debug` 或 `build/Release` 及已生成的 ARM 工具链文件。

CubeMX 的输出显示在 Sakura Atelier 输出面板，脚本和日志保存在独立临时目录，错误消息附带日志位置。生成支持取消、五分钟超时及同一目录的并发保护；取消与扩展退出会终止本次生成进程组，保留生成结果供排查。代码生成与构建不执行烧录。

## 本轮验证边界

按用户要求停止运行测试：本轮只做 TypeScript 编译、ESLint 和 VSIX 打包检查，没有实际执行 CubeMX CLI、CMake 配置/编译、开发板烧录或调试。代码路径已实现，不能将其描述为已完成真实端到端验收。此前的测试统计不代表这些新改动已回归。

命令依据：[ST 官方 CubeMX 6.x CLI 文档](https://dev.st.com/stm32cube-docs/stm32cubemx/6.18.0/en/docs/markup/CubeMX_CLI.html)。
