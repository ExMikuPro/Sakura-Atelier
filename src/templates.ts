import {
  AtelierConfiguration,
  RuntimeLanguage,
  newConfiguration,
} from "./configuration";

export interface TemplateContext {
  id: string;
  folder: string;
  root: string;
  label: string;
  cwd: string;
  languages: RuntimeLanguage[];
  activeLanguage?: RuntimeLanguage;
  activeFile?: string;
  entries: Partial<Record<RuntimeLanguage, string>>;
  markers: string[];
  scripts: string[];
  tasks: string[];
  examples: string[];
}
export interface ConfigurationTemplate {
  id: string;
  label: string;
  description: string;
  language: RuntimeLanguage;
  group: string;
  icon: string;
  operation: AtelierConfiguration["operation"];
  capabilities: string[];
  requiredToolchain: string;
  fields: string[];
  targetLabel: string;
  matches(context: TemplateContext): boolean;
  defaults(context: TemplateContext): Partial<AtelierConfiguration>;
}
export interface TemplateView extends Omit<
  ConfigurationTemplate,
  "matches" | "defaults"
> {
  configuration: AtelierConfiguration;
  recommended: boolean;
  status: "ready" | "configure" | "missing" | "unchecked";
  reason: string;
}
export const templateGroups = [
  "Go",
  "Rust / Cargo",
  "Python",
  "JavaScript / TypeScript / Node.js",
  "C / C++ / CMake",
  "C# / .NET",
  "Java",
  "General",
];
const groups: Record<string, string> = {
  go: templateGroups[0],
  rust: templateGroups[1],
  python: templateGroups[2],
  node: templateGroups[3],
  javascript: templateGroups[3],
  typescript: templateGroups[3],
  c: templateGroups[4],
  cpp: templateGroups[4],
  csharp: templateGroups[5],
  java: templateGroups[6],
};
const runtimes: Record<string, string> = {
  go: "Go SDK",
  rust: "Cargo / Rust toolchain",
  python: "Python interpreter",
  node: "Node.js runtime",
  javascript: "Node.js runtime",
  typescript: "Node.js + project TypeScript runner",
  c: "C compiler",
  cpp: "C++ compiler",
  csharp: ".NET SDK",
  java: "JDK",
};
const related = (a: string, b: string) =>
  a === b ||
  ([
    "javascript",
    "typescript",
    "node",
    "javascriptreact",
    "typescriptreact",
  ].includes(a) &&
    ["javascript", "typescript", "node"].includes(b));
function define(
  id: string,
  label: string,
  language: RuntimeLanguage,
  description: string,
  fields: string[],
  defaults: ConfigurationTemplate["defaults"],
  options: Partial<
    Pick<
      ConfigurationTemplate,
      | "operation"
      | "group"
      | "icon"
      | "requiredToolchain"
      | "targetLabel"
      | "capabilities"
      | "matches"
    >
  > = {},
): ConfigurationTemplate {
  return {
    id,
    label,
    language,
    description,
    fields,
    defaults,
    operation: "run",
    group: groups[language],
    icon: "play",
    requiredToolchain: runtimes[language],
    targetLabel: "Entry point",
    capabilities: ["run", "debug"],
    matches: (c) => c.languages.some((l) => related(l, language)),
    ...options,
  };
}
const fileDefaults =
  (language: RuntimeLanguage) =>
  (c: TemplateContext): Partial<AtelierConfiguration> => ({
    kind: "file",
    target: c.entries[language] || "",
  });
const cargoDefaults = (c: TemplateContext): Partial<AtelierConfiguration> => ({
  kind: "project",
  target: c.cwd + "/Cargo.toml",
});
const cargoFields = ["package", "binary", "example", "features", "profile"];
const templates: ConfigurationTemplate[] = [
  define(
    "go.application",
    "Go Application",
    "go",
    "Run a package or a Go entry file.",
    ["goToolchain"],
    (c) =>
      c.markers.some((m) => /^go\.(mod|work)$/.test(m))
        ? { kind: "project", target: "." }
        : { kind: "file", target: c.entries.go || "" },
    { targetLabel: "Package / entry file" },
  ),
  define(
    "go.build",
    "Go Build",
    "go",
    "Build a package without running it.",
    ["output", "goToolchain"],
    (c) =>
      c.markers.some((m) => /^go\.(mod|work)$/.test(m))
        ? { kind: "project", target: "." }
        : { kind: "file", target: c.entries.go || "" },
    {
      operation: "build",
      icon: "tools",
      capabilities: ["build"],
      targetLabel: "Package",
    },
  ),
  define(
    "go.test",
    "Go Test",
    "go",
    "Run tests in the selected package tree.",
    ["goToolchain"],
    () => ({ kind: "project", target: "./..." }),
    {
      operation: "test",
      icon: "beaker",
      capabilities: ["test"],
      targetLabel: "Package pattern",
    },
  ),
  define(
    "cargo.run",
    "Cargo Run",
    "rust",
    "Run a Cargo package or binary.",
    cargoFields,
    cargoDefaults,
  ),
  define(
    "cargo.build",
    "Cargo Build",
    "rust",
    "Compile a Cargo package.",
    cargoFields,
    cargoDefaults,
    { operation: "build", icon: "tools", capabilities: ["build"] },
  ),
  define(
    "cargo.test",
    "Cargo Test",
    "rust",
    "Run the Cargo test suite.",
    cargoFields,
    cargoDefaults,
    { operation: "test", icon: "beaker", capabilities: ["test"] },
  ),
  define(
    "cargo.example",
    "Cargo Example",
    "rust",
    "Run a named Cargo example.",
    cargoFields,
    (c) => ({ ...cargoDefaults(c), example: c.examples[0] || "" }),
  ),
  define(
    "python.script",
    "Python Script",
    "python",
    "Run a Python file with its selected interpreter.",
    ["autoActivate"],
    fileDefaults("python"),
    { targetLabel: "Script path" },
  ),
  define(
    "python.module",
    "Python Module",
    "python",
    "Run python -m with a module name.",
    ["autoActivate"],
    () => ({ kind: "module", target: "" }),
    { targetLabel: "Module name" },
  ),
  define(
    "python.pytest",
    "Pytest",
    "python",
    "Use the selected interpreter to run pytest.",
    ["autoActivate"],
    (c) => ({ kind: "project", target: c.cwd }),
    {
      operation: "test",
      icon: "beaker",
      capabilities: ["test"],
      requiredToolchain: "Python interpreter + pytest",
      targetLabel: "Test file / directory",
    },
  ),
  define(
    "node.application",
    "Node.js Application",
    "node",
    "Run a Node.js entry point.",
    [],
    fileDefaults("node"),
  ),
  define(
    "javascript.file",
    "JavaScript File",
    "javascript",
    "Run a JavaScript file using Node.js.",
    [],
    fileDefaults("javascript"),
    { targetLabel: "JavaScript file" },
  ),
  define(
    "typescript.file",
    "TypeScript File",
    "typescript",
    "Run with project tsx, ts-node or a tsc build.",
    ["typescriptRunner", "output"],
    fileDefaults("typescript"),
    { targetLabel: "TypeScript file" },
  ),
  ...(["npm", "pnpm", "yarn"] as const).map((manager) =>
    define(
      `${manager}.script`,
      `${manager} Script`,
      "node",
      `Run an existing package.json script with ${manager}.`,
      ["script"],
      (c) => ({
        kind: "project",
        target: c.cwd,
        packageManager: manager,
        script: c.scripts.includes("start") ? "start" : c.scripts[0] || "",
      }),
      {
        targetLabel: "Package directory",
        requiredToolchain: `Node.js + ${manager}`,
        capabilities: ["run", "linked-debug"],
      },
    ),
  ),
  define(
    "c.file",
    "C File",
    "c",
    "Compile and run C source files.",
    ["standard", "profile"],
    fileDefaults("c"),
    { targetLabel: "C source file" },
  ),
  define(
    "cpp.file",
    "C++ File",
    "cpp",
    "Compile and run C++ source files.",
    ["standard", "profile"],
    fileDefaults("cpp"),
    { targetLabel: "C++ source file" },
  ),
  define(
    "cmake.application",
    "CMake Application",
    "cpp",
    "Configure, build and run an existing CMake target.",
    ["binary", "profile", "output"],
    (c) => ({ kind: "project", target: c.cwd + "/build/atelier", output: "" }),
    {
      targetLabel: "Build directory",
      requiredToolchain: "CMake + C++ compiler",
      matches: (c) => c.markers.includes("CMakeLists.txt"),
    },
  ),
  define(
    "dotnet.application",
    ".NET Application",
    "csharp",
    "Run a startup .csproj.",
    ["framework", "profile", "launchProfile"],
    (c) => ({ kind: "project", target: c.entries.csharp || "" }),
    {
      targetLabel: "Startup project (.csproj)",
      capabilities: ["run", "linked-debug"],
    },
  ),
  define(
    "dotnet.build",
    ".NET Build",
    "csharp",
    "Build a project or solution.",
    ["framework", "profile"],
    (c) => ({ kind: "project", target: c.entries.csharp || "" }),
    {
      operation: "build",
      icon: "tools",
      capabilities: ["build"],
      targetLabel: "Project / solution",
    },
  ),
  define(
    "dotnet.test",
    ".NET Test",
    "csharp",
    "Test a .NET project or solution.",
    ["framework", "profile"],
    (c) => ({ kind: "project", target: c.entries.csharp || "" }),
    {
      operation: "test",
      icon: "beaker",
      capabilities: ["test"],
      targetLabel: "Test project / solution",
    },
  ),
  define(
    "java.application",
    "Java Application",
    "java",
    "Run a JDK source file; link launch.json for debugging.",
    [],
    fileDefaults("java"),
    { targetLabel: "Java source file", capabilities: ["run", "linked-debug"] },
  ),
  define(
    "java.task",
    "Maven / Gradle Task",
    "java",
    "Delegate to an existing foreground VS Code task.",
    [],
    (c) => ({ kind: "task", target: c.tasks[0] || "" }),
    {
      requiredToolchain: "Existing VS Code task",
      capabilities: ["task", "linked-debug"],
      targetLabel: "Task label",
      matches: (c) => c.markers.some((m) => /pom\.xml|gradle/.test(m)),
    },
  ),
  define(
    "general.task",
    "Existing VS Code Task",
    "node",
    "Reuse a foreground task without rewriting tasks.json.",
    [],
    (c) => ({ kind: "task", target: c.tasks[0] || "" }),
    {
      group: "General",
      requiredToolchain: "Existing VS Code task",
      capabilities: ["task", "linked-debug"],
      targetLabel: "Task label",
      matches: (c) => c.tasks.length > 0,
    },
  ),
];
export const templateRegistry: readonly ConfigurationTemplate[] = templates;
export function templateById(id: string): ConfigurationTemplate | undefined {
  return templateRegistry.find((t) => t.id === id);
}
export function createTemplateDraft(
  id: string,
  context: TemplateContext,
  configurationId: string,
): AtelierConfiguration {
  const template = templateById(id);
  if (!template) {
    throw new Error(`Unsupported template: ${id}`);
  }
  return {
    ...newConfiguration(template.language, template.label),
    ...template.defaults(context),
    id: configurationId,
    templateId: id,
    cwd: context.cwd,
    operation: template.operation,
  };
}
export function recommendTemplates(context: TemplateContext): string[] {
  return templateRegistry
    .filter(
      (t) =>
        t.matches(context) ||
        (!!context.activeLanguage &&
          related(context.activeLanguage, t.language)),
    )
    .sort(
      (a, b) =>
        Number(
          !!context.activeLanguage &&
            related(context.activeLanguage, b.language),
        ) -
        Number(
          !!context.activeLanguage &&
            related(context.activeLanguage, a.language),
        ),
    )
    .map((t) => t.id);
}
