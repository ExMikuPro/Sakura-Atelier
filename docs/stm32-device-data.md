# STM32 device data: sources and limits

Sakura Atelier models STM32 devices separately from PlatformIO boards:

| Kind | Example | Meaning |
|------|---------|---------|
| `stm32-mcu` | `STM32G0B1RETx` | A chip. Not a PlatformIO board. |
| `stm32-board` | `NUCLEO-G071RB` | An ST board. Not a PlatformIO board id. |
| `pio-board` | `nucleo_g071rb` | The id PlatformIO uses in `board =`. |

The three never convert into each other by guessing. A project that needs a PlatformIO board must be given one explicitly.

## Local data sources

1. Reads names from your installed STM32CubeMX: `db/mcu/families.xml` for MCUs and `db/plugins/boardmanager/*.pdsc` for boards. Board-to-MCU links use explicit `mountedDevice` records. The database stays on your machine and is never included in the extension package.
2. Lists MCUs and boards named by `.ioc` files in the open workspaces. An MCU and a board are linked only when the same `.ioc` states both.
3. Accepts a part number or board name you type, only when it has the right shape. Star it once and it is kept in your favorites.

CubeMX's installation layout is version dependent, not a stable public API. Unsupported or absent files fall back to workspace records and manual entry; no chip parameters are inferred. XML is read as text with bounded file sizes, without entity expansion or network access. Device search uses the in-memory catalog rather than rereading the database.

On macOS, discovery includes `/Applications/STMicroelectronics/STM32CubeMX.app`. For a custom installation use **Embedded Tools → STM32CubeMX → Locate…**, then **Reload devices** in the new-project wizard. Use the **STM32 MCU**, **STM32 boards**, or **All devices** tab to browse beyond favorites.
