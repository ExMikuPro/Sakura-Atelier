import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  parseToolchainFile,
  ProjectToolchainResolver,
  diagnoseToolchain,
  discoveredCandidates,
} from "../src/environment/projectToolchainResolver";
import { conflicting, satisfies } from "../src/environment/versions";
import { metadata, pathWithin } from "../src/environment/metadata";
import type {
  ToolchainRequirement,
  DiscoveredToolchain,
  ToolchainCandidate,
} from "../src/environment/model";
const requirement = (
  expression: string,
  syntax: ToolchainRequirement["syntax"] = "range",
): ToolchainRequirement => ({
  language: "python",
  source: "pyproject.toml",
  field: "requires-python",
  expression,
  kind: "version",
  syntax,
  role: "required",
});
const tool = (
  language: DiscoveredToolchain["language"],
  version: string,
): DiscoveredToolchain => ({
  id: language,
  language,
  version,
  name: language,
  executable: "/sdk/" + language,
  manager: "custom",
  project: "",
});
async function fixture(
  fn: (
    root: string,
    write: (name: string, text: string) => Promise<string>,
  ) => Promise<void>,
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "atelier p1 版本-"));
  const write = async (name: string, text: string) => {
    const file = path.join(root, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text);
    return file;
  };
  try {
    await fn(root, write);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
test("Python ranges remain ranges, partial pins use prefixes, unsupported PEP 440 is Unknown", () => {
  const r = parseToolchainFile(
    "pyproject.toml",
    '[project]\nrequires-python = ">=3.10,<3.13,!=3.11.0"',
  ).requirements[0];
  assert.equal(r.expression, ">=3.10,<3.13,!=3.11.0");
  assert.equal(satisfies("Python 3.12.4", r), true);
  assert.equal(satisfies("3.13.0", r), false);
  assert.equal(satisfies("3.11.0", r), false);
  assert.equal(satisfies("3.11.2", requirement("~=3.11.1")), true);
  assert.equal(satisfies("3.12.0", requirement("~=3.11.1")), false);
  assert.equal(satisfies("3.12.5", requirement("3.12", "prefix")), true);
  assert.equal(satisfies("3.11.1", requirement("!=3.11.*")), undefined);
  assert.equal(satisfies("3.14.0rc1", requirement(">=3.12")), undefined);
});
test("Node engines support caret, tilde, conjunction and alternatives without resolving aliases", () => {
  for (const [version, range, expected] of [
    ["22.5.0", "^20.0.0 || >=22.0.0", true],
    ["21.0.0", "^20.0.0 || >=22.0.0", false],
    ["20.2.0", "~20.1.0", false],
    ["0.2.5", "^0.2.0", true],
    ["0.3.0", "^0.2.0", false],
    ["20.0.0", "lts/*", undefined],
  ] as const)
    assert.equal(satisfies(version, requirement(range)), expected);
  assert.equal(
    parseToolchainFile("package.json", '{"engines":{"node":">=20 <23"}}')
      .requirements[0].language,
    "node",
  );
});
test("conflicts are derived from declarations rather than absent local versions", () => {
  assert.equal(
    conflicting([requirement(">=3.12"), requirement("<3.11")]),
    true,
  );
  assert.equal(
    conflicting([requirement(">=3.10"), requirement("3.11", "prefix")]),
    false,
  );
  assert.equal(
    conflicting([requirement("==3.11.0"), requirement("!=3.11.0")]),
    true,
  );
  assert.equal(
    conflicting([requirement("unknown:dynamic"), requirement(">=3.10")]),
    false,
  );
});
test("Go minimum and preferred toolchain have distinct semantics", () => {
  const parsed = parseToolchainFile(
    "go.mod",
    "module test\ngo 1.21\ntoolchain go1.23.2\n",
  ).requirements;
  assert.equal(parsed[0].expression, ">=1.21");
  assert.equal(parsed[1].role, "preferred");
  const candidates = discoveredCandidates([
    tool("go", "go version go1.22.4 darwin/arm64"),
  ]);
  const result = diagnoseToolchain("go", parsed, candidates, "/project", true);
  assert.equal(result.state, "compatible");
  assert.equal(result.candidates[0].diagnostics[0].code, "toolchain.preferred");
});
test("Rust minimum compiler version is not inferred from the Cargo package-manager version", () => {
  const req = parseToolchainFile(
    "Cargo.toml",
    '[package]\nrust-version="1.80"\n',
  ).requirements;
  assert.equal(req[0].expression, ">=1.80");
  const r = {
    ...tool("rust", "cargo 1.90.0"),
    rustToolchain: "stable-aarch64-apple-darwin",
  };
  assert.equal(
    diagnoseToolchain("rust", req, discoveredCandidates([r]), "/project", true)
      .state,
    "unknown",
  );
  assert.equal(
    diagnoseToolchain(
      "rust",
      req,
      discoveredCandidates([{ ...r, compilerVersion: "rustc 1.90.0" }]),
      "/project",
      true,
    ).state,
    "compatible",
  );
  const channel = parseToolchainFile(
    "rust-toolchain.toml",
    '[toolchain]\nchannel="nightly-2026-01-01"',
  ).requirements;
  assert.equal(channel[0].kind, "channel");
});
test(".NET SDK roll-forward policies and multi-SDK candidates remain explicit", () => {
  const req = parseToolchainFile(
    "global.json",
    '{"sdk":{"version":"8.0.302","rollForward":"latestFeature","allowPrerelease":false}}',
  ).requirements[0];
  assert.equal(satisfies("8.0.404", req), true);
  assert.equal(satisfies("8.1.100", req), false);
  assert.equal(satisfies("8.0.301", req), false);
  assert.equal(
    satisfies("8.0.303", { ...req, options: { rollForward: "patch" } }),
    true,
  );
  assert.equal(
    satisfies("8.0.402", { ...req, options: { rollForward: "patch" } }),
    false,
  );
  assert.equal(
    discoveredCandidates([
      {
        ...tool("csharp", "8.0.302"),
        details: "8.0.302 [/sdk]\n9.0.100 [/sdk]",
      },
    ]).length,
    2,
  );
});
test("Java parses literal Maven properties, Gradle toolchains and SDKMAN without evaluating builds", () => {
  const pom =
    "<project><properties><java.version>17</java.version><maven.compiler.release>${java.version}</maven.compiler.release></properties></project>";
  assert.equal(
    parseToolchainFile("pom.xml", pom).requirements[0].expression,
    "17",
  );
  assert.equal(
    parseToolchainFile(
      "build.gradle.kts",
      "java { toolchain { languageVersion.set(JavaLanguageVersion.of(21)) } }",
    ).requirements[0].expression,
    "21",
  );
  assert.equal(
    parseToolchainFile(".sdkmanrc", "java=17.0.10-tem").requirements[0]
      .expression,
    "17.0.10",
  );
  assert.match(
    parseToolchainFile(
      "build.gradle",
      'java { toolchain { languageVersion = providers.gradleProperty("javaVersion") } }',
    ).requirements[0].expression,
    /unknown/,
  );
});
test("CMake presets are alternatives; standards and dynamic toolchain files never become compiler versions", () => {
  const parsed = parseToolchainFile(
    "CMakePresets.json",
    JSON.stringify({
      version: 3,
      configurePresets: [
        { name: "gcc", cacheVariables: { CMAKE_CXX_COMPILER: "g++" } },
        { name: "clang", cacheVariables: { CMAKE_CXX_COMPILER: "clang++" } },
      ],
    }),
  );
  const candidates: ToolchainCandidate[] = [
    {
      id: "c",
      language: "cpp",
      executable: "/usr/bin/clang++",
      version: "18.0.0",
      state: "unknown",
      diagnostics: [],
    },
  ];
  assert.equal(
    diagnoseToolchain(
      "cpp",
      parsed.requirements,
      candidates,
      "/p",
      true,
      "clang",
    ).state,
    "compatible",
  );
  assert.notEqual(
    diagnoseToolchain("cpp", parsed.requirements, candidates, "/p", true).state,
    "conflict",
  );
  const list = parseToolchainFile(
    "CMakeLists.txt",
    "cmake_minimum_required(VERSION 3.22)\nset(CMAKE_CXX_STANDARD 20)\nproject(App VERSION 9.9.9)",
  );
  assert.equal(
    list.requirements.find((r) => r.language === "cpp")?.kind,
    "standard",
  );
  assert.ok(!list.requirements.some((r) => r.expression === "9.9.9"));
});
test("mise and tool-versions retain multiple alternatives, unknown strings are not exact versions", () => {
  const versions = parseToolchainFile(
    ".tool-versions",
    "python 3.11.9 3.12.3\nnodejs 22.0.0\ngolang 1.23.0",
  );
  assert.equal(versions.requirements.length, 3);
  assert.equal(versions.requirements[0].expression, "3.11.9 || 3.12.3");
  assert.equal(
    parseToolchainFile(
      "mise.toml",
      '[tools]\npython={version="3.12"}\nnode="lts"',
    ).requirements[0].expression,
    "3.12",
  );
  assert.equal(
    satisfies(
      "22.1.0",
      parseToolchainFile("mise.toml", '[tools]\nnode="lts"').requirements[0],
    ),
    undefined,
  );
});
test("monorepo and multi-root resolution uses owning workspace and nearest project", () =>
  fixture(async (root, write) => {
    await write(".python-version", "3.11");
    await write(
      "backend/pyproject.toml",
      '[project]\nrequires-python=">=3.12"',
    );
    const file = await write("backend/src/main.py", "");
    const result = await new ProjectToolchainResolver().resolve({
      file,
      workspaces: [path.dirname(root), root],
      language: "python",
      toolchains: [tool("python", "Python 3.12.1")],
      discoveryComplete: true,
    });
    assert.equal(result.workspace, await fs.realpath(root));
    assert.equal(result.root, path.join(await fs.realpath(root), "backend"));
    assert.equal(
      result.toolchains.find((t) => t.language === "python")?.state,
      "conflict",
    );
  }));
test("no discovered SDK is Missing only after complete discovery; no declaration is Unknown", () => {
  const req = [requirement(">=3.12")];
  assert.equal(diagnoseToolchain("python", req, [], "/p").state, "unknown");
  assert.equal(
    diagnoseToolchain("python", req, [], "/p", true).state,
    "missing",
  );
  assert.equal(
    diagnoseToolchain(
      "python",
      [],
      discoveredCandidates([tool("python", "3.12.1")]),
      "/p",
      true,
    ).state,
    "unknown",
  );
});
test("path boundaries support three platforms and reject prefix collisions", () => {
  for (const platform of ["darwin", "linux"] as const) {
    assert.equal(pathWithin("/work", "/work/src/main.py", platform), true);
    assert.equal(pathWithin("/work", "/work-private/file", platform), false);
  }
  assert.equal(
    pathWithin("C:\\Work Space", "C:\\Work Space\\src\\main.py", "win32"),
    true,
  );
  assert.equal(pathWithin("C:\\work", "D:\\work\\file", "win32"), false);
  assert.equal(pathWithin("C:\\work", "C:\\work2\\file", "win32"), false);
});
test("metadata symlinks, oversized files and outside targets fail safely; detection never writes metadata", () =>
  fixture(async (root, write) => {
    const outside = await fs.mkdtemp(
      path.join(os.tmpdir(), "atelier-private-"),
    );
    try {
      await fs.writeFile(path.join(outside, "version"), "3.12");
      await fs.symlink(
        path.join(outside, "version"),
        path.join(root, ".python-version"),
      );
      await assert.rejects(metadata(root, ".python-version"), /escapes/);
      const file = await write("src/main.py", "");
      const result = await new ProjectToolchainResolver().resolve({
        file,
        workspaces: [root],
        toolchains: [],
        language: "python",
      });
      assert.ok(
        result.diagnostics.some((d) => d.code === "metadata.unreadable"),
      );
      await assert.rejects(
        new ProjectToolchainResolver().resolve({
          file: outside,
          workspaces: [root],
          toolchains: [],
        }),
      );
      await write("huge", "x".repeat(1024 * 1024 + 1));
      await assert.rejects(metadata(root, "huge"), /1 MiB/);
      assert.equal(await fs.readFile(file, "utf8"), "");
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  }));
test("invalid project metadata yields explicit diagnostics and no invented requirements", () => {
  const bad = parseToolchainFile("package.json", "{bad json");
  assert.equal(bad.requirements.length, 0);
  assert.equal(bad.diagnostics[0].code, "metadata.invalid");
});
