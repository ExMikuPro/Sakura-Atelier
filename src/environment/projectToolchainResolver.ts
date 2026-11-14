import * as path from "node:path";
import * as fs from "node:fs/promises";
import { findProject } from "../detect";
import type { Language } from "../model";
import {
  metadata,
  parents,
  projectScope,
  tomlValue,
  jsonObject,
} from "./metadata";
import { compare, numericVersion, satisfies, conflicting } from "./versions";
import {
  DiagnosticState,
  DiscoveredToolchain,
  EnvironmentStatus,
  EnvironmentMessage,
  ProjectScope,
  ToolchainCandidate,
  ToolchainDiagnostic,
  ToolchainLanguage,
  ToolchainRequirement,
  message,
} from "./model";

export interface ToolchainResolutionRequest {
  file: string;
  workspaces: readonly string[];
  language?: ToolchainLanguage;
  toolchains: readonly DiscoveredToolchain[];
  discoveryComplete?: boolean;
  profile?: string;
}
const names = [
  ".python-version",
  "pyproject.toml",
  ".tool-versions",
  "mise.toml",
  "go.mod",
  "go.work",
  "rust-toolchain",
  "rust-toolchain.toml",
  "Cargo.toml",
  ".nvmrc",
  ".node-version",
  "package.json",
  "global.json",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  ".sdkmanrc",
  ".java-version",
  "CMakePresets.json",
  "CMakeLists.txt",
];
const fileLanguage: Record<string, ToolchainLanguage> = {
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".js": "node",
  ".jsx": "node",
  ".ts": "node",
  ".tsx": "node",
  ".mjs": "node",
  ".cjs": "node",
  ".mts": "node",
  ".cts": "node",
  ".cs": "csharp",
  ".java": "java",
  ".kt": "java",
  ".c": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cxx": "cpp",
};
const configLanguage: Partial<Record<ToolchainLanguage, Language>> = {
  node: "javascript",
  python: "python",
  go: "go",
  rust: "rust",
  c: "c",
  cpp: "cpp",
  csharp: "csharp",
  java: "java",
};
const canonical = (language: string): ToolchainLanguage | undefined =>
  ["javascript", "javascriptreact", "typescript", "typescriptreact"].includes(
    language,
  )
    ? "node"
    : [
          "python",
          "go",
          "rust",
          "node",
          "c",
          "cpp",
          "csharp",
          "java",
          "cmake",
        ].includes(language)
      ? (language as ToolchainLanguage)
      : undefined;
interface Parsed {
  requirements: ToolchainRequirement[];
  diagnostics: EnvironmentMessage[];
}
export function parseToolchainFile(
  name: string,
  text: string,
  source = name,
): Parsed {
  const requirements: ToolchainRequirement[] = [];
  const diagnostics: EnvironmentMessage[] = [];
  const add = (
    language: ToolchainLanguage,
    field: string,
    value: string | undefined,
    kind: ToolchainRequirement["kind"] = "version",
    syntax: ToolchainRequirement["syntax"] = "range",
    extra: Partial<ToolchainRequirement> = {},
  ) => {
    if (value?.trim()) {
      requirements.push({
        language,
        source,
        field,
        expression: value.trim(),
        kind,
        syntax,
        role: "required",
        ...extra,
      });
    }
  };
  const pin = (
    language: ToolchainLanguage,
    field: string,
    value: string | undefined,
  ) => add(language, field, value, "version", "prefix");
  try {
    if (name === ".python-version")
      pin(
        "python",
        "python",
        text
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter((s) => s && !s.startsWith("#"))
          .join(" || "),
      );
    if (name === ".node-version" || name === ".nvmrc")
      pin("node", "node", text.replace(/#.*$/gm, "").trim());
    if (name === ".java-version")
      pin("java", "java", text.trim().replace(/-(?:[a-zA-Z].*)$/, ""));
    if (name === ".sdkmanrc") {
      const value = text.match(/^\s*java\s*=\s*([^\s#]+)/m)?.[1];
      pin("java", "java", value?.replace(/-[a-zA-Z].*$/, ""));
    }
    if (name === ".tool-versions")
      for (const line of text.split(/\r?\n/)) {
        const match = line
          .replace(/#.*$/, "")
          .trim()
          .match(/^(python|nodejs|node|golang|go|java)\s+(.+)$/);
        if (match) {
          const language =
            ({ nodejs: "node", golang: "go" } as Record<string, string>)[
              match[1]
            ] ?? match[1];
          pin(
            language as ToolchainLanguage,
            match[1],
            match[2].split(/\s+/).join(" || "),
          );
        }
      }
    if (name === "mise.toml")
      for (const [key, language] of [
        ["python", "python"],
        ["go", "go"],
        ["node", "node"],
        ["java", "java"],
      ] as const) {
        pin(language, `tools.${key}`, tomlValue(text, "tools", key));
      }
    if (name === "pyproject.toml")
      add(
        "python",
        "project.requires-python",
        tomlValue(text, "project", "requires-python"),
      );
    if (name === "go.mod" || name === "go.work") {
      add(
        "go",
        "go",
        text
          .match(/^\s*go\s+(\d+(?:\.\d+){1,2})\s*(?:\/\/.*)?$/m)?.[1]
          ?.replace(/^/, ">="),
      );
      add(
        "go",
        "toolchain",
        text.match(/^\s*toolchain\s+go([^\s]+)/m)?.[1],
        "version",
        "prefix",
        { role: "preferred" },
      );
    }
    if (name === "Cargo.toml") {
      add(
        "rust",
        "package.rust-version",
        tomlValue(text, "package", "rust-version")?.replace(/^/, ">="),
      );
      add(
        "rust",
        "workspace.package.rust-version",
        tomlValue(text, "workspace.package", "rust-version")?.replace(
          /^/,
          ">=",
        ),
      );
    }
    if (name === "rust-toolchain" || name === "rust-toolchain.toml") {
      const channel =
        name.endsWith(".toml") || text.trim().startsWith("[")
          ? tomlValue(text, "toolchain", "channel")
          : text.trim();
      if (channel)
        add(
          "rust",
          "toolchain.channel",
          channel,
          /^\d/.test(channel) ? "version" : "channel",
          /^\d/.test(channel) ? "prefix" : "literal",
        );
      const custom = tomlValue(text, "toolchain", "path");
      if (custom)
        add("rust", "toolchain.path", custom, "toolchain-file", "literal");
    }
    if (name === "package.json") {
      const pkg = jsonObject(text);
      const engines = pkg.engines as Record<string, unknown> | undefined;
      if (typeof engines?.node === "string")
        add("node", "engines.node", engines.node);
    }
    if (name === "global.json") {
      const sdk = jsonObject(text).sdk as Record<string, unknown> | undefined;
      if (typeof sdk?.version === "string")
        add("csharp", "sdk.version", sdk.version, "version", "dotnet", {
          options: {
            rollForward:
              typeof sdk.rollForward === "string" ? sdk.rollForward : "patch",
            allowPrerelease:
              typeof sdk.allowPrerelease === "boolean"
                ? sdk.allowPrerelease
                : true,
          },
        });
    }
    if (name === "pom.xml") {
      const properties = new Map<string, string>();
      const block =
        text.match(/<properties>([\s\S]*?)<\/properties>/)?.[1] ?? "";
      for (const match of block.matchAll(/<([\w.-]+)>\s*([^<>]+?)\s*<\/\1>/g))
        properties.set(match[1], match[2]);
      const value = text
        .match(
          /<(?:maven\.compiler\.release|maven\.compiler\.target|java\.version)>\s*([^<]+)\s*<\//,
        )?.[1]
        ?.trim();
      const resolved = value?.replace(
        /\$\{([^}]+)\}/g,
        (_, key) => properties.get(key) ?? `unknown:${key}`,
      );
      pin("java", "Java release", resolved?.replace(/^1\.(\d+)$/, "$1"));
    }
    if (name === "build.gradle" || name === "build.gradle.kts") {
      const versions = [
        ...text.matchAll(/JavaLanguageVersion\.of\(\s*(\d+)\s*\)/g),
      ].map((m) => m[1]);
      for (const value of versions)
        pin("java", "java.toolchain.languageVersion", value);
      if (!versions.length && /\btoolchain\s*\{/.test(text))
        add("java", "java.toolchain", "unknown:dynamic-gradle");
    }
    if (name === "CMakePresets.json") {
      const document = jsonObject(text);
      const presets = document.configurePresets;
      if (Array.isArray(presets))
        for (const preset of presets) {
          if (!preset || typeof preset.name !== "string") continue;
          const vars = preset.cacheVariables ?? {};
          const value = (key: string) =>
            typeof vars[key] === "string"
              ? vars[key]
              : typeof vars[key]?.value === "string"
                ? vars[key].value
                : undefined;
          for (const [lang, key] of [
            ["c", "CMAKE_C_COMPILER"],
            ["cpp", "CMAKE_CXX_COMPILER"],
          ] as const) {
            add(lang, key, value(key), "executable", "literal", {
              profile: preset.name,
            });
          }
          if (typeof preset.toolchainFile === "string")
            add(
              "cpp",
              "toolchainFile",
              preset.toolchainFile,
              "toolchain-file",
              "literal",
              { profile: preset.name },
            );
          if (preset.inherits || preset.condition || document.include)
            diagnostics.push(
              message(
                "cmake.dynamic",
                "CMake 预设包含继承、条件或外部引用，仅报告直接声明，需由 CMake 验证。",
                { profile: preset.name },
              ),
            );
        }
    }
    if (name === "CMakeLists.txt") {
      for (const [lang, key] of [
        ["c", "CMAKE_C_COMPILER"],
        ["cpp", "CMAKE_CXX_COMPILER"],
        ["c", "CMAKE_C_STANDARD"],
        ["cpp", "CMAKE_CXX_STANDARD"],
      ] as const) {
        const match = text.match(
          new RegExp(`set\\(\\s*${key}\\s+"?([^\\s"()]+)"?\\s*\\)`, "i"),
        );
        if (match)
          add(
            lang,
            key,
            match[1],
            key.endsWith("STANDARD") ? "standard" : "executable",
            "literal",
          );
      }
      const minimum = text.match(
        /cmake_minimum_required\(\s*VERSION\s+([\d.]+)/i,
      )?.[1];
      if (minimum) add("cmake", "minimum version", ">=" + minimum);
    }
  } catch {
    diagnostics.push(
      message(
        "metadata.invalid",
        "项目版本声明无法静态解析，未运行项目脚本。",
        { file: source },
      ),
    );
  }
  return { requirements, diagnostics };
}
export function discoveredCandidates(
  tools: readonly DiscoveredToolchain[],
): ToolchainCandidate[] {
  return tools.flatMap((tool) => {
    const language = canonical(tool.language);
    if (!language) return [];
    const versions =
      language === "csharp"
        ? tool.sdkVersion
          ? [tool.sdkVersion]
          : (tool.sdkVersions ??
            tool.details
              ?.split(/\r?\n/)
              .map((s) => s.trim().split(/\s/)[0])
              .filter((s) => /^\d+\.\d+\.\d+/.test(s)) ?? [tool.version])
        : [language === "rust" ? (tool.compilerVersion ?? "") : tool.version];
    return versions.map((version, index) => ({
      id: tool.id + (versions.length > 1 ? ":" + index : ""),
      language,
      executable: tool.executable,
      version,
      versionKind:
        language === "rust"
          ? ("compiler" as const)
          : language === "csharp"
            ? ("sdk" as const)
            : ("runtime" as const),
      channel: tool.rustToolchain?.replace(/-(?:x86_64|aarch64|i686)-.*$/, ""),
      manager: tool.manager,
      state: "unknown" as const,
      diagnostics: [],
    }));
  });
}
function matches(
  requirement: ToolchainRequirement,
  candidate: ToolchainCandidate,
  root: string,
): boolean | undefined {
  if (requirement.kind === "channel")
    return candidate.channel
      ? candidate.channel === requirement.expression
      : undefined;
  if (requirement.kind === "executable") {
    if (/\$|\{|\}/.test(requirement.expression)) return undefined;
    const p = /^[A-Za-z]:[\\/]/.test(candidate.executable) ? path.win32 : path;
    const wanted = requirement.expression;
    const actual = p.basename(candidate.executable).replace(/\.exe$/i, "");
    return p.isAbsolute(wanted)
      ? p.resolve(wanted) === p.resolve(candidate.executable)
      : wanted.includes("/") || wanted.includes("\\")
        ? p.resolve(root, wanted) === p.resolve(candidate.executable)
        : actual === wanted.replace(/\.exe$/i, "");
  }
  if (requirement.kind !== "version") return undefined;
  if (
    requirement.language === "rust" &&
    candidate.versionKind === "package-manager"
  )
    return undefined;
  return candidate.version
    ? satisfies(candidate.version, requirement)
    : undefined;
}
export function diagnoseToolchain(
  language: ToolchainLanguage,
  requirements: ToolchainRequirement[],
  candidates: ToolchainCandidate[],
  root: string,
  discoveryComplete = false,
  profile?: string,
): ToolchainDiagnostic {
  const relevant = requirements.filter(
    (r) => r.language === language && (!r.profile || r.profile === profile),
  );
  const required = relevant.filter((r) => r.role === "required");
  const diagnostics: EnvironmentMessage[] = [];
  const channelPins = new Set(
    required.filter((r) => r.kind === "channel").map((r) => r.expression),
  );
  const conflict = conflicting(required) || channelPins.size > 1;
  if (conflict)
    diagnostics.push(
      message(
        "toolchain.conflict",
        "项目的工具链版本声明互相冲突，请检查来源文件。",
      ),
    );
  for (const requirement of requirements.filter(
    (r) => r.language === language && r.profile && !profile,
  )) {
    diagnostics.push(
      message(
        "toolchain.profile",
        "已发现预设专用工具链要求，选择对应预设后才参与兼容性判断。",
        { profile: requirement.profile! },
      ),
    );
  }
  const evaluated = candidates
    .filter((c) => c.language === language)
    .map((candidate) => {
      const results = required.map((r) => matches(r, candidate, root));
      const state: DiagnosticState = results.includes(false)
        ? "incompatible"
        : results.includes(undefined)
          ? "unknown"
          : required.length
            ? "compatible"
            : "unknown";
      const notes: EnvironmentMessage[] = [];
      if (
        relevant.some(
          (r) =>
            r.role === "preferred" && matches(r, candidate, root) === false,
        )
      )
        notes.push(
          message(
            "toolchain.preferred",
            "当前候选不符合项目首选工具链；最低版本要求另行判断。",
          ),
        );
      return { ...candidate, state, diagnostics: notes };
    });
  const state: DiagnosticState = conflict
    ? "conflict"
    : evaluated.some((c) => c.state === "compatible")
      ? "compatible"
      : evaluated.some((c) => c.state === "unknown")
        ? "unknown"
        : evaluated.length
          ? "incompatible"
          : discoveryComplete
            ? "missing"
            : "unknown";
  if (!required.length)
    diagnostics.push(
      message(
        "toolchain.unconstrained",
        "项目没有可验证的静态版本约束，未推断兼容性。",
      ),
    );
  if (state === "missing")
    diagnostics.push(
      message(
        "toolchain.missing",
        "本次发现结果中没有对应工具链，未自动安装或切换。",
      ),
    );
  if (state === "unknown")
    diagnostics.push(
      message(
        "toolchain.unknown",
        "声明、版本或发现结果不足，无法可靠判断兼容性。",
      ),
    );
  return {
    language,
    state,
    requirements: requirements.filter((r) => r.language === language),
    candidates: evaluated,
    diagnostics,
  };
}
export class ProjectToolchainResolver {
  async resolve(
    request: ToolchainResolutionRequest,
  ): Promise<EnvironmentStatus> {
    const scope = await projectScope(request.workspaces, request.file);
    const language =
      request.language ?? fileLanguage[path.extname(request.file)];
    let root = scope.root;
    if (
      language &&
      configLanguage[language] &&
      (await fs.stat(request.file)).isFile()
    ) {
      const detected = await findProject(
        request.file,
        scope.workspace,
        configLanguage[language]!,
      );
      if (detected) root = detected.root;
    }
    return this.inspect({ ...scope, root }, request.toolchains, {
      language,
      discoveryComplete: request.discoveryComplete,
      profile: request.profile,
    });
  }
  async inspect(
    scope: ProjectScope,
    tools: readonly DiscoveredToolchain[],
    options: {
      language?: ToolchainLanguage;
      discoveryComplete?: boolean;
      profile?: string;
    } = {},
  ): Promise<EnvironmentStatus> {
    const requirements: ToolchainRequirement[] = [];
    const diagnostics: EnvironmentMessage[] = [];
    const seen = new Set<string>();
    for (const root of await parents(scope))
      for (const name of names) {
        if (seen.has(name)) continue;
        try {
          const text = await metadata(root, name);
          if (text === undefined) continue;
          seen.add(name);
          const result = parseToolchainFile(name, text, path.join(root, name));
          requirements.push(...result.requirements);
          diagnostics.push(...result.diagnostics);
        } catch {
          diagnostics.push(
            message(
              "metadata.unreadable",
              "版本声明无法读取或越过工作区边界，已跳过。",
              { file: name },
            ),
          );
        }
      }
    const candidates = discoveredCandidates(
      tools.filter(
        (t) =>
          !t.project ||
          (() => {
            try {
              return (
                decodeURIComponent(new URL(t.project).pathname) ===
                scope.workspace
              );
            } catch {
              return false;
            }
          })(),
      ),
    );
    const languages = new Set<ToolchainLanguage>([
      ...requirements.map((r) => r.language),
      ...(options.language ? [options.language] : []),
    ]);
    const toolchains = [...languages].map((language) =>
      diagnoseToolchain(
        language,
        requirements,
        candidates,
        scope.root,
        options.discoveryComplete,
        options.profile,
      ),
    );
    return { ...scope, toolchains, diagnostics };
  }
  /** Accept the existing project's inventory, rather than scanning a second independent workspace tree. */
  async inspectProjects(
    projects: readonly { root: string; folder: { uri: { fsPath: string } } }[],
    tools: readonly DiscoveredToolchain[],
  ): Promise<EnvironmentStatus[]> {
    const unique = new Map(
      projects.map((p) => [p.folder.uri.fsPath + "\0" + p.root, p]),
    );
    return Promise.all(
      [...unique.values()].map((p) =>
        this.inspect({ workspace: p.folder.uri.fsPath, root: p.root }, tools),
      ),
    );
  }
}
// Make version helpers available to future UI diagnostics without executing a compiler.
export { compare, numericVersion };
