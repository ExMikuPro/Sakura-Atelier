# Embedded development support: plan

Status: draft, tracked by the stacked Draft PRs listed below.

## Goals

PlatformIO and STM32 (STM32CubeMX / STM32 CMake) projects get detection, toolchain discovery, explicit Build / Flash / Debug actions and a read-only `.ioc` viewer, without changing how the existing languages behave.

## Principles

- Additive. New code lives in new modules; `RuntimeAdapter` keeps working as it does today.
- Pure core, thin editor glue. Detection, parsing, tool discovery and plan building take their file system, environment and process runner as parameters, so they are unit-testable without VS Code.
- Language, build system and run target are separate concepts. A project backend combines them.
- Build, Flash and Debug are distinct operations. A plain Run never flashes. Nothing performs a full-chip erase.
- No fixed install paths. Tools come from the user's registry entry, then `PATH`, then hint locations that are only accepted after their layout is validated. Every tool can be located manually.
- Debugging reuses existing VS Code debug extensions. No debug protocol is implemented here.
- Remote workspaces: a remote file path is never handed to a locally installed tool.

## PR stack

Each PR is a Draft and targets `dev`; stacked ones say which PR they build on.

| # | Branch | Content |
|---|--------|---------|
| a | `feat/adapter-registry` | Types extracted from `adapters.ts`, registry for languages, build systems, run targets and project backends. No behaviour change. |
| b | `feat/embedded-toolchain-registry` | Discovery of CubeMX, Cube CLI, CubeCLT, Arm GNU Toolchain, CMake/Ninja, CubeProgrammer, ST-LINK GDB server, PlatformIO. Persistent registry with manual locate. |
| c | `feat/platformio-backend` | `platformio.ini` detection, environments, official-CLI metadata, per-environment templates, Build/Clean/Upload/Debug/Monitor/Test plans. |
| d | `feat/stm32-backend` | STM32CubeMX and STM32 CMake detection, `.ioc` parser, separate Build / Flash / Debug plans. |
| e | `feat/ioc-readonly-editor` | `CustomReadonlyEditorProvider` for `*.ioc`. |

## Test strategy

Fixtures for five project types live under `test/fixtures/embedded`: plain C/C++, STM32 CMake, STM32CubeMX `.ioc`, PlatformIO STM32, PlatformIO non-STM32. Tests use fake file systems, environments and process runners. Without hardware only discovery, build plans and simulated execution can be verified; flashing and hardware debugging are not claimed as verified anywhere.

## Integration with the template registry (PR #1)

PR #1 introduces a typed template registry. The backends here expose their per-environment or per-target configurations as plain descriptors (`id`, `name`, `operation`, parameters). Once #1 lands, a template entry can wrap such a descriptor and call the backend's plan builder; nothing in this stack changes `configuration.ts` or the stored configuration format.
