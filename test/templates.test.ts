import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { runInNewContext } from "node:vm";
import {
  createTemplateDraft,
  recommendTemplates,
  templateRegistry,
  TemplateContext,
} from "../src/templates";
import {
  projectContexts,
  templateViews,
  templateRecent,
} from "../src/templateCatalog";
import { ConfigurationStore } from "../src/configurationStore";
import { newConfiguration, validateFile } from "../src/configuration";
import { chinese, resolveLanguage, translate } from "../src/localization";
const context: TemplateContext = {
  id: "file:///workspace::/workspace",
  folder: "file:///workspace",
  root: "/workspace",
  cwd: "${workspaceFolder}",
  label: "Workspace",
  languages: ["go", "rust", "python", "typescript"],
  activeLanguage: "go",
  entries: {
    python: "${workspaceFolder}/main.py",
    go: "${workspaceFolder}/main.go",
  },
  markers: ["go.mod", "Cargo.toml", "pyproject.toml", "package.json"],
  scripts: ["start"],
  tasks: ["Build"],
  examples: ["hello"],
};
test("template registry has unique IDs, all supported languages, and no fabricated Kotlin/Attach/Compound", () => {
  assert.equal(
    new Set(templateRegistry.map((t) => t.id)).size,
    templateRegistry.length,
  );
  for (const language of [
    "go",
    "rust",
    "python",
    "typescript",
    "javascript",
    "node",
    "c",
    "cpp",
    "csharp",
    "java",
  ])
    assert.ok(templateRegistry.some((t) => t.language === language));
  for (const id of [
    "kotlin.application",
    "node.attach",
    "general.compound",
    "cmake.debug",
  ])
    assert.throws(() => createTemplateDraft(id, context, "draft"));
});
test("every template factory creates independent schema-compatible drafts without persisting or executing", () => {
  for (const template of templateRegistry) {
    const first = createTemplateDraft(template.id, context, "one");
    const second = createTemplateDraft(template.id, context, "two");
    assert.equal(
      validateFile({ version: 1, configurations: [first, second] })
        .configurations.length,
      2,
    );
    first.args.push("private edit");
    assert.deepEqual(second.args, []);
    assert.equal(first.templateId, template.id);
    assert.equal(first.operation, template.operation);
  }
});
test("recommendations prioritize active Go and retain every language in a mixed workspace", () => {
  const result = recommendTemplates(context);
  assert.equal(result[0], "go.application");
  for (const id of ["go.test", "cargo.run", "python.script", "typescript.file"])
    assert.ok(result.includes(id));
  assert.equal(templateRegistry.length, 25);
  assert.deepEqual(
    recommendTemplates({
      ...context,
      languages: [],
      activeLanguage: undefined,
      markers: [],
      tasks: [],
    }),
    [],
  );
});
test("different-language templates never reuse the active Go file", () => {
  assert.equal(
    createTemplateDraft("python.script", context, "py").target,
    "${workspaceFolder}/main.py",
  );
  assert.equal(
    createTemplateDraft("javascript.file", context, "js").target,
    "",
  );
  assert.equal(
    createTemplateDraft("cargo.run", context, "rust").target,
    "${workspaceFolder}/Cargo.toml",
  );
  assert.equal(createTemplateDraft("go.test", context, "test").target, "./...");
});
test("multi-root project contexts preserve owner folders and portable relative roots", () => {
  const a = {
    name: "A",
    uri: { fsPath: "/a", toString: () => "file:///a" },
  } as import("vscode").WorkspaceFolder;
  const b = {
    name: "B",
    uri: { fsPath: "/b", toString: () => "file:///b" },
  } as import("vscode").WorkspaceFolder;
  const roots = projectContexts(
    [a, b],
    [
      { folder: a, root: "/a/backend", marker: "go.mod", languages: ["go"] },
      {
        folder: b,
        root: "/b/frontend",
        marker: "package.json",
        languages: ["node"],
      },
    ],
  );
  assert.equal(roots.length, 4);
  assert.equal(
    roots.find((c) => c.root === "/a/backend")?.cwd,
    "${workspaceFolder}/backend",
  );
  assert.equal(
    roots.find((c) => c.root === "/b/frontend")?.folder,
    "file:///b",
  );
});
test("missing SDK state is explicit while all templates remain editable and accessible", async () => {
  const views = await templateViews(
    { ...context, root: os.tmpdir() },
    [
      {
        id: "missing",
        name: "Missing SDK",
        language: "go",
        executable: "/no-such-sdk/go",
        version: "",
        manager: "custom",
        project: "",
      },
    ],
    true,
    () => "missing",
  );
  assert.equal(views.length, 25);
  assert.equal(views.find((t) => t.id === "go.application")?.status, "missing");
  assert.ok(views.every((t) => t.configuration.id === "template-draft"));
  assert.equal(
    (await templateViews(context, [], false, () => ""))[0].status,
    "unchecked",
  );
});
test("recent templates are bounded, unique and reject unsupported IDs", () => {
  assert.deepEqual(
    templateRecent(
      ["go.application", "python.script", "obsolete"],
      "python.script",
    ),
    ["python.script", "go.application"],
  );
});
test("Chinese localization covers every template label/description; fallback and parameter messages work", () => {
  for (const template of templateRegistry) {
    assert.ok(chinese[template.label], template.label);
    assert.notEqual(
      translate("zh-cn", template.description),
      template.description,
      template.description,
    );
  }
  assert.equal(resolveLanguage(undefined), "zh-cn");
  assert.equal(resolveLanguage("auto", "zh-tw"), "zh-cn");
  assert.equal(resolveLanguage("auto", "de"), "en");
  assert.equal(resolveLanguage("en", "zh-cn"), "en");
  assert.equal(translate("en", "Run"), "Run");
  assert.equal(
    translate(
      "zh-cn",
      "Missing toolchain: go. Install it yourself or configure its executable in Sakura Atelier settings.",
    ),
    "缺少工具链：go。请安装对应工具，或在 Sakura Atelier 中选择可执行文件。",
  );
  assert.equal(
    translate("zh-cn", "Unknown proper noun"),
    "Unknown proper noun",
  );
  assert.equal(
    translate("zh-cn", "Source: {0}", "homebrew/core"),
    "来源：homebrew/core",
  );
});
test("manifest localizes commands/settings and preserves ID, version, minimum API and native toolbar", async () => {
  const root = path.resolve(__dirname, "../..");
  const manifest = JSON.parse(
    await fs.readFile(path.join(root, "package.json"), "utf8"),
  );
  const nls = JSON.parse(
    await fs.readFile(path.join(root, "package.nls.json"), "utf8"),
  );
  const en = JSON.parse(
    await fs.readFile(path.join(root, "package.nls.en.json"), "utf8"),
  );
  assert.equal(
    manifest.publisher + "." + manifest.name,
    "ExMikuPro.sakura-atelier",
  );
  assert.equal(manifest.version, "0.1.0");
  assert.equal(manifest.engines.vscode, "^1.85.0");
  assert.equal(
    manifest.contributes.configuration.properties["sakuraAtelier.language"]
      .default,
    "zh-cn",
  );
  for (const key of Object.keys(nls)) assert.ok(en[key], key);
  for (const command of manifest.contributes.commands)
    assert.ok(nls[command.title.slice(1, -1)]);
  assert.equal(manifest.icon, "media/icon.png");
});
async function storage(
  fn: (
    store: ConfigurationStore,
    folder: import("vscode").WorkspaceFolder,
    root: string,
    context: import("vscode").ExtensionContext,
  ) => Promise<void>,
) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "atelier storage 空格-"),
  );
  const memory = () => {
    const values = new Map<string, unknown>();
    return {
      get: (key: string, fallback?: unknown) =>
        values.has(key) ? values.get(key) : fallback,
      update: async (key: string, value: unknown) => {
        if (value === undefined) values.delete(key);
        else values.set(key, structuredClone(value));
      },
    };
  };
  const context = {
    workspaceState: memory(),
    globalState: memory(),
  } as unknown as import("vscode").ExtensionContext;
  const folder = {
    name: "Folder",
    index: 0,
    uri: { fsPath: root, toString: () => "file://" + root },
  } as import("vscode").WorkspaceFolder;
  try {
    await fn(new ConfigurationStore(context), folder, root, context);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
const config = (id: string) => ({
  ...newConfiguration("python", id),
  id,
  target: "${workspaceFolder}/main.py",
});
test("personal configuration creation/restart/default never creates a project directory", () =>
  storage(async (store, folder, root, context) => {
    const saved = await store.save(
      folder,
      { version: 1, default: "private", configurations: [config("private")] },
      "",
      { private: "personal" },
    );
    assert.equal(saved.sources.private, "personal");
    assert.equal(
      (await new ConfigurationStore(context).read(folder)).document.default,
      "private",
    );
    await assert.rejects(fs.stat(path.join(root, ".vscode")), /ENOENT/);
  }));
test("project and personal configurations share a list but only shared data enters project JSON", () =>
  storage(async (store, folder, root, context) => {
    const saved = await store.save(
      folder,
      { version: 1, configurations: [config("private"), config("shared")] },
      "",
      { private: "personal", shared: "project" },
    );
    const disk = JSON.parse(
      await fs.readFile(path.join(root, ".vscode/sakura-atelier.json"), "utf8"),
    );
    assert.deepEqual(
      disk.configurations.map((c: { id: string }) => c.id),
      ["shared"],
    );
    assert.equal(disk.sources, undefined);
    assert.equal(disk.configurations[0].storage, undefined);
    assert.equal(
      (await new ConfigurationStore(context).read(folder)).document
        .configurations.length,
      2,
    );
    assert.equal(saved.sources.shared, "project");
  }));
test("personal/project migration is reversible and targeted deletion keeps unrelated entries", () =>
  storage(async (store, folder, root) => {
    let value = await store.save(
      folder,
      { version: 1, configurations: [config("one"), config("two")] },
      "",
      { one: "personal", two: "personal" },
    );
    value = await store.save(folder, value.document, value.revision, {
      one: "project",
      two: "personal",
    });
    assert.equal(value.sources.one, "project");
    assert.equal(
      JSON.parse(
        await fs.readFile(
          path.join(root, ".vscode/sakura-atelier.json"),
          "utf8",
        ),
      ).configurations.length,
      1,
    );
    value = await store.save(folder, value.document, value.revision, {
      one: "personal",
      two: "personal",
    });
    assert.equal(value.sources.one, "personal");
    value = await store.save(
      folder,
      { version: 1, configurations: [config("two")] },
      value.revision,
      { two: "personal" },
    );
    assert.deepEqual(
      value.document.configurations.map((c) => c.id),
      ["two"],
    );
  }));
test("project migration failure keeps personal data and does not overwrite external edits", () =>
  storage(async (store, folder, root) => {
    const original = await store.save(
      folder,
      { version: 1, configurations: [config("private")] },
      "",
      { private: "personal" },
    );
    await fs.mkdir(path.join(root, ".vscode"));
    await fs.writeFile(
      path.join(root, ".vscode/sakura-atelier.json"),
      JSON.stringify({ version: 1, configurations: [config("external")] }),
    );
    await assert.rejects(
      store.save(folder, original.document, original.revision, {
        private: "project",
      }),
      /changed/,
    );
    assert.ok(
      (await store.read(folder)).document.configurations.some(
        (c) => c.id === "private",
      ),
    );
  }));
test("cross-storage duplicate IDs are explicit; legacy project files still read as project", () =>
  storage(async (store, folder, root) => {
    await store.save(
      folder,
      { version: 1, configurations: [config("same")] },
      "",
      { same: "personal" },
    );
    await fs.mkdir(path.join(root, ".vscode"));
    await fs.writeFile(
      path.join(root, ".vscode/sakura-atelier.json"),
      JSON.stringify({ version: 1, configurations: [config("same")] }),
    );
    await assert.rejects(store.read(folder), /ID conflict/);
    await fs.writeFile(
      path.join(root, ".vscode/sakura-atelier.json"),
      JSON.stringify({ version: 1, configurations: [config("legacy")] }),
    );
    assert.equal((await store.read(folder)).sources.legacy, "project");
  }));
test("personal storage isolates multiple folders and cancellation has no persistence side effect", () =>
  storage(async (store, folder, root) => {
    const other = {
      ...folder,
      uri: { ...folder.uri, toString: () => "file:///another-folder" },
    } as import("vscode").WorkspaceFolder;
    await store.save(
      folder,
      { version: 1, configurations: [config("one")] },
      "",
      { one: "personal" },
    );
    assert.equal((await store.read(other)).document.configurations.length, 0);
    const draft = createTemplateDraft("python.script", context, "cancelled");
    draft.name = "never persisted";
    assert.equal((await store.read(folder)).document.configurations.length, 1);
    await assert.rejects(fs.stat(path.join(root, ".vscode")), /ENOENT/);
  }));
test("sharing SDK paths preserves local references and never modifies launch/tasks or stores literal secrets", () =>
  storage(async (store, folder, root) => {
    await fs.mkdir(path.join(root, ".vscode"));
    for (const file of ["launch.json", "tasks.json"])
      await fs.writeFile(path.join(root, ".vscode", file), "USER DATA");
    const c = {
      ...config("share"),
      toolchain: "/private-sdk/Python/bin/python",
      env: { TOKEN: "${secret:TOKEN}" },
    };
    const saved = await store.save(
      folder,
      { version: 1, configurations: [c] },
      "",
      { share: "project" },
    );
    const text = await fs.readFile(
      path.join(root, ".vscode/sakura-atelier.json"),
      "utf8",
    );
    assert.ok(!text.includes("/private-sdk"));
    assert.ok(text.includes("${toolchain:"));
    for (const file of ["launch.json", "tasks.json"])
      assert.equal(
        await fs.readFile(path.join(root, ".vscode", file), "utf8"),
        "USER DATA",
      );
    c.env.TOKEN = "literal secret";
    await assert.rejects(
      store.save(folder, { version: 1, configurations: [c] }, saved.revision, {
        share: "project",
      }),
      /plaintext/,
    );
  }));
test("migration interrupted after disk write recovers retained personal data from the local journal", () =>
  storage(async (store, folder, _root, context) => {
    let original = await store.save(
      folder,
      { version: 1, configurations: [config("shared")] },
      "",
      { shared: "project" },
    );
    const update = context.workspaceState.update.bind(context.workspaceState);
    let fail = true;
    context.workspaceState.update = async (key, value) => {
      if (
        fail &&
        key.startsWith("atelier.personal:") &&
        !key.endsWith(":journal")
      ) {
        fail = false;
        throw new Error("simulated local persistence failure");
      }
      return update(key, value);
    };
    await assert.rejects(
      store.save(folder, original.document, original.revision, {
        shared: "personal",
      }),
      /simulated/,
    );
    original = await new ConfigurationStore(context).read(folder);
    assert.equal(original.sources.shared, "personal");
    assert.equal(original.document.configurations[0].id, "shared");
  }));
// The actual browser state machine is tested with an injected deterministic clock.
interface Snapshot {
  document: string;
  folder?: string;
  invalid?: boolean;
}
interface Machine {
  edit(s: Snapshot, immediate?: boolean): void;
  flush(): Promise<void>;
  retry(): void;
  dispose(): void;
  state: string;
  revision: string;
}
async function machine() {
  const source = await fs.readFile(
    path.resolve(__dirname, "../../media/autosave.js"),
    "utf8",
  );
  const sandbox: {
    AtelierAutosave?: {
      Autosave: new (options: Record<string, unknown>) => Machine;
    };
  } = {};
  runInNewContext(source, Object.assign(sandbox, { setTimeout, clearTimeout }));
  return sandbox.AtelierAutosave!.Autosave;
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
test("autosave debounce coalesces rapid typing and select changes flush immediately", async () => {
  const Auto = await machine();
  const timers = new Map<number, () => void>();
  let counter = 0;
  const writes: Snapshot[] = [];
  const a = new Auto({
    revision: "v1",
    schedule: (fn: () => void) => {
      timers.set(++counter, fn);
      return counter;
    },
    cancel: (id: number) => timers.delete(id),
    write: async (s: Snapshot) => {
      writes.push(s);
      return { revision: "v2" };
    },
  });
  a.edit({ document: "a" });
  a.edit({ document: "ab" });
  a.edit({ document: "abc" });
  assert.equal(timers.size, 1);
  assert.equal(writes.length, 0);
  [...timers.values()][0]();
  await tick();
  assert.equal(writes[0].document, "abc");
  a.edit({ document: "select" }, true);
  await tick();
  assert.equal(writes[1].document, "select");
  assert.equal(a.state, "clean");
});
test("asynchronous autosaves are ordered and edits during a save are never overwritten", async () => {
  const Auto = await machine();
  let complete: (v: { revision: string }) => void = () => {};
  const calls: { document: string; revision: string }[] = [];
  const a = new Auto({
    revision: "r1",
    write: (s: { document: string; revision: string }) => {
      calls.push(s);
      return new Promise((resolve) => {
        complete = resolve;
      });
    },
  });
  a.edit({ document: "config A" }, true);
  a.edit({ document: "config B" }, true);
  assert.equal(calls.length, 1);
  complete({ revision: "r2" });
  await tick();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].document, "config B");
  assert.equal(calls[1].revision, "r2");
  complete({ revision: "r3" });
  await tick();
  assert.equal(a.state, "clean");
});
test("invalid autosave preserves drafts, save failures retry, and conflicts block further writes", async () => {
  const Auto = await machine();
  const drafts: Snapshot[] = [];
  let count = 0;
  let failure = "error";
  const a = new Auto({
    persist: (s: Snapshot) => drafts.push(s),
    validate: (s: Snapshot) => (s.invalid ? "invalid" : undefined),
    write: async () => {
      count++;
      if (failure) throw { kind: failure, message: "failed" };
      return { revision: "ok" };
    },
  });
  a.edit({ document: "unfinished JSON", invalid: true }, true);
  assert.equal(count, 0);
  assert.equal(a.state, "invalid");
  a.edit({ document: "valid" }, true);
  await tick();
  assert.equal(a.state, "error");
  failure = "";
  a.retry();
  await tick();
  assert.equal(a.state, "clean");
  failure = "conflict";
  a.edit({ document: "external change" }, true);
  await tick();
  const previous = count;
  a.edit({ document: "keep editing" }, true);
  a.retry();
  await tick();
  assert.equal(count, previous);
  assert.equal(a.state, "conflict");
  assert.equal(drafts.at(-1)?.document, "keep editing");
});
test("per-workspace writers isolate revisions; close flushes pending valid changes", async () => {
  const Auto = await machine();
  const calls: { folder: string; revision: string }[] = [];
  const create = (folder: string, revision: string) =>
    new Auto({
      revision,
      write: async (s: Snapshot & { revision: string }) => {
        calls.push({ folder: folder, revision: s.revision });
        return { revision: revision + "-next" };
      },
    });
  const a = create("a", "a1");
  const b = create("b", "b1");
  a.edit({ document: "a", folder: "a" });
  b.edit({ document: "b", folder: "b" });
  a.dispose();
  b.dispose();
  await tick();
  assert.deepEqual(calls, [
    { folder: "a", revision: "a1" },
    { folder: "b", revision: "b1" },
  ]);
});

interface PanelHarness {
  message(value: Record<string, unknown>): Promise<void>;
  flushOnClose(): Promise<void>;
  latestDrafts: Map<string, Record<string, unknown>>;
  lastSaved: Map<string, { revision: string; draftId: unknown }>;
}
async function panelFixture(
  fn: (
    panel: PanelHarness,
    store: ConfigurationStore,
    folder: import("vscode").WorkspaceFolder,
    messages: Record<string, unknown>[],
    context: import("vscode").ExtensionContext,
  ) => Promise<void>,
) {
  await storage(async (store, folder, _root, context) => {
    const { createRequire } = await import("node:module");
    const required = createRequire(__filename);
    const messages: Record<string, unknown>[] = [];
    const secrets = new Map<string, string>();
    const fake = { workspace: { workspaceFolders: [folder] } };
    const exports: { ManagerPanel?: { prototype: PanelHarness } } = {};
    const source = await fs.readFile(
      path.resolve(__dirname, "../src/managerPanel.js"),
      "utf8",
    );
    runInNewContext(source, {
      exports,
      console,
      process,
      require: (name: string) =>
        name === "vscode"
          ? fake
          : name === "./i18n"
            ? { t: (value: string) => value, language: () => "en" }
            : name === "./ui"
              ? { ui: { showWarningMessage: async () => "Confirm" } }
              : name === "./launchConfigurations"
                ? {}
                : name === "./toolchains"
                  ? {}
                  : name === "./sdkManager"
                    ? {}
                    : name.startsWith("./")
                      ? required("../src/" + name.slice(2))
                      : required(name),
    });
    const panel = Object.assign(
      Object.create(exports.ManagerPanel!.prototype),
      {
        editor: { folder, root: folder.uri.fsPath },
        controller: {
          store,
          context: {
            ...context,
            secrets: {
              get: async (k: string) => secrets.get(k),
              store: async (k: string, v: string) => {
                secrets.set(k, v);
              },
              delete: async (k: string) => {
                secrets.delete(k);
              },
            },
          },
          updateStatus() {},
        },
        panel: {
          webview: {
            postMessage: async (message: Record<string, unknown>) => {
              messages.push(message);
              return true;
            },
          },
        },
        approvals: new Set(),
        drafts: new Map(),
        writes: new Map(),
        latestDrafts: new Map(),
        lastSaved: new Map(),
      },
    ) as PanelHarness;
    await fn(panel, store, folder, messages, context);
  });
}
test("real editor protocol saves a personal configuration and rejects unconfirmed migration/deletion", () =>
  panelFixture(async (panel, store, folder, messages) => {
    const folderId = folder.uri.toString();
    const document = { version: 1, configurations: [config("one")] };
    await panel.message({
      type: "autosave",
      folder: folderId,
      request: 1,
      revision: "",
      document,
      sources: { one: "personal" },
    });
    const saved = await store.read(folder);
    assert.equal(messages.at(-1)?.type, "autosaved");
    await panel.message({
      type: "autosave",
      folder: folderId,
      request: 2,
      revision: saved.revision,
      document,
      sources: { one: "project" },
    });
    assert.match(
      String(messages.at(-1)?.message),
      /migration requires confirmation/,
    );
    assert.equal((await store.read(folder)).sources.one, "personal");
    await panel.message({
      type: "autosave",
      folder: folderId,
      request: 3,
      revision: saved.revision,
      document: { version: 1, configurations: [] },
      sources: {},
    });
    assert.match(
      String(messages.at(-1)?.message),
      /deletion requires confirmation/,
    );
    await panel.message({
      type: "confirmMigration",
      folder: folderId,
      request: 4,
      id: "one",
      source: "project",
    });
    await panel.message({
      type: "autosave",
      folder: folderId,
      request: 5,
      revision: saved.revision,
      document,
      sources: { one: "project" },
    });
    assert.equal((await store.read(folder)).sources.one, "project");
  }));
test("closing the real panel protocol flushes a valid pending draft but keeps an unfinished module unsaved", () =>
  panelFixture(async (panel, store, folder) => {
    const key = folder.uri.toString();
    const valid = {
      type: "draft",
      draftId: "close-valid",
      folder: key,
      root: folder.uri.fsPath,
      revision: "",
      document: { version: 1, configurations: [config("close")] },
      sources: { close: "personal" },
      invalid: false,
    };
    await panel.message(valid);
    await panel.flushOnClose();
    assert.equal(
      (await store.read(folder)).document.configurations[0].id,
      "close",
    );
    const revision = (await store.read(folder)).revision;
    const incomplete = { ...config("incomplete"), kind: "module", target: "" };
    await panel.message({
      ...valid,
      draftId: "invalid-module",
      revision,
      document: { version: 1, configurations: [incomplete] },
      sources: { incomplete: "personal" },
    });
    await panel.flushOnClose();
    assert.deepEqual(
      (await store.read(folder)).document.configurations.map((c) => c.id),
      ["close"],
    );
  }));
test("real autosave protocol serializes simultaneous revisions and does not overwrite an external save", () =>
  panelFixture(async (panel, store, folder, messages) => {
    const payload = {
      type: "autosave",
      folder: folder.uri.toString(),
      revision: "",
      document: { version: 1, configurations: [config("a")] },
      sources: { a: "personal" },
    };
    await Promise.all([
      panel.message({ ...payload, request: 1 }),
      panel.message({
        ...payload,
        request: 2,
        document: { version: 1, configurations: [config("b")] },
        sources: { b: "personal" },
      }),
    ]);
    assert.equal(messages.filter((m) => m.type === "autosaved").length, 1);
    assert.equal(messages.filter((m) => m.type === "autosaveError").length, 1);
    assert.equal((await store.read(folder)).document.configurations[0].id, "a");
  }));

test("configuration IDs matching Object prototype names remain distinct and retain their storage source", () =>
  storage(async (store, folder) => {
    const ids = ["__proto__", "constructor", "toString"];
    const origins = Object.fromEntries(ids.map((id) => [id, "personal"]));
    const saved = await store.save(
      folder,
      { version: 1, configurations: ids.map(config) },
      "",
      origins as Record<string, "personal">,
    );
    for (const id of ids) assert.equal(saved.sources[id], "personal");
    assert.equal((await store.read(folder)).document.configurations.length, 3);
  }));

test("autosave validates SDK metadata before persisting an otherwise valid configuration", () =>
  panelFixture(async (panel, store, folder, messages) => {
    await panel.message({
      type: "autosave",
      request: 1,
      folder: folder.uri.toString(),
      revision: "",
      document: { version: 1, configurations: [config("a")] },
      sources: { a: "personal" },
      toolchains: [{ id: "bad-sdk" }],
    });
    assert.match(String(messages.at(-1)?.message), /Invalid toolchain/);
    assert.equal((await store.read(folder)).document.configurations.length, 0);
  }));

test("generated shared SDK bindings survive later autosaves whose tool list predates the first acknowledgment", () =>
  panelFixture(async (panel, store, folder, messages) => {
    const folderId = folder.uri.toString();
    const c = { ...config("shared"), toolchain: process.execPath };
    const payload = {
      type: "autosave",
      folder: folderId,
      document: { version: 1, configurations: [c] },
      sources: { shared: "project" },
      toolchains: [],
    };
    await panel.message({ ...payload, request: 1, revision: "" });
    assert.equal(messages.at(-1)?.type, "autosaved");
    const first = await store.read(folder);
    c.name = "continued edit";
    await panel.message({ ...payload, request: 2, revision: first.revision });
    assert.equal(messages.at(-1)?.type, "autosaved");
    assert.equal(
      store.toolchains(folder).find((t) => t.id === "local-shared")?.executable,
      process.execPath,
    );
  }));
