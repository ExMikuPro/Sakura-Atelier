import * as vscode from "vscode";
import { t } from "./i18n";

/** Localize only extension-owned UI, preserving values and returned action identities. */
type Method =
  | "showErrorMessage"
  | "showWarningMessage"
  | "showInformationMessage"
  | "showQuickPick"
  | "showInputBox"
  | "showOpenDialog"
  | "showSaveDialog";
function localized<K extends Method>(name: K): (typeof vscode.window)[K] {
  return (async (...args: unknown[]) => {
    const originals = new Map<unknown, unknown>();
    const item = (value: unknown): unknown => {
      if (typeof value === "string") {
        const translated = t(value);
        originals.set(translated, value);
        return translated;
      }
      if (value && typeof value === "object") {
        const entry = value as Record<string, unknown>;
        const result = { ...entry };
        const selection = entry.selection as { kind?: string } | undefined;
        for (const key of [
          "label",
          "description",
          "detail",
          "title",
          "prompt",
          "placeHolder",
          "openLabel",
          "saveLabel",
        ]) {
          if (
            typeof result[key] === "string" &&
            !(
              key === "label" &&
              selection &&
              ["managed", "launch", "task"].includes(selection.kind || "")
            )
          ) {
            result[key] = t(result[key] as string);
          }
        }
        if (typeof entry.validateInput === "function") {
          const validate = entry.validateInput as (value: string) => unknown;
          result.validateInput = async (value: string) => {
            const error = await validate(value);
            return typeof error === "string" ? t(error) : error;
          };
        }
        originals.set(result, value);
        return result;
      }
      return value;
    };
    if (name === "showQuickPick") {
      const values = await Promise.resolve(args[0]);
      args[0] = Array.isArray(values) ? values.map(item) : values;
    } else if (typeof args[0] === "string") {
      args[0] = t(args[0]);
    } else {
      args[0] = item(args[0]);
    }
    for (let index = 1; index < args.length; index++) {
      args[index] = item(args[index]);
    }
    const result = await Reflect.apply(
      vscode.window[name],
      vscode.window,
      args,
    );
    return originals.get(result) ?? result;
  }) as (typeof vscode.window)[K];
}
export const ui = {
  showErrorMessage: localized("showErrorMessage"),
  showWarningMessage: localized("showWarningMessage"),
  showInformationMessage: localized("showInformationMessage"),
  showQuickPick: localized("showQuickPick"),
  showInputBox: localized("showInputBox"),
  showOpenDialog: localized("showOpenDialog"),
  showSaveDialog: localized("showSaveDialog"),
};
