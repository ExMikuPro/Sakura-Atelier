import * as vscode from "vscode";
import { resolveLanguage, translate } from "./localization";
export function language() {
  return resolveLanguage(
    vscode.workspace
      ?.getConfiguration?.("sakuraAtelier")
      .get<string>("language", "zh-cn"),
    vscode.env?.language,
  );
}
export function t(message: string, ...args: unknown[]): string {
  return translate(language(), message, ...args);
}
