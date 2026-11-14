# P1-A：项目 SDK 诊断与宿主工具链注册表

版本仍为 0.1.0。本阶段不修改配置页布局、主题、项目配置或系统环境。

## 数据接口

`src/environment/model.ts` 提供 EnvironmentStatus、ToolchainRequirement、ToolchainCandidate、DependencyStatus、RemediationPlan。消息包含稳定 code、中文回退文本和参数，P0 可以接入自己的 i18n。

ProjectToolchainResolver.resolve 接受文件、工作区根、已发现工具链及 discoveryComplete；inspectProjects 可复用现有项目清单。只读取工作区内有大小限制的元数据，识别最近项目及祖先声明，不执行项目构建脚本。多根工作区按最深包含关系隔离。

识别 Python、Go、Rust、Node.js、C#、Java、C/C++ 的常见版本文件；Go 最低版本和推荐工具链分开处理，Python 范围不作为精确版本，Rust 编译器与 Cargo 版本分开处理，.NET 按 SDK 版本和 global.json rollForward 比较。仅支持可证明的静态范围、字面量及简单 TOML；动态 Gradle、复杂 Maven 继承、CMake 包含/继承、完整 PEP440/semver 特殊表达式返回 Unknown。不同 CMake preset 的编译器不是同时要求。不会自动选择或下载 SDK。

## 全局发现

启动异步读取当前扩展宿主 `globalStorageUri/toolchains.json`，然后按 6 小时有效期刷新；远程每次启动重新验证。使用原有 ToolchainDiscovery，扫描 PATH、常见官方 SDK 根目录和有边界的版本管理器目录，不递归遍历硬盘。并发限制为 3，检测有超时、取消和错误隔离。排除工作区内程序及自动下载型代理。没有可靠版本信息时不伪造版本。

记录稳定 ID、宿主、绝对路径、来源、版本、可用状态、验证时间；符号链接去重，同时保留 Python 虚拟环境及 Rust channel 的语义身份。同一 dotnet 可列出多个 SDK。旧 `atelier.toolchains` 迁移成带工作区范围的别名，保留旧数据及配置引用。未再次发现的记录标记不可用，不删除手动记录。损坏或异宿主缓存保留副本，不导入其路径。JSON 原子替换且权限 0600；不启用 Settings Sync。

现有 ConfigurationStore 和工具链列表读取注册表；SDK 安装后现有 refreshTools 路径刷新全局发现。`hostToolchains()` 暴露 snapshot/subscribe/refresh/add/file；`sakuraAtelier.openToolchainRegistry` 可供 P0 调用。当前 SDK 页状态文字包含宿主、发现状态及扫描时间。专门的宿主徽标、全局文件按钮和独立“已安装工具链”布局仍由 P0 接入，未在本 PR 重做前端。

## 远程边界

保持 `extensionKind: [workspace]`，使用官方 env.remoteName、扩展宿主类型及工作区 URI，配合实际 Node platform/arch、主机名和机器标识。WSL/SSH/容器只在当前工作区扩展宿主发现和执行，不启用本机回退。注册表归属于该宿主的 globalStorageUri；不同环境缓存拒绝混用。远程重连及容器重建重新验证路径。

Run 的现有 TaskExecutor、DebugService 和 SDK Manager 捕获同一个 HostGuard。失信、断开或宿主身份不一致时拒绝启动；宿主释放时取消检测、停止自己拥有的任务及调试，不停止其他会话。VS Code 没有单独的通用“远程已断开”事件；依赖其工作区扩展宿主生命周期与 dispose，并提供显式 guard.disconnect。不能保证网络断开瞬间远端进程已停止，不能声称强于 VS Code 宿主管理的保证。

远程只接受工作区侧调试扩展。安装沿用实际进程平台对应的 Homebrew/APT/WinGet，不调用本机包管理器；确认框包含目标主机、OS/架构、安装范围和当前权限。APT 的 root 容器直接使用 apt，非 root 使用 sudo；不会自动授权、添加源或接受许可证。

## 验证

- 原有 npm test：44/44 通过。
- 新增单元/文件系统测试：25/25 通过，覆盖范围、冲突、monorepo、多根工作区、路径/链接边界、缓存迁移、宿主隔离、断开/取消、超时、手动记录保留。
- VS Code **1.85.2** Development Host：macOS ARM64 实测启动、后台扫描、全局 JSON 和 Go 项目版本诊断，发现 Python/Go/Node/C/C++/Rust/Java。
- Windows、Linux、WSL、SSH、Dev Containers：只有路径或宿主模型测试，**未实机验证**。远程调试与包安装未实机执行；不安装系统 SDK 的自动测试不会冒充安装验收。

运行：`npm test`；`node scripts/test-p1.cjs`；`node scripts/integration-p1.cjs p1-a`（先 compile）。集成运行器使用隔离的用户目录、扩展目录、临时项目和当前 worktree 的 VS Code 缓存，不碰 P0 的开发环境。
