import type { DeviceKind } from '../devices/model';

/**
 * A project template describes what a new embedded project is made of. It is not a run-configuration template:
 * PR #1's `ConfigurationTemplate` describes how to run or debug code that already exists; this one describes how to create it.
 */
export interface ProjectTemplate {
  readonly id: string;
  /** English label; translated through `strings.ts`. */
  readonly label: string; readonly description: string;
  readonly backend: 'platformio' | 'stm32';
  /** Device kinds this template accepts. Empty means no device is needed (importing an existing project). */
  readonly deviceKinds: readonly DeviceKind[];
  /** Build system name shown in the wizard and kept in favorite templates. */
  readonly buildSystem: 'platformio' | 'cubemx' | 'existing';
  readonly needsFramework: boolean;
  readonly icon: string;
}

export const builtinProjectTemplates: readonly ProjectTemplate[] = [
  { id: 'platformio.board', label: 'PlatformIO project', description: 'Create a project for a PlatformIO board with the official PlatformIO CLI.', backend: 'platformio', deviceKinds: ['pio-board'], buildSystem: 'platformio', needsFramework: true, icon: 'circuit-board' },
  { id: 'stm32.cubemx', label: 'STM32CubeMX project', description: 'Create the project folder and configure the device in STM32CubeMX. Code generation is done by STM32CubeMX.', backend: 'stm32', deviceKinds: ['stm32-mcu', 'stm32-board'], buildSystem: 'cubemx', needsFramework: false, icon: 'chip' },
  { id: 'stm32.import', label: 'Open existing STM32 project', description: 'Open a folder that already has an .ioc file or an STM32 CMake project.', backend: 'stm32', deviceKinds: [], buildSystem: 'existing', needsFramework: false, icon: 'folder-opened' }
];
