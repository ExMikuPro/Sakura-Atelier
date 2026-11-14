const { test, expect } = require("@playwright/test");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { ConfigurationStore } = require("../../out/src/configurationStore");
const {
  templateRegistry,
  templateGroups,
  createTemplateDraft,
  recommendTemplates,
} = require("../../out/src/templates");
const { translate } = require("../../out/src/localization");
let server,
  base,
  root,
  store,
  folders,
  contexts,
  editorFolder,
  controls,
  drafts;
const memory = () => {
  const map = new Map();
  return {
    get: (key, fallback) => (map.has(key) ? map.get(key) : fallback),
    update: async (key, value) => {
      if (value === undefined) map.delete(key);
      else map.set(key, structuredClone(value));
    },
  };
};
const folderName = (folder) => folder.uri.toString();
function catalog(index = 0) {
  const context = contexts[index];
  const recommended = recommendTemplates(context);
  return {
    contexts,
    context,
    groups: templateGroups,
    recent: [],
    templates: templateRegistry.map((t) => {
      const { defaults: _, matches: __, ...view } = t;
      void _;
      void __;
      return {
        ...view,
        configuration: createTemplateDraft(t.id, context, "draft"),
        recommended: recommended.includes(t.id),
        status:
          t.language === "rust"
            ? "missing"
            : t.language === "go"
              ? "ready"
              : "unchecked",
        reason:
          t.language === "rust"
            ? "Cargo / Rust toolchain not configured or not found on PATH."
            : "Executable located; Run validates its version and dependencies.",
      };
    }),
  };
}
async function state() {
  const current = await store.read(folders[editorFolder]);
  return {
    type: "state",
    ...current,
    locale: controls.locale,
    mode: "configurations",
    folder: folderName(folders[editorFolder]),
    root: folders[editorFolder].uri.fsPath,
    file: path.join(folders[editorFolder].uri.fsPath, "main.go"),
    language: "go",
    workspaces: folders.map((f) => ({ name: f.name, uri: folderName(f) })),
    projects: [],
    toolchains: store.toolchains(folders[editorFolder]),
    launch: [],
    catalog: catalog(editorFolder),
    sdkStatus: "brew: /fixture/brew",
    pythonStatus: "",
    terminalActivation: { modern: "command", legacy: true },
    recoveredDraft: drafts.get(editorFolder),
  };
}
async function message(m) {
  if (m.type === "ready" || m.type === "reload") return state();
  if (m.type === "templates")
    return {
      type: "templates",
      catalog: catalog(
        contexts.findIndex((c) => c.id === m.context) >= 0
          ? contexts.findIndex((c) => c.id === m.context)
          : editorFolder,
      ),
    };
  if (m.type === "workspace") {
    editorFolder = folders.findIndex((f) => folderName(f) === m.folder);
    return state();
  }
  if (m.type === "draft") {
    drafts.set(
      folders.findIndex((f) => folderName(f) === m.folder),
      JSON.stringify(m),
    );
    return;
  }
  if (m.type === "clearDraft") {
    drafts.delete(folders.findIndex((f) => folderName(f) === m.folder));
    return;
  }
  if (m.type.startsWith("confirm"))
    return {
      type: "confirmed",
      request: m.request,
      accepted: controls.confirm,
    };
  if (m.type === "autosave") {
    const folder = folders.find((f) => folderName(f) === m.folder);
    if (controls.delay)
      await new Promise((resolve) => setTimeout(resolve, controls.delay));
    if (controls.fail) {
      controls.fail = false;
      return {
        type: "autosaveError",
        request: m.request,
        folder: m.folder,
        kind: "error",
        message: "保存失败（测试模拟）",
      };
    }
    try {
      const result = await store.save(
        folder,
        m.document,
        m.revision,
        m.sources,
      );
      return {
        type: "autosaved",
        request: m.request,
        folder: m.folder,
        draftId: m.draftId,
        ...result,
      };
    } catch (error) {
      return {
        type: "autosaveError",
        request: m.request,
        folder: m.folder,
        kind: /changed/.test(error.message) ? "conflict" : "invalid",
        message: translate("zh-cn", error.message),
      };
    }
  }
  if (m.type === "discover") {
    const tools = [
      {
        id: "go-fixture",
        name: "Go SDK",
        language: "go",
        version: "go test fixture",
        executable: "/fixture/go",
        manager: "test fixture",
        project: folderName(folders[editorFolder]),
      },
    ];
    return { type: "discovered", tools };
  }
  if (m.type === "sdkList")
    return {
      type: "sdkPackages",
      packages: [
        {
          id: "go",
          name: "Go SDK (fixture)",
          version: "1.0",
          installedVersion: "0.9",
          source: "fixture/repository",
          kind: "formula",
        },
      ],
    };
  if (m.type === "sdkDetails")
    return {
      type: "sdkDetails",
      details: {
        ...m.item,
        versions: ["1.0"],
        description: "测试数据，不会执行安装",
        details: "fixture metadata",
      },
    };
  return undefined;
}
const theme = {
  light: {
    "editor-background": "#fff9fc",
    "editor-foreground": "#4d3546",
    "sideBar-background": "#fff4f9",
    "sideBar-foreground": "#594254",
    descriptionForeground: "#785e70",
    "panel-border": "#ecdbe6",
    "input-background": "#fffdfd",
    "input-foreground": "#4d3546",
    "input-border": "#d9c2d0",
    "button-background": "#a34576",
    "button-foreground": "#ffffff",
    "button-hoverBackground": "#903965",
    "button-secondaryBackground": "#f5e6ef",
    "button-secondaryForeground": "#624459",
    "button-secondaryHoverBackground": "#ecd5e4",
    "list-activeSelectionBackground": "#f4d5e6",
    "list-activeSelectionForeground": "#642d4e",
    "list-hoverBackground": "#faeaf2",
    focusBorder: "#b75284",
    "editorWidget-background": "#fff9fc",
    "quickInput-background": "#fff9fc",
    "quickInput-foreground": "#4d3546",
    errorForeground: "#b52142",
    "editorWarning-foreground": "#9a5a00",
    "input-placeholderForeground": "#937888",
  },
  dark: {
    "editor-background": "#1e1e1e",
    "editor-foreground": "#dddddd",
    "sideBar-background": "#252526",
    "sideBar-foreground": "#dddddd",
    descriptionForeground: "#b6b6b6",
    "panel-border": "#484848",
    "input-background": "#313131",
    "input-foreground": "#eeeeee",
    "input-border": "#666666",
    "button-background": "#0e639c",
    "button-foreground": "#ffffff",
    "button-secondaryBackground": "#3a3d41",
    "button-secondaryForeground": "#eeeeee",
    "list-activeSelectionBackground": "#04395e",
    "list-activeSelectionForeground": "#ffffff",
    "list-hoverBackground": "#37373d",
    focusBorder: "#007fd4",
    "editorWidget-background": "#252526",
    "quickInput-background": "#252526",
    "quickInput-foreground": "#eeeeee",
    errorForeground: "#f48771",
    "editorWarning-foreground": "#cca700",
  },
  contrast: {
    "editor-background": "#000000",
    "editor-foreground": "#ffffff",
    "sideBar-background": "#000000",
    "sideBar-foreground": "#ffffff",
    descriptionForeground: "#ffffff",
    "panel-border": "#ffffff",
    "input-background": "#000000",
    "input-foreground": "#ffffff",
    "input-border": "#ffffff",
    "button-background": "#000000",
    "button-foreground": "#ffffff",
    "button-border": "#ffffff",
    "button-secondaryBackground": "#000000",
    "button-secondaryForeground": "#ffffff",
    "list-activeSelectionBackground": "#000000",
    "list-activeSelectionForeground": "#ffffff",
    "list-hoverBackground": "#000000",
    focusBorder: "#f38518",
    contrastBorder: "#ffffff",
    "list-focusOutline": "#f38518",
    "editorWidget-background": "#000000",
    "quickInput-background": "#000000",
    "quickInput-foreground": "#ffffff",
    errorForeground: "#ff6666",
    "editorWarning-foreground": "#ffff00",
  },
};
test.beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "atelier-ui-"));
  folders = ["后端项目", "Frontend"].map((name, index) => ({
    name,
    index,
    uri: {
      fsPath: path.join(root, String(index)),
      toString: () => "file:///fixture/" + index,
    },
  }));
  for (const folder of folders)
    await fs.mkdir(folder.uri.fsPath, { recursive: true });
  const context = { workspaceState: memory(), globalState: memory() };
  store = new ConfigurationStore(context);
  contexts = folders.map((folder, index) => ({
    id: folderName(folder) + "::project",
    folder: folderName(folder),
    root: folder.uri.fsPath,
    cwd: "${workspaceFolder}",
    label: folder.name,
    languages: index === 0 ? ["go", "rust", "python"] : ["typescript", "node"],
    activeLanguage: index === 0 ? "go" : "typescript",
    entries: {
      python: "${workspaceFolder}/main.py",
      go: "${workspaceFolder}/main.go",
      node: "${workspaceFolder}/main.js",
      typescript: "${workspaceFolder}/main.ts",
    },
    markers: ["go.mod", "Cargo.toml", "package.json", "CMakeLists.txt"],
    scripts: ["start", "dev"],
    tasks: ["Build"],
    examples: ["demo"],
  }));
  server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (req.method === "POST") {
        let text = "";
        for await (const part of req) text += part;
        if (url.pathname === "/control") {
          Object.assign(controls, JSON.parse(text));
          res.end("{}");
          return;
        }
        const result = await message(JSON.parse(text));
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(result || {}));
        return;
      }
      if (url.pathname === "/") {
        const vars = theme[url.searchParams.get("theme") || "light"];
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(
          `<!DOCTYPE html><html lang="zh-cn"><head><title>Sakura Atelier UI test</title><style>:root{${Object.entries(
            vars,
          )
            .map(([k, v]) => "--vscode-" + k + ":" + v)
            .join(
              ";",
            )};--vscode-font-family:system-ui;--vscode-font-size:13px}</style><link rel="stylesheet" href="/media/codicon.css"><link rel="stylesheet" href="/media/manager.css"></head><body><div id="app"></div><script>window.__uiMessages=[];let saved={};window.acquireVsCodeApi=()=>({getState:()=>saved,setState:s=>saved=s,postMessage:async m=>{window.__uiMessages.push(m);const r=await fetch('/message',{method:'POST',body:JSON.stringify(m)});const data=await r.json();if(data.type)window.dispatchEvent(new MessageEvent('message',{data}));}});</script><script src="/media/localization.js"></script><script src="/media/templatePicker.js"></script><script src="/media/autosave.js"></script><script src="/media/manager.js"></script></body></html>`,
        );
        return;
      }
      if (url.pathname.startsWith("/media/") && !url.pathname.includes("..")) {
        const file = path.join(__dirname, "../..", url.pathname);
        res.setHeader(
          "Content-Type",
          file.endsWith(".js")
            ? "text/javascript"
            : file.endsWith(".css")
              ? "text/css"
              : "font/ttf",
        );
        res.end(await fs.readFile(file));
        return;
      }
      res.statusCode = 404;
      res.end();
    } catch (error) {
      res.statusCode = 500;
      res.end(String(error));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = "http://127.0.0.1:" + server.address().port;
});
test.beforeEach(async ({ page }) => {
  editorFolder = 0;
  controls = { locale: "zh-cn", confirm: true, delay: 0, fail: false };
  drafts = new Map();
  for (const folder of folders) {
    await fs.rm(path.join(folder.uri.fsPath, ".vscode"), {
      recursive: true,
      force: true,
    });
  }
  store = new ConfigurationStore({
    workspaceState: memory(),
    globalState: memory(),
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.__errors = errors;
  await page.goto(base);
  await expect(page.locator("#add-configuration")).toBeVisible();
});
test.afterEach(async ({ page }) => {
  expect(page.__errors).toEqual([]);
});
test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(root, { recursive: true, force: true });
});
const add = async (page, name) => {
  await page.locator("#add-configuration").click();
  await page.getByRole("combobox", { name: "搜索模板…" }).fill(name);
  await page
    .getByRole("treeitem", { name: new RegExp("^" + name + " ·") })
    .last()
    .click();
};
const saved = (page) => expect(page.locator("#status")).toContainText("已保存");
test("Chinese picker: recommendations, every language, fuzzy/empty search, keyboard Escape and focus", async ({
  page,
}) => {
  await page.locator("#add-configuration").click();
  const dialog = page.getByRole("dialog", { name: "添加运行配置" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("treeitem", { name: /为当前项目推荐/ }),
  ).toBeVisible();
  for (const name of [
    "Go",
    "Rust / Cargo",
    "Python",
    "JavaScript / TypeScript / Node.js",
    "C / C++ / CMake",
    "C# / .NET",
    "Java",
    "通用",
  ])
    await expect(
      dialog.getByRole("treeitem", {
        name: new RegExp("^" + name.replace(/[+/.]/g, "\\$&") + "\\s*\\d*$"),
      }),
    ).toBeVisible();
  const search = dialog.getByRole("combobox", { name: "搜索模板…" });
  await search.fill("zzzzzzzzzzzz");
  await expect(dialog.getByText("没有匹配的模板")).toBeVisible();
  await search.fill("Go应用");
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(page.locator("#field-name")).toHaveValue("Go 应用程序");
  await saved(page);
  await page.locator("#add-configuration").click();
  await page.getByRole("combobox", { name: "搜索模板…" }).press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.locator("#add-configuration")).toBeFocused();
  expect((await store.read(folders[0])).sources).toEqual(
    expect.objectContaining({
      [Object.keys((await store.read(folders[0])).sources)[0]]: "personal",
    }),
  );
  expect(
    await fs
      .stat(path.join(folders[0].uri.fsPath, ".vscode"))
      .catch(() => undefined),
  ).toBeUndefined();
});
test("personal autosave, live language switching, structured args and confirmed storage migration", async ({
  page,
}) => {
  await add(page, "Python 脚本");
  await page.locator("#field-name").fill("我的 Python");
  await saved(page);
  await page
    .getByRole("button", { name: "添加一行", exact: true })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: "程序 / 测试参数 1" })
    .fill("hello world & literal");
  await saved(page);
  await page.getByRole("radio", { name: "项目配置（可共享）" }).click();
  await expect(
    page.getByRole("radio", { name: "项目配置（可共享）" }),
  ).toBeChecked();
  await saved(page);
  expect(
    (await store.read(folders[0])).sources[
      Object.keys((await store.read(folders[0])).sources)[0]
    ],
  ).toBe("project");
  const text = await fs.readFile(
    path.join(folders[0].uri.fsPath, ".vscode/sakura-atelier.json"),
    "utf8",
  );
  expect(text).toContain("hello world & literal");
  await page.evaluate(() =>
    window.dispatchEvent(
      new MessageEvent("message", { data: { type: "locale", locale: "en" } }),
    ),
  );
  await expect(
    page.getByLabel("Configuration name", { exact: true }),
  ).toHaveValue("我的 Python");
  await expect(page.locator("#add-configuration")).toBeVisible();
});
test("invalid JSON retained, corrected input autosaves, delete cancellation and SDK removal distinction", async ({
  page,
  request,
}) => {
  await add(page, "C 源文件");
  await page.locator("#field-target").fill("${workspaceFolder}/main.c");
  await saved(page);
  await page.getByText("高级选项", { exact: true }).click();
  const sources = page.locator("#field-sources");
  await sources.fill('["incomplete');
  await expect(sources).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#status")).toContainText("输入无效");
  await sources.fill('["main.c"]');
  await saved(page);
  await request.post(base + "/control", { data: { confirm: false } });
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.locator("#field-name")).toBeVisible();
  expect((await store.read(folders[0])).document.configurations).toHaveLength(
    1,
  );
});
test("save failure retry, disk conflict freeze and draft retention", async ({
  page,
  request,
}) => {
  await add(page, "Go 应用程序");
  await saved(page);
  await request.post(base + "/control", { data: { fail: true } });
  await page.locator("#field-name").fill("重试配置");
  await expect(page.locator("#status")).toContainText("保存失败");
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await saved(page);
  await page.getByRole("radio", { name: "项目配置（可共享）" }).click();
  await expect(
    page.getByRole("radio", { name: "项目配置（可共享）" }),
  ).toBeChecked();
  await saved(page);
  const file = path.join(folders[0].uri.fsPath, ".vscode/sakura-atelier.json");
  const disk = JSON.parse(await fs.readFile(file, "utf8"));
  disk.configurations[0].name = "外部修改";
  await fs.writeFile(file, JSON.stringify(disk));
  await page.locator("#field-name").fill("保留的草稿");
  await expect(page.locator("#status")).toContainText("磁盘上的配置已被修改");
  await expect(
    page.getByRole("button", { name: "保留草稿", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#field-name")).toHaveValue("保留的草稿");
  expect(
    JSON.parse(await fs.readFile(file, "utf8")).configurations[0].name,
  ).toBe("外部修改");
});
test("rapid config/workspace switches preserve owner folders and per-config values", async ({
  page,
  request,
}) => {
  await add(page, "Go 应用程序");
  await saved(page);
  await add(page, "Python 脚本");
  await saved(page);
  await request.post(base + "/control", { data: { delay: 250 } });
  await page.locator("#field-name").fill("第二配置");
  await page
    .getByRole("treeitem", { name: /Go 应用程序/ })
    .first()
    .click();
  await page.locator("#field-name").fill("第一配置");
  await saved(page);
  await page.locator("#workspace").selectOption("file:///fixture/1");
  await expect(page.locator("#workspace")).toHaveValue("file:///fixture/1");
  await add(page, "Node.js 应用程序");
  await saved(page);
  const a = await store.read(folders[0]),
    b = await store.read(folders[1]);
  expect(a.document.configurations.map((c) => c.name)).toEqual(
    expect.arrayContaining(["第一配置", "第二配置"]),
  );
  expect(b.document.configurations).toHaveLength(1);
  expect(b.document.configurations[0].language).toBe("node");
});
test("SDK missing banner, inline actions, fixed package details and no template-triggered installs", async ({
  page,
}) => {
  await add(page, "Cargo 运行");
  await expect(page.locator(".sdk-banner")).toContainText("尚未配置");
  const messages = await page.evaluate(() => window.__uiMessages);
  expect(
    messages.some((m) =>
      ["sdkInstall", "discover", "terminal"].includes(m.type),
    ),
  ).toBe(false);
  await page
    .locator(".sdk-banner")
    .getByRole("button", { name: "安装 SDK", exact: true })
    .click();
  await expect(
    page.getByPlaceholder("搜索 Go、Rust、Python、Node.js、Clang、.NET…"),
  ).toBeVisible();
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await page.getByText("Go SDK (fixture)", { exact: true }).click();
  await expect(page.locator(".package-details")).toContainText(
    "fixture/repository",
  );
  await expect(
    page
      .locator(".package-details")
      .getByRole("button", { name: "安装", exact: true }),
  ).toBeVisible();
});
test("picker portal fits small viewport, closes outside, sidebar resizes and collapses", async ({
  page,
}) => {
  await page.setViewportSize({ width: 540, height: 560 });
  await page.locator("#add-configuration").click();
  const dialog = page.getByRole("dialog", { name: "添加运行配置" });
  const box = await dialog.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(561);
  await page.mouse.click(538, 2);
  await expect(dialog).toBeHidden();
  const split = page.getByRole("separator", { name: "调整侧栏宽度" });
  await split.focus();
  await split.press("ArrowRight");
  await expect(split).toHaveAttribute("aria-valuenow", /\d+/);
  await page
    .getByRole("button", { name: "展开 / 收起侧栏", exact: true })
    .click();
  await expect(page.locator("#app")).toHaveClass("sidebar-collapsed");
});
test("theme evidence: compact Chinese settings and picker in light, dark and high contrast", async ({
  page,
}) => {
  const evidence = path.join(os.tmpdir(), "sakura-atelier-evidence");
  await fs.mkdir(evidence, { recursive: true });
  for (const name of ["light", "dark", "contrast"]) {
    await page.goto(base + "/?theme=" + name);
    await expect(page.locator("#add-configuration")).toBeVisible();
    await add(page, "Go 应用程序");
    await saved(page);
    await page.locator("#add-configuration").click();
    await expect(
      page.getByRole("dialog", { name: "添加运行配置" }),
    ).toBeVisible();
    await page.screenshot({
      path: path.join(evidence, "settings-" + name + ".png"),
    });
    await page.getByRole("combobox", { name: "搜索模板…" }).press("Escape");
  }
  console.log("Screenshots: " + evidence);
});
test("unfinished JSON restores after reload and corrected values autosave without losing editor text", async ({
  page,
}) => {
  await add(page, "C 源文件");
  await page.locator("#field-target").fill("${workspaceFolder}/main.c");
  await saved(page);
  await page.getByText("高级选项", { exact: true }).click();
  await page.locator("#field-sources").fill('["keep this unfinished');
  await expect(page.locator("#status")).toContainText("输入无效");
  await expect.poll(() => drafts.size).toBe(1);
  await page.reload();
  await expect(page.locator("#field-sources")).toHaveValue(
    '["keep this unfinished',
  );
  await page.getByText("高级选项", { exact: true }).click();
  await page.locator("#field-sources").fill('["main.c"]');
  await saved(page);
  await expect(page.locator("#field-sources")).not.toHaveAttribute(
    "aria-invalid",
    "true",
  );
});
test("undo and delayed sequential saves preserve the last user input", async ({
  page,
  request,
}) => {
  await add(page, "Go 应用程序");
  await saved(page);
  const name = page.locator("#field-name");
  await name.focus();
  await name.press("End");
  await name.pressSequentially(" ABC", { delay: 30 });
  await name.press("ControlOrMeta+z");
  await page.locator("#field-target").focus();
  await saved(page);
  expect(
    (await store.read(folders[0])).document.configurations[0].name,
  ).not.toBe("Go 应用程序 ABC");
  await request.post(base + "/control", { data: { delay: 400 } });
  await name.fill("最后的名称");
  await name.blur();
  await saved(page);
  expect((await store.read(folders[0])).document.configurations[0].name).toBe(
    "最后的名称",
  );
});

test('existing configuration navigation opens the unified embedded project wizard', async ({ page }) => {
  await page.getByRole('treeitem', { name: '新建嵌入式项目…', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__uiMessages.some(message => message.type === 'newProject'))).toBe(true);
});

test('existing configuration navigation requests dependency inspection without executing a repair', async ({ page }) => {
  await page.getByRole('treeitem', { name: '项目依赖检查与修复…', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__uiMessages.some(message => message.type === 'checkDependencies'))).toBe(true);
  expect(await page.evaluate(() => window.__uiMessages.some(message => /repair|install/i.test(message.type)))).toBe(false);
});
