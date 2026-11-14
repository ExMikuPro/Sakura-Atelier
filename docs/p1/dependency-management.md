# P1-C：多语言依赖诊断与显式修复

堆叠于 P1-B、P1-A；三个 PR 都面向 dev，不自动合并，版本仍为 0.1.0。新增服务不修改 P0 前端。

## 接口与证据

`createProjectDependencyServices({python,node})` 返回 service、runner、dispose。Python/Node 来自当前运行配置，不产生新的全局选择状态。

`ProjectDependencyService.diagnose(file, workspaces, {checkInstalled,signal})` 返回 DependencyStatus[]；subscribe 接收重新扫描结果。每个 DependencyAdapter 区分声明、锁文件和校验和。一个项目目录可返回多种生态；monorepo 各子项目可复用现有项目清单逐项调用。

- Go：go.mod/go.work 是声明，go.sum 是校验和，不是版本锁。
- Rust：Cargo.toml 是声明，Cargo.lock 是锁。
- Python：pyproject.toml、requirements.txt、Pipfile、environment.yml；区分 uv/Poetry/Pipenv/Conda。
- Node/JS/TS：package.json 声明，识别 npm/pnpm/yarn/bun 锁和 packageManager；多个管理器或 npm 根依赖声明与锁不一致时返回 Conflict。
- C#：csproj/sln/slnx 与 packages.lock.json/NuGet。
- Java/Kotlin：Maven pom、Gradle/Groovy/Kotlin DSL。
- C/C++：vcpkg 和 Conan 声明；不执行 Conan Python 文件。

只有存在可靠证据才返回 Ready。当前 `checkInstalled` 的 npm 检查使用 `npm ls --all --json --ignore-scripts --offline`，按退出码及 problems 结构区分就绪、缺失/不兼容与查询失败。其他生态目前保持 Unknown，而不是用文件存在或文本搜索猜测“已安装”。无工具返回 managerMissing 诊断；它与“依赖缺失”不同。元数据解析失败明确返回 Error/抛出有界读取错误。

## 修复能力

命令先签发为计划，确认前后校验全部声明/锁文件指纹（包括新出现的锁、二进制 bun.lockb）和工具选择，再用已有独立 TaskExecutor 执行。原生模态框展示目标主机、系统架构、工作目录、命令参数、可能修改文件及安装脚本风险。拒绝时不执行。超时/取消/重复执行使用 P1-B 的同一 RemediationRunner；只停止自己创建的执行器。完成、取消或运行失败后重新扫描。

| 生态 | 当前计划 | 限制 |
| --- | --- | --- |
| Go | go mod download | 显示 go.sum 与模块缓存影响；GOTOOLCHAIN=local |
| Cargo | cargo fetch --locked | 没有 Cargo.lock 不自动生成锁 |
| Python uv | uv sync --locked --no-python-downloads --python 所选解释器 | 要求 uv.lock；可修改 .venv，明确确认 |
| Python pip | 所选 Python -m pip install --require-virtualenv -r requirements.txt | 拒绝装入系统 Python；不保证 requirements 的所有包已锁定 |
| npm | npm ci | 要求 npm 锁；会替换 node_modules，确认框列出该目录 |
| pnpm | pnpm install --frozen-lockfile | 依据实际已安装 CLI，失败不静默换管理器 |
| Yarn | install --frozen-lockfile / --immutable | 需 packageManager 明确主版本；不猜 Yarn 版本 |
| Bun | install --frozen-lockfile | 要求 bun.lock 或 bun.lockb |
| .NET | dotnet restore 明确项目/解决方案 [--locked-mode] | 多个入口时不猜默认入口 |
| Maven | mvn dependency:go-offline | 可能执行插件/项目代码，明确确认 |
| Gradle | gradle --no-daemon dependencies | 只准备依赖报告所需内容，不等同所有后续任务离线就绪 |

Poetry/Pipenv/Conda/vcpkg/Conan 本阶段仅检测和诊断，没有未经验证的自动修复命令。缺锁时不静默运行可能重写锁的通用 install。项目包装器、Windows cmd/bat 不拼接到 shell 执行；npm 可以用所选 Node + 已安装 npm-cli.js 安全执行，其他仅有脚本包装器的工具会提示缺少可安全执行的入口。构建脚本或包管理器自身可能修改额外缓存，计划不宣称能沙箱化第三方工具；用户必须在原生确认框授权。

没有自动 npm/corepack/bootstrap/系统 SDK 安装。不会自动切换 SDK、修改 PATH、用户设置、launch.json/tasks.json 或扩展依赖锁文件。

## 验证与复现

- 原有 npm test：44/44。
- P1 总新增测试：50/50，覆盖 A/B/C；C 包括锁角色/冲突、官方结构化查询、缺工具、无效元数据、用户拒绝、新锁使计划失效、多根隔离、取消/断开、Node 参数前缀。
- macOS ARM64 / VS Code 1.85.2 Development Host：所选 Node + npm JS 入口、空项目 Ready、确实缺失依赖 Missing、Go/Cargo 声明 Unknown、只读诊断不创建 node_modules。
- 原有基础 Host 回归 16/16 通过，Java 明确指定已安装的 Homebrew JDK 17；PATH 的 /usr/bin/java 占位程序首次运行失败，未改系统设置。
- 原有高级 Host 回归 18 项通过、6 项未验证：实测内置 JavaScript Debug 断点/变量/步进、TypeScript source maps、会话归属 Stop、preLaunchTask 失败阻止 Debug、Go/Cargo Run/Test、Python 解释器切换、只读 Homebrew 查询。
- Python Debug/官方激活、Go Delve、Rust CodeLLDB、CMake、.NET、多种实际 Node 版本缺依赖或条件，未实测。pnpm 项目脚本测试使用测试包装器，不等于 pnpm 安装验收。
- Linux/Windows/WSL/SSH/Dev Containers：仅模型/路径测试，未实机验证。没有实际安装系统 SDK 或执行联网依赖修复。

命令：`npm test`、`node scripts/test-p1.cjs`、`node scripts/integration-p1.cjs p1-c`。原有集成用 `npm run test:integration`；高级回归用 `SAKURA_TEST_SUITE=advanced npm run test:integration`。需要 Java 时，SAKURA_TEST_JAVA_BIN 指向 **bin 目录**。

P0 集成步骤：调用 diagnose 展示 diagnostics 与 remediation 摘要；用户点击操作后传 plan.id 给 runner.execute；订阅状态并在页面释放时 dispose。不要接受 Webview 提供的任意可执行命令。三个后台服务文件提供中文消息 code/参数，P0 可使用自己的统一本地化资源。

官方命令依据：[npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/)、[npm ls](https://docs.npmjs.com/cli/v11/commands/npm-ls/)、[Cargo fetch](https://doc.rust-lang.org/cargo/commands/cargo-fetch.html)、[uv CLI](https://docs.astral.sh/uv/reference/cli/)、[pnpm install](https://pnpm.io/cli/install)。
