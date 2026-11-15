# STM32 器件数据来源与边界说明

Sakura Atelier 严格区分芯片型号与不同生态的开发板标识，避免因隐式猜测导致工程配置错误：

| 类型标识 | 示例 | 含义与边界 |
| :--- | :--- | :--- |
| `stm32-mcu` | `STM32G0B1RETx` | ST 芯片具体型号（用于 STM32CubeMX / STM32 工程） |
| `stm32-board` | `NUCLEO-G071RB` | ST 官方开发板名称（不等同于 PlatformIO 开发板 ID） |
| `pio-board` | `nucleo_g071rb` | PlatformIO 使用的 `board =` 标识符 |

## 本地数据解析来源

1. **本机 STM32CubeMX 数据库**：自动读取已安装 STM32CubeMX 目录下的 `db/mcu/families.xml`（MCU 列表）与 `db/plugins/boardmanager/*.pdsc`（开发板与 `mountedDevice` 映射）。扩展安装包内不内置厂商数据库。
2. **工作区 `.ioc` 文件**：扫描当前打开工作区中的 `.ioc` 文件并提取其中声明的 MCU 与开发板型号。
3. **手动输入型号**：支持在向导中输入符合命名规范的 STM32 型号，校验通过后可直接收藏并用于创建工程。

## 查找与刷新机制

- **内存检索与容错**：器件列表加载后在内存中实时过滤，不重复读取磁盘 XML；若 CubeMX 版本目录结构不兼容或未安装，自动平滑回退至工作区 `.ioc` 记录与手动输入模式。
- **自定义路径**：在 macOS 上默认探测 `/Applications/STMicroelectronics/STM32CubeMX.app`；若安装在自定义位置，请先在 **Embedded Tools → STM32CubeMX → Locate…** 中指定路径，再于新建向导中点击 **重新加载器件（Reload devices）**。