# P1-B：Python 项目环境工作流

堆叠于 P1-A，版本仍为 0.1.0。不修改 P0 界面、Python 全局环境、Shell 初始化文件或配置持久化格式。

## P0 接口

`createPythonEnvironmentServices()` 返回 service、runner、dispose。service.diagnose(file, workspaces) 复用 ProjectToolchainResolver 与现有 PythonEnvironments；列出项目版本要求、已发现解释器、.venv/venv 目录、可用管理器和推荐方式。uv/Poetry/Pipenv 元数据影响推荐，Conda 可发现；“解释器可用”与“依赖就绪”分开，后者未检查时为 Unknown。

`useExisting(status, executable)` 重新发现、校验版本并调用现有官方同步逻辑，返回可写入现有 Run Configuration 的 toolchain 值和诊断。同步失败明确返回 selectionMismatch，不另存第二套解释器选择。P0 应把此结果交给现有配置保存操作；Run/Debug 继续使用已有同一份配置。没有自动替用户切换配置。

`prepareCreation` 为明确选择的基础 Python 生成 `python -m venv <目录>` 或 `uv venv <目录> --python <路径> --no-python-downloads`。已有目录（包括悬空符号链接）直接拒绝；不覆盖、清理或删除失败目录。计划执行前重新校验基础解释器、目录和元数据。系统安装与依赖安装不属于该计划。

`createOfficial` 优先提供官方 Python Environments 的交互向导。研究的公开 API 仅支持 quickCreate/additionalPackages，不能指定基础解释器、精确目录或取消令牌，因此不伪造这些选项。调用使用 quickCreate:false，并先检查 .venv/venv 不存在、展示目标项目和向导可能的依赖操作。官方 API 不可用/失败时明确报错，不静默尝试 CLI。官方向导内部任务不能由本服务取消；不要将它作为有硬超时保证的后台任务。Poetry/Pipenv/Conda 的创建交给官方管理器，本阶段没有未经验证的自制命令后备实现。

`terminal` 委托已有 PythonEnvironments.createTerminal，不重新实现激活，不接管普通终端。沿用现代 createTerminal 的 disableActivation、官方自动激活设置、无官方扩展时真实激活脚本与终端复用；不靠修改 VIRTUAL_ENV 假装激活。

`RemediationRunner` 为 B/C 共用的显式操作入口。只接受服务签发的计划 ID，确认前后校验，展示宿主、工作目录、逐参数命令、可能修改路径和第三方代码提示。复用独立的原有 TaskExecutor，支持取消/超时，阻止并发重复操作；不停止普通 Run 或其他扩展任务。计划一次使用。P0 不应把 Webview 传来的任意命令转成计划。

## 验证

原有 44 项测试通过；A+B 新增 36 项测试。macOS ARM64 / VS Code 1.85.2 Development Host 在隔离临时项目中实际创建 venv、重新发现、保护已有目录、选择解释器、创建并复用终端。没有修改系统 SDK。

隔离宿主没有安装官方 Python 扩展：其公开 API 只做契约测试，Python Debug 未实测。终端复用实测通过，交互 Shell 的最终激活状态未自动采集；Windows/Linux/WSL/SSH/容器未实机验证。不要把上述限制标为完整平台验收。

命令：`npm test`、`node scripts/test-p1.cjs`、`node scripts/integration-p1.cjs p1-b`（先 compile）。P0 后续负责把这些后台接口连接到其新按钮/状态区，本 PR 不重做 UI。

公开接口依据：[Microsoft Python Environments types](https://github.com/microsoft/vscode-python-environments/blob/main/src/types.ts)、[Python venv](https://docs.python.org/3/library/venv.html)。
