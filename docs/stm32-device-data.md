# STM32 device data: sources and limits

Sakura Atelier models STM32 devices separately from PlatformIO boards:

| Kind | Example | Meaning |
|------|---------|---------|
| `stm32-mcu` | `STM32G0B1RETx` | A chip. Not a PlatformIO board. |
| `stm32-board` | `NUCLEO-G071RB` | An ST board. Not a PlatformIO board id. |
| `pio-board` | `nucleo_g071rb` | The id PlatformIO uses in `board =`. |

The three never convert into each other by guessing. A project that needs a PlatformIO board must be given one explicitly.

## What the official tools provide

No documented, stable ST interface enumerates STM32 MCUs or boards:

- STM32CubeMX keeps an internal database in its install folder. Its layout is private and version dependent, so Sakura Atelier does not read it.
- STM32CubeProgrammer, STM32CubeCLT and the Arm GNU Toolchain have no list command for parts.

So Sakura Atelier does not ship, guess or invent an MCU list or chip parameters.

## What it does instead

1. Lists MCUs and boards named by `.ioc` files in the open workspaces (written by STM32CubeMX). An MCU and a board are linked only when the same `.ioc` states both.
2. Accepts a part number or board name you type, only when it has the right shape. Star it once and it is kept in your favorites.
3. Takes more sources through the `DeviceProvider` interface (`DeviceCatalog.add`): a vendor database for another MCU family, or ST data if ST documents an interface.
