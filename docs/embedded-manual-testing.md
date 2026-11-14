# Manual test steps (hardware and real tools)

Automated tests use test doubles for CLIs and never need a board. The steps below need real hardware or real vendor tools and have **not** been run by the author.

## STM32 (needs an STM32 board with ST-LINK, STM32CubeCLT or Arm GNU Toolchain + CMake + Ninja, STM32CubeProgrammer, Cortex-Debug)

1. `Sakura Atelier: Embedded Tools...` shows each tool as found, or locate it manually.
2. Open a CubeMX-generated CMake project. Run `STM32: Build`. Expect an ELF under `build/<preset>/`.
3. Run `STM32: Flash`. Pick the ELF, the ST-LINK and confirm the MCU. Expect a modal confirmation naming the file and the MCU, then `STM32_Programmer_CLI` output with a verify and a reset. Confirm in the log that no erase option was passed. Check the program runs on the board.
4. Run `STM32: Debug`. Expect a build, then a Cortex-Debug session that stops at `main`. Set a breakpoint, step, and stop. Verify the Cortex-Debug `stlink` properties (`serverpath`, `gdbPath`, `armToolchainPath`) match your installed version.
5. Double-click an `.ioc` file: the Sakura Atelier page opens and CubeMX does **not** start. Click "Open with STM32CubeMX": CubeMX starts with that project. Check this on Windows, Linux and macOS; the single positional argument form has not been verified.
6. In an SSH/WSL/Dev Container window, open an `.ioc`: the launch button is disabled with an explanation, "Open as text" works.

## PlatformIO (needs a board and the PlatformIO IDE extension for debugging)

1. Create a project with `Sakura Atelier：新建项目`, check `platformio.ini` (board id, framework) and that no `.vscode` folder was written.
2. `PlatformIO: Upload` asks for confirmation, uploads and the board runs the program.
3. `PlatformIO: Serial Monitor` shows the board's output.
4. `PlatformIO: Debug` loads details (a modal warns that PlatformIO may download the platform), then starts the PlatformIO IDE debug session. Check the `platformio-debug` launch configuration against your PlatformIO IDE version.
5. `PlatformIO: Test on Device` runs tests on the board after confirmation.

## Wizard

1. Open the wizard in a VS Code window with no folder open (File > New File... > Sakura Atelier：新建项目, and the command palette).
2. Star a board, close and reopen the wizard: the star is still set. Open a different workspace: the favorite is still listed. Turn Settings Sync on for this extension's state and check the favorite appears on a second machine, with no paths in it.
3. Rename or hide PlatformIO (so it is not found): favorites stay with "工具链未安装"; locating PlatformIO restores the list.
4. Save a favorite project configuration, create the project from it, and check the board, framework and options are restored and a name and folder are asked for.
5. Resize the window narrow: the three columns stack and everything stays usable. Check the dark, light and a custom theme.
