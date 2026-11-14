import * as path from 'node:path';
import { normalizeRef, type DeviceRef } from '../devices/model';

export type CubeMxToolchain = 'CMake' | 'Makefile' | 'STM32CubeIDE';
export type CubeMxScriptMode = '-q' | '-s';
export interface CubeMxGeneration {
  executable: string; root: string; ioc: string; script: string;
  toolchain: CubeMxToolchain; mode: CubeMxScriptMode; device?: DeviceRef; projectName?: string;
}

/** CubeMX has its own script parser. Shell argument quoting alone cannot protect script values. */
export function mxValue(value: string): string {
  if (!value || /[\0\r\n"]/.test(value)) throw new Error('CubeMX names and paths cannot contain quotes, line breaks or NUL.');
  return '"' + value + '"';
}

export function createCubeMxScript(device: DeviceRef, name: string, root: string, toolchain: CubeMxToolchain): { script: string; ioc: string } {
  const ref = normalizeRef(device);
  if (!ref || ref.kind === 'pio-board') throw new Error('Select an STM32 MCU or ST board.');
  const ioc = path.join(root, name + '.ioc');
  return { ioc, script: [
    ref.kind === 'stm32-mcu' ? `load ${ref.id}` : `loadboard ${ref.id} allmodes`,
    `project name ${mxValue(name)}`, `project path ${mxValue(root)}`,
    `project toolchain ${mxValue(toolchain)}`, 'project compiler GCC',
    `config save ${mxValue(ioc)}`, 'project generate', `config save ${mxValue(ioc)}`, 'exit', '',
  ].join('\n') };
}

/** Existing .ioc settings, pinout and USER CODE handling remain owned by CubeMX. */
export function regenerateCubeMxScript(ioc: string, root: string, name: string): string {
  if (!/\.ioc$/i.test(ioc)) throw new Error('Select a classic STM32CubeMX .ioc file.');
  return [`config load ${mxValue(ioc)}`, `project name ${mxValue(name)}`, `project path ${mxValue(root)}`,
    'project toolchain CMake', 'project compiler GCC', `config save ${mxValue(ioc)}`,
    'project generate', `config save ${mxValue(ioc)}`, 'exit', ''].join('\n');
}
