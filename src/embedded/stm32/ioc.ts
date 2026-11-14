/** Reader for the key=value `.ioc` files written by STM32CubeMX. Read-only; this module never edits or generates one. */
export interface IocInfo {
  /** Exact `Mcu.UserName` (for example `STM32G0B1RETx`). Empty when the file does not state one. */
  mcu: string;
  /** Marketing part number from `Mcu.CPN`, for example `STM32G0B1RET6`. */
  partNumber: string;
  family: string; package: string;
  /** Board name when the project was created from a board (`board=`), otherwise empty. Not a PlatformIO board id. */
  board: string;
  projectName: string;
  /** `ProjectManager.TargetToolchain`, for example `CMake`, `Makefile`, `STM32CubeIDE`. */
  toolchain: string;
}

const maxBytes = 4 * 1024 * 1024;

export function parseIoc(text: string): IocInfo {
  const values = new Map<string, string>();
  for (const line of text.slice(0, maxBytes).split(/\r?\n/)) {
    if (!line || line.startsWith('#')) { continue; }
    const index = line.indexOf('=');
    if (index > 0) { values.set(line.slice(0, index).trim(), line.slice(index + 1).trim()); }
  }
  const get = (key: string) => values.get(key) ?? '';
  const mcu = get('Mcu.UserName') || get('Mcu.Name');
  return { mcu: isStm32Part(mcu) ? mcu : '', partNumber: get('Mcu.CPN'), family: get('Mcu.Family'), package: get('Mcu.Package'), board: get('board'), projectName: get('ProjectManager.ProjectName'), toolchain: get('ProjectManager.TargetToolchain') };
}

/** Shape check only: a recognizable STM32 part name. Does not claim the part exists. */
export function isStm32Part(value: string): boolean { return /^STM32[A-Z][A-Z0-9]{2,}[A-Za-z0-9()\-]*$/.test(value); }
