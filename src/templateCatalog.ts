import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as vscode from "vscode";
import {
  AtelierConfiguration,
  LocalToolchain,
  RuntimeLanguage,
  portablePath,
} from "./configuration";
import {
  TemplateContext,
  TemplateView,
  createTemplateDraft,
  recommendTemplates,
  templateRegistry,
} from "./templates";
import { ProjectRecord } from "./projects";
import { contained, exists, readProjectFile } from "./detect";
import { firstTool } from "./tools";

const extensions: Partial<Record<RuntimeLanguage, RegExp>> = {
  python: /\.py$/,
  go: /\.go$/,
  rust: /\.rs$/,
  node: /\.[cm]?js$/,
  javascript: /\.[cm]?js$/,
  typescript: /\.[cm]?ts$/,
  javascriptreact: /\.jsx$/,
  typescriptreact: /\.tsx$/,
  c: /\.c$/,
  cpp: /\.(cpp|cc|cxx)$/,
  csharp: /\.csproj$/,
  java: /\.java$/,
};
export function projectContexts(
  folders: readonly vscode.WorkspaceFolder[],
  projects: ProjectRecord[],
): Omit<TemplateContext, "entries" | "scripts" | "tasks" | "examples">[] {
  const map = new Map<
    string,
    Omit<TemplateContext, "entries" | "scripts" | "tasks" | "examples">
  >();
  for (const folder of folders) {
    for (const root of [
      folder.uri.fsPath,
      ...projects
        .filter((p) => p.folder.uri.toString() === folder.uri.toString())
        .map((p) => p.root),
    ]) {
      const id = folder.uri.toString() + "::" + root;
      if (map.has(id)) {
        continue;
      }
      const records = projects.filter(
        (p) =>
          p.folder.uri.toString() === folder.uri.toString() && p.root === root,
      );
      const relative = path.relative(folder.uri.fsPath, root);
      map.set(id, {
        id,
        folder: folder.uri.toString(),
        root,
        label: folder.name + (relative ? " / " + relative : ""),
        cwd: portablePath(root, folder.uri.fsPath),
        languages: [...new Set(records.flatMap((p) => p.languages))],
        markers: records.map((p) => p.marker),
      });
    }
  }
  return [...map.values()];
}
export async function templateContext(
  summary: ReturnType<typeof projectContexts>[number],
  folder: vscode.WorkspaceFolder,
  active?: { file: string; language: RuntimeLanguage },
): Promise<TemplateContext> {
  if (!(await contained(folder.uri.fsPath, summary.root))) {
    throw new Error(
      "Template project must remain inside its workspace folder.",
    );
  }
  const entries: TemplateContext["entries"] = {};
  const candidates: string[] = [];
  // Deliberately shallow and metadata-only. Never run Cargo, npm, Python or a task here.
  for (const directory of ["", "src"]) {
    const dir = path.join(summary.root, directory);
    if (!(await contained(folder.uri.fsPath, dir))) {
      continue;
    }
    for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort(
      (a, b) =>
        Number(/^main\.|^index\./.test(b.name)) -
          Number(/^main\.|^index\./.test(a.name)) ||
        a.name.localeCompare(b.name),
    )) {
      if (entry.isFile()) candidates.push(path.join(dir, entry.name));
    }
  }
  for (const [language, pattern] of Object.entries(extensions)) {
    const match = candidates.find((file) => pattern.test(file));
    if (match) {
      entries[language as RuntimeLanguage] = portablePath(
        match,
        folder.uri.fsPath,
      );
    }
  }
  const activeWithin =
    active &&
    (await exists(active.file)) &&
    (await contained(summary.root, active.file)) &&
    extensions[active.language]?.test(active.file);
  if (activeWithin) {
    entries[active.language] = portablePath(active.file, folder.uri.fsPath);
    if (active.language === "javascript") entries.node = entries.javascript;
  }
  let scripts: string[] = [];
  const source = await readProjectFile(summary.root, "package.json");
  if (source) {
    try {
      const pkg = JSON.parse(source);
      scripts = Object.keys(pkg.scripts || {}).filter(
        (key) => typeof pkg.scripts[key] === "string",
      );
      const entry =
        typeof pkg.main === "string"
          ? path.resolve(summary.root, pkg.main)
          : "";
      if (
        entry &&
        (await contained(summary.root, entry)) &&
        (await exists(entry))
      ) {
        entries.node = portablePath(entry, folder.uri.fsPath);
      }
    } catch {
      /* Malformed metadata does not block other language templates. */
    }
  }
  const exampleDirectory = path.join(summary.root, "examples");
  const examples = (
    (await contained(summary.root, exampleDirectory))
      ? await fs
          .readdir(exampleDirectory, { withFileTypes: true })
          .catch(() => [])
      : []
  )
    .filter((e) => e.isFile() && e.name.endsWith(".rs"))
    .map((e) => e.name.slice(0, -3));
  return {
    ...summary,
    entries,
    scripts,
    tasks: await (await import("./launchConfigurations")).taskLabels(folder),
    examples,
    ...(activeWithin
      ? { activeFile: active.file, activeLanguage: active.language }
      : {}),
  };
}
export function matchingToolchains(
  language: RuntimeLanguage,
  tools: LocalToolchain[],
): LocalToolchain[] {
  return tools.filter(
    (t) =>
      t.language === language ||
      (t.language === "node" &&
        [
          "javascript",
          "typescript",
          "javascriptreact",
          "typescriptreact",
        ].includes(language)),
  );
}
const probes: Record<string, string[]> = {
  go: ["go"],
  rust: ["cargo"],
  python:
    process.platform === "win32"
      ? ["python", "python3"]
      : ["python3", "python"],
  node: ["node"],
  javascript: ["node"],
  typescript: ["node"],
  c: ["clang", "gcc", "cl"],
  cpp: ["clang++", "g++", "cl"],
  csharp: ["dotnet"],
  java: ["java"],
};
export async function templateViews(
  context: TemplateContext,
  tools: LocalToolchain[],
  trusted: boolean,
  defaultSdk: (language: RuntimeLanguage) => string,
): Promise<TemplateView[]> {
  const recommended = recommendTemplates(context);
  const found = new Map<string, Promise<boolean>>();
  const probe = (names: string[]) => {
    const key = names.join("|");
    let result = found.get(key);
    if (!result) {
      result = firstTool(names, context.root).then(
        () => true,
        () => false,
      );
      found.set(key, result);
    }
    return result;
  };
  return Promise.all(
    templateRegistry.map(async (template) => {
      const {
        defaults: _defaults,
        matches: _matches,
        ...descriptor
      } = template;
      // Avoid serializing functions or machine-specific SDK paths into project data.
      void _defaults;
      void _matches;
      const configuration = createTemplateDraft(
        template.id,
        context,
        "template-draft",
      );
      let status: TemplateView["status"] = "unchecked";
      let reason = "Toolchain has not been checked.";
      const sdk =
        matchingToolchains(template.language, tools).find(
          (t) => t.id === defaultSdk(template.language),
        ) || matchingToolchains(template.language, tools)[0];
      if (sdk) {
        configuration.toolchain = "${toolchain:" + sdk.id + "}";
        if (sdk.rustToolchain) configuration.rustToolchain = sdk.rustToolchain;
      }
      if (configuration.kind === "task") {
        status = configuration.target ? "ready" : "configure";
        reason = configuration.target
          ? "Existing task selected; its own toolchain applies."
          : "Create or select an existing foreground VS Code task.";
      } else if (trusted) {
        const available = sdk
          ? await probe([sdk.executable])
          : await probe(probes[template.language]);
        status = available ? "unchecked" : "missing";
        reason = available
          ? "Executable located; Run validates its version and dependencies."
          : `${template.requiredToolchain} not configured or not found on PATH.`;
        if (available && sdk?.version) {
          status = "ready";
          reason =
            "Configured SDK. Run validates the target and installed dependencies.";
        }
        if (template.id === "cmake.application" && !(await probe(["cmake"]))) {
          status = "missing";
          reason = "CMake is not installed or not on PATH.";
        }
        if (template.id === "typescript.file") {
          const runner = [
            "node_modules/tsx/dist/cli.mjs",
            "node_modules/ts-node/dist/bin.js",
            "node_modules/typescript/bin/tsc",
          ];
          const results = await Promise.all(
            runner.map((p) => exists(path.join(context.root, p))),
          );
          const index = results.indexOf(true);
          if (index >= 0) {
            configuration.typescriptRunner = (
              ["tsx", "ts-node", "tsc"] as const
            )[index];
          } else if (status !== "missing") {
            status = "configure";
            reason =
              "Select a project script or install a project tsx / ts-node / TypeScript dependency.";
          }
        }
        if (
          ["npm.script", "pnpm.script", "yarn.script"].includes(template.id) &&
          !(await probe([configuration.packageManager]))
        ) {
          status = "missing";
          reason = `${configuration.packageManager} CLI not found. Select an existing VS Code task for Windows batch wrappers.`;
        }
        if (template.id === "python.pytest" && status !== "missing") {
          status = "unchecked";
          reason =
            "Python is available; pytest must be installed in the chosen environment.";
        }
      } else {
        reason = "Workspace trust is required to check or run toolchains.";
      }
      if (
        status !== "missing" &&
        (!configuration.target ||
          (template.id === "cargo.example" && !configuration.example) ||
          (template.id.endsWith(".script") &&
            template.language === "node" &&
            !configuration.script) ||
          (template.id === "cmake.application" && !configuration.output) ||
          (configuration.typescriptRunner === "tsc" &&
            template.id === "typescript.file"))
      ) {
        status = "configure";
        reason =
          "Choose the entry, script or output in the configuration form.";
      }
      if (
        status !== "missing" &&
        template.language === "rust" &&
        !context.markers.includes("Cargo.toml")
      ) {
        status = "configure";
        reason = "Choose a Cargo project containing Cargo.toml.";
      }
      if (
        status !== "missing" &&
        template.id === "cmake.application" &&
        !context.markers.includes("CMakeLists.txt")
      ) {
        status = "configure";
        reason =
          "Choose an existing CMake project and its actual output executable.";
      }
      return {
        ...descriptor,
        configuration,
        recommended: recommended.includes(template.id),
        status,
        reason,
      };
    }),
  );
}
export function templateRecent(previous: string[], id: string): string[] {
  return [id, ...previous.filter((value) => value !== id)]
    .filter((value) => templateRegistry.some((t) => t.id === value))
    .slice(0, 6);
}
export function templateFieldSet(
  c: AtelierConfiguration,
): string[] | undefined {
  return templateRegistry.find((t) => t.id === c.templateId)?.fields;
}
