import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { contained, within, readProjectFile } from "../detect";
import { EnvironmentError, message, ProjectScope } from "./model";

export function pathWithin(
  root: string,
  file: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const p = platform === "win32" ? path.win32 : path.posix;
  const relative = p.relative(root, file);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(".." + p.sep) &&
      !p.isAbsolute(relative))
  );
}
export async function projectScope(
  workspaces: readonly string[],
  file: string,
): Promise<ProjectScope> {
  const target = await fs.realpath(file);
  const candidates = (
    await Promise.all(
      workspaces.map((root) => fs.realpath(root).catch(() => undefined)),
    )
  )
    .filter((root): root is string => !!root && within(root, target))
    .sort((a, b) => b.length - a.length);
  for (const workspace of candidates) {
    if (await contained(workspace, target)) {
      const stat = await fs.stat(target);
      return {
        workspace,
        root: stat.isDirectory() ? target : path.dirname(target),
      };
    }
  }
  throw new EnvironmentError(
    message("scope.outside", "目标不属于当前工作区，已拒绝读取。"),
  );
}
export async function metadata(
  root: string,
  name: string,
): Promise<string | undefined> {
  const file = path.resolve(root, name);
  if (!within(root, file)) {
    throw new EnvironmentError(
      message("metadata.outside", "元数据路径越过了项目边界。"),
    );
  }
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) return undefined;
    if (stat.size > 1024 * 1024) {
      throw new EnvironmentError(
        message("metadata.large", "项目元数据超过 1 MiB，未自动解析。", {
          file: name,
        }),
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  return readProjectFile(root, name);
}
export async function fingerprint(
  root: string,
  names: readonly string[],
  extra = "",
): Promise<string> {
  const hash = createHash("sha256").update(extra);
  for (const name of [...new Set(names)].sort()) {
    hash
      .update(name + "\0")
      .update((await metadata(root, name)) ?? "\0missing");
  }
  return hash.digest("hex");
}
export async function parents(scope: ProjectScope): Promise<string[]> {
  if (!(await contained(scope.workspace, scope.root)))
    throw new EnvironmentError(
      message("scope.outside", "项目根目录不属于工作区。"),
    );
  const result: string[] = [];
  let root = await fs.realpath(scope.root);
  const boundary = await fs.realpath(scope.workspace);
  for (let i = 0; i < 64 && within(boundary, root); i++) {
    result.push(root);
    if (root === boundary) break;
    root = path.dirname(root);
  }
  return result;
}
/** Static TOML scalar only. Complex/dynamic TOML is deliberately not interpreted as an exact version. */
export function tomlValue(
  text: string,
  section: string,
  key: string,
): string | undefined {
  let current = "";
  for (const raw of text.split(/\r?\n/)) {
    const heading = raw.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/);
    if (heading) {
      current = heading[1].trim();
      continue;
    }
    if (current !== section) continue;
    const assignment = raw.match(/^\s*([\w.-]+)\s*=\s*(.*?)\s*$/);
    if (assignment?.[1] !== key) continue;
    const value = assignment[2];
    const quoted = value.match(/^(['"])(.*?)\1\s*(?:#.*)?$/);
    if (quoted) return quoted[2];
    if (/^\d+(?:\.\d+)*\s*(?:#.*)?$/.test(value))
      return value.split("#")[0].trim();
    const inline = value.match(
      /^\{\s*version\s*=\s*(['"])(.*?)\1\s*\}\s*(?:#.*)?$/,
    );
    if (inline) return inline[2];
    return "unknown:" + value;
  }
  return undefined;
}
export function jsonObject(text: string): Record<string, unknown> {
  const value = JSON.parse(text);
  if (!value || Array.isArray(value) || typeof value !== "object")
    throw new Error("JSON 元数据必须是对象。");
  return value;
}
