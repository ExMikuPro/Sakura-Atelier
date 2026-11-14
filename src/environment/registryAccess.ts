import type { ToolchainRegistry } from "./toolchainRegistry";
let active: ToolchainRegistry | undefined;
export function hostToolchains(): ToolchainRegistry | undefined {
  return active;
}
export function setHostToolchains(
  registry: ToolchainRegistry | undefined,
): void {
  active = registry;
}
