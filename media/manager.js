"use strict";
(() => {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const send = (type, data = {}) => vscode.postMessage({ type, ...data });
  const languages = [
    "go",
    "rust",
    "python",
    "typescript",
    "typescriptreact",
    "javascript",
    "javascriptreact",
    "node",
    "c",
    "cpp",
    "csharp",
    "java",
  ];
  const languageName = {
    go: "Go / Golang",
    rust: "Rust",
    python: "Python",
    typescript: "TypeScript",
    javascript: "JavaScript",
    node: "Node.js",
    c: "C",
    cpp: "C++",
    csharp: "C#",
    java: "Java",
    javascriptreact: "JavaScript (JSX)",
    typescriptreact: "TypeScript (TSX)",
  };
  let environmentLanguage,
    sources = {},
    catalog,
    pendingTemplate,
    picker,
    recent = [],
    locale = "zh-cn";
  const buffers = new Map();
  const sessions = new Map(),
    requests = new Map();
  let requestId = 0,
    saveState = "clean";
  const T = (key, ...args) =>
    AtelierI18n.translate(locale, String(key), ...args);
  let state,
    draft,
    tools = [],
    selected,
    selectedTool,
    mode = "configurations",
    dirty = false,
    sdkMode = "search",
    sdkPackages = [],
    sdkDetails;
  const uuid = () => crypto.randomUUID();
  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = T(text);
    if (className) node.className = className;
    return node;
  }
  function button(text, action, icon, primary = false) {
    const node = el("button");
    if (icon) {
      const span = el("span", undefined, `codicon codicon-${icon}`);
      span.setAttribute("aria-hidden", "true");
      node.append(span);
    }
    if (text) node.append(document.createTextNode(T(text)));
    node.className = (icon ? "icon-button " : "") + (primary ? "primary" : "");
    node.onclick = action;
    return node;
  }
  function notice(text, error = false) {
    $("status").textContent = T(text);
    $("status").className = `status${error ? " error" : ""}`;
  }
  function value() {
    return draft?.configurations.find((c) => c.id === selected);
  }
  function status(state, error) {
    saveState = state;
    const node = $("status");
    if (!node) return;
    node.replaceChildren();
    node.className = "status save-state " + state;
    const icon = el(
      "span",
      undefined,
      "codicon codicon-" +
        {
          clean: "check",
          pending: "circle-outline",
          saving: "sync",
          invalid: "warning",
          conflict: "warning",
          error: "error",
        }[state],
    );
    icon.setAttribute("aria-hidden", "true");
    node.append(
      icon,
      el(
        "span",
        error ||
          {
            clean: "Saved",
            pending: "Pending",
            saving: "Saving",
            invalid: "Fix configuration",
            conflict: "Configuration changed externally",
            error: "Save failed",
          }[state],
      ),
    );
    if (state === "error")
      node.append(button("Retry", () => session()?.retry(), "refresh"));
    if (state === "conflict") {
      node.append(
        button(
          "Compare changes",
          () =>
            send("compareDraft", { folder: stateFolder(), document: draft }),
          "diff",
        ),
        button(
          "Reload",
          async () => {
            if (await confirmAction("confirmReload", {})) {
              sessions.delete(stateFolder());
              buffers.delete(stateFolder());
              send("clearDraft", { folder: stateFolder(), force: true });
              send("reload");
            }
          },
          "refresh",
        ),
        button("Keep draft", () =>
          notice("Draft retained. External changes were not overwritten."),
        ),
      );
    }
  }
  const stateFolder = () => state?.folder;
  function call(type, payload) {
    const request = ++requestId;
    return new Promise((resolve, reject) => {
      requests.set(request, { resolve, reject });
      send(type, { ...payload, request });
    });
  }
  async function confirmAction(type, payload) {
    const result = await call(type, { folder: stateFolder(), ...payload });
    return result.accepted;
  }
  function validateSnapshot(snapshot) {
    if (snapshot.folder === state?.folder) {
      for (const input of document.querySelectorAll(
        "[data-field]:not([data-json])",
      )) {
        input.removeAttribute("aria-invalid");
        input.closest(".field")?.querySelector(".field-error")?.remove();
      }
    }
    const issue = (c, key, message) => {
      if (snapshot.folder === state?.folder && snapshot.selected === c.id) {
        const input = document.getElementById("field-" + key);
        if (input) {
          input.setAttribute("aria-invalid", "true");
          const error = el("div", message, "field-error");
          error.setAttribute("role", "alert");
          input.closest(".field")?.append(error);
        }
      }
      return T(message);
    };
    if (snapshot.invalid) return T("Invalid input");
    for (const c of snapshot.document.configurations) {
      if (!c.name.trim())
        return issue(c, "name", "Configuration name is required.");
      if (!c.target.trim()) return issue(c, "target", "Target is required.");
      if (c.templateId === "cargo.example" && !c.example.trim())
        return issue(c, "example", "Choose a Cargo example.");
      if (c.binary && c.example)
        return issue(
          c,
          "example",
          "Choose a Cargo binary or example, not both.",
        );
      if (
        c.language.startsWith("typescript") &&
        c.typescriptRunner === "tsc" &&
        !c.output.trim()
      )
        return issue(
          c,
          "output",
          "Compiled JavaScript output is required for tsc.",
        );
      for (const [key, ref] of Object.entries(c.env)) {
        if (
          !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key) ||
          !/^\$\{(?:env|secret):[a-zA-Z_][a-zA-Z0-9_.-]*\}$/.test(ref)
        )
          return T("Use an environment or secret reference.");
      }
    }
  }
  function session() {
    if (!state) return;
    let current = sessions.get(state.folder);
    if (!current) {
      const folder = state.folder;
      current = new AtelierAutosave.Autosave({
        revision: state.revision,
        validate: validateSnapshot,
        write: (payload) => call("autosave", payload),
        persist: (payload) => send("draft", payload),
        onState: (next, error) => {
          if (state.folder === folder) status(next, error);
        },
        onSaved: (result, latest) => {
          const buffer = buffers.get(folder);
          if (buffer) buffer.revision = result.revision;
          if (state.folder !== folder) return;
          state.revision = result.revision;
          state.document = result.document;
          const references = new Set(
            result.document.configurations.map(
              (c) => c.toolchain.match(/^\$\{toolchain:([^}]+)\}$/)?.[1],
            ),
          );
          for (const tool of result.toolchains || []) {
            if (references.has(tool.id)) {
              const existing = tools.find((t) => t.id === tool.id);
              if (!existing) tools.push(tool);
              else if (latest) Object.assign(existing, tool);
            }
          }
          if (latest) {
            const previous = new Map(
              draft.configurations.map((c) => [c.id, c]),
            );
            const normalized = JSON.parse(JSON.stringify(result.document));
            normalized.configurations = normalized.configurations.map((c) => {
              const existing = previous.get(c.id);
              return existing ? Object.assign(existing, c) : c;
            });
            draft = normalized;
            sources = { ...result.sources };
            dirty = false;
            buffers.delete(folder);
            send("clearDraft", { folder, draftId: result.draftId });
            renderList();
          }
        },
      });
      sessions.set(folder, current);
    }
    return current;
  }
  function snapshot() {
    const rawFields = {};
    for (const input of document.querySelectorAll("[data-field]"))
      rawFields[input.dataset.field] =
        input.type === "checkbox" ? input.checked : input.value;
    const valid = flush();
    return {
      draftId: uuid(),
      folder: state.folder,
      root: catalog?.context.root || state.root,
      document: JSON.parse(JSON.stringify(draft)),
      sources: { ...sources },
      toolchains: JSON.parse(JSON.stringify(tools)),
      selected,
      rawFields,
      invalid: !valid,
    };
  }
  function mark(immediate = false) {
    dirty = true;
    if (!state) return;
    session().edit(snapshot(), immediate);
  }
  function commitPending() {
    if (dirty && mode === "configurations") mark(true);
    else void session()?.flush();
  }
  function flush() {
    if (mode !== "configurations") return true;
    const current = value();
    if (!current) return true;
    try {
      for (const input of document.querySelectorAll("[data-field]")) {
        if (input.dataset.owner && input.dataset.owner !== current.id) continue;
        const key = input.dataset.field;
        current[key] = input.dataset.json
          ? JSON.parse(input.value || (key === "env" ? "{}" : "[]"))
          : input.type === "checkbox"
            ? input.checked
            : input.value;
        if (input.dataset.json) {
          input.removeAttribute("aria-invalid");
          input.closest(".field")?.querySelector(".field-error")?.remove();
        }
      }
      return true;
    } catch (error) {
      for (const input of document.querySelectorAll("[data-json]")) {
        try {
          JSON.parse(input.value);
          input.removeAttribute("aria-invalid");
          input.parentElement.querySelector(".field-error")?.remove();
        } catch {
          input.setAttribute("aria-invalid", "true");
          if (!input.parentElement.querySelector(".field-error")) {
            const hint = el(
              "div",
              T("Invalid JSON field: {0}", error.message),
              "field-error",
            );
            hint.setAttribute("role", "alert");
            input.parentElement.append(hint);
          }
        }
      }
      return false;
    }
  }
  function arrayEditor(container, key, label, c, opts) {
    const wrap = el("div", undefined, "field wide");
    wrap.append(el("label", label));
    const rows = el("div", undefined, "value-rows");
    const draw = () => {
      rows.replaceChildren();
      c[key].forEach((entry, index) => {
        const row = el("div", undefined, "value-row");
        const input = el("input");
        input.value = entry;
        input.setAttribute("aria-label", T(label) + " " + (index + 1));
        input.oninput = () => {
          c[key][index] = input.value;
          mark();
        };
        const remove = button(
          "",
          () => {
            c[key].splice(index, 1);
            mark();
            draw();
          },
          "remove",
        );
        remove.setAttribute("aria-label", T("Remove") + " " + (index + 1));
        row.append(input, remove);
        rows.append(row);
      });
    };
    draw();
    wrap.append(
      rows,
      button(
        "Add row",
        () => {
          c[key].push("");
          mark();
          draw();
          rows.querySelector("input:last-of-type")?.focus();
        },
        "add",
      ),
    );
    if (opts.hint) wrap.append(el("div", opts.hint, "hint"));
    container.append(wrap);
    return rows;
  }
  function environmentEditor(container, c) {
    const wrap = el("div", undefined, "field wide");
    wrap.append(el("label", "Environment references (JSON object)"));
    const rows = el("div", undefined, "value-rows");
    let entries = Object.entries(c.env);
    const draw = () => {
      rows.replaceChildren();
      entries.forEach(([name, ref], index) => {
        const row = el("div", undefined, "value-row");
        const key = el("input");
        key.value = name;
        key.placeholder = T("Environment variable");
        key.setAttribute(
          "aria-label",
          T("Environment variable") + " " + (index + 1),
        );
        const input = el("input");
        input.value = ref;
        input.placeholder = "${env:NAME} / ${secret:NAME}";
        input.setAttribute("aria-label", T("Reference") + " " + (index + 1));
        const update = () => {
          entries[index] = [key.value, input.value];
          c.env = Object.fromEntries(entries);
          mark();
        };
        key.oninput = update;
        input.oninput = update;
        const remove = button(
          "",
          () => {
            entries.splice(index, 1);
            c.env = Object.fromEntries(entries);
            mark();
            draw();
          },
          "remove",
        );
        remove.setAttribute("aria-label", T("Remove") + " " + (index + 1));
        row.append(key, input, remove);
        rows.append(row);
      });
    };
    draw();
    wrap.append(
      rows,
      button(
        "Add row",
        () => {
          entries.push(["", ""]);
          draw();
        },
        "add",
      ),
      el(
        "div",
        'Use {"API_TOKEN":"${secret:API_TOKEN}"} or {"MODE":"${env:MODE}"}. Plaintext environment values are rejected.',
        "hint",
      ),
    );
    container.append(wrap);
    return rows;
  }
  function field(container, key, label, opts = {}) {
    const c = opts.object || value();
    if (
      opts.json &&
      !opts.raw &&
      Array.isArray(c[key]) &&
      ["args", "buildArgs", "features"].includes(key)
    )
      return arrayEditor(container, key, label, c, opts);
    if (opts.json && !opts.raw && key === "env")
      return environmentEditor(container, c);
    const wrap = el("div", undefined, `field${opts.wide ? " wide" : ""}`);
    const labelNode = el("label", label);
    labelNode.htmlFor = `field-${key}`;
    wrap.append(labelNode);
    let input;
    if (opts.options) {
      input = el("select");
      for (const choice of opts.options) {
        const [v, text] = Array.isArray(choice) ? choice : [choice, choice];
        const option = el("option", T(text));
        option.value = v;
        input.append(option);
      }
      input.value = c[key] || "";
    } else {
      input = el(opts.json || opts.multiline ? "textarea" : "input");
      input.value = opts.json
        ? JSON.stringify(c[key] ?? (key === "env" ? {} : []), null, 2)
        : c[key] || "";
      if (opts.readonly) input.readOnly = true;
      if (opts.translateValue) input.value = T(input.value);
    }
    input.id = `field-${key}`;
    if (!opts.object) {
      input.dataset.field = key;
      input.dataset.owner = c.id;
      if (opts.json) input.dataset.json = "1";
    }
    input.oninput = () => {
      if (opts.object || !opts.json) {
        c[key] = input.value;
      }
      mark(false);
      if (key === "name") {
        c.name = input.value;
        renderList();
      }
    };
    if (opts.options) {
      input.onchange = () => {
        if (!flush()) return;
        c[key] = input.value;
        mark(true);
        if (key === "language") c.templateId = "";
        if (
          key === "language" &&
          ["rust", "csharp"].includes(c.language) &&
          c.kind === "file"
        ) {
          c.kind = "project";
          c.target = ".";
        }
        if (opts.rerender) renderMain();
      };
    }
    if (opts.browse) {
      const picker = el("div", undefined, "picker");
      picker.append(
        input,
        button(
          "Browse...",
          () =>
            send("browse", {
              field: opts.object ? "tcPath" : key,
              directory: opts.directory === true,
              configurationId: c.id,
              toolId: opts.object ? c.id : undefined,
            }),
          "folder-opened",
        ),
      );
      wrap.append(picker);
    } else {
      wrap.append(input);
    }
    if (opts.hint) wrap.append(el("div", opts.hint, "hint"));
    container.append(wrap);
    return input;
  }
  function check(container, key, label) {
    const wrap = el("label", undefined, "check");
    const input = el("input");
    input.type = "checkbox";
    input.checked = !!value()[key];
    input.dataset.field = key;
    input.dataset.owner = value().id;
    input.onchange = () => mark(true);
    wrap.append(input, document.createTextNode(T(label)));
    container.append(wrap);
  }
  function shell() {
    const app = $("app");
    app.replaceChildren();
    const header = el("header");
    const toggle = button(
      "",
      () => {
        app.classList.toggle("sidebar-collapsed");
      },
      "layout-sidebar-left",
    );
    toggle.setAttribute("aria-label", T("Toggle sidebar"));
    const brand = el("h1", "Sakura Atelier");
    const workspaceLabel = el("label", "Current workspace");
    workspaceLabel.htmlFor = "workspace";
    const workspace = el("select", undefined, "workspace");
    workspace.id = "workspace";
    workspace.setAttribute("aria-label", T("Current workspace"));
    workspace.onchange = () => {
      commitPending();
      rememberWorkspace();
      send("workspace", { folder: workspace.value });
    };
    const saved = el("div", undefined, "status");
    saved.id = "status";
    saved.setAttribute("role", "status");
    saved.setAttribute("aria-live", "polite");
    header.append(toggle, brand, workspaceLabel, workspace, saved);
    app.append(header);
    const layout = el("div", undefined, "layout");
    const aside = el("aside");
    aside.id = "list";
    aside.setAttribute("aria-label", T("Sakura Atelier"));
    const splitter = el("div", undefined, "sidebar-splitter");
    splitter.tabIndex = 0;
    splitter.setAttribute("role", "separator");
    splitter.setAttribute("aria-orientation", "vertical");
    splitter.setAttribute("aria-label", T("Resize sidebar"));
    const resize = (width) => {
      width = Math.max(140, Math.min(380, window.innerWidth * 0.55, width));
      app.style.setProperty("--sidebar-width", width + "px");
      splitter.setAttribute("aria-valuenow", String(Math.round(width)));
      vscode.setState({ ...vscode.getState(), sidebarWidth: width });
    };
    resize(vscode.getState()?.sidebarWidth || 244);
    splitter.onpointerdown = (event) => {
      splitter.setPointerCapture(event.pointerId);
      splitter.onpointermove = (e) => resize(e.clientX);
      splitter.onpointerup = () => {
        splitter.onpointermove = null;
      };
    };
    splitter.onkeydown = (e) => {
      if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        resize(
          parseFloat(app.style.getPropertyValue("--sidebar-width")) +
            (e.key === "ArrowRight" ? 12 : -12),
        );
      }
    };
    const main = el("main");
    main.id = "main";
    layout.append(aside, splitter, main);
    app.append(layout);
    app.addEventListener("focusout", (event) => {
      if (event.target.matches("input,textarea,select")) commitPending();
    });
  }
  function render() {
    if (!state) return;
    const workspace = $("workspace");
    workspace.replaceChildren();
    for (const w of state.workspaces) {
      const option = el("option", w.name);
      option.value = w.uri;
      workspace.append(option);
    }
    workspace.value = state.folder;
    renderList();
    renderMain();
  }
  function rememberWorkspace() {
    if (state)
      buffers.set(state.folder, {
        draft: JSON.parse(JSON.stringify(draft)),
        sources: { ...sources },
        tools: JSON.parse(JSON.stringify(tools)),
        selected,
        dirty,
        revision: state.revision,
      });
  }
  function createFromTemplate(template, context) {
    if (!flush()) return;
    if (context.folder !== state.folder) {
      rememberWorkspace();
      pendingTemplate = { template, context };
      send("workspace", { folder: context.folder });
      return;
    }
    const c = JSON.parse(JSON.stringify(template.configuration));
    c.id = uuid();
    c.name = T(template.label);
    let suffix = 2;
    while (draft.configurations.some((item) => item.name === c.name))
      c.name = T(template.label) + " (" + suffix++ + ")";
    draft.configurations.push(c);
    sources[c.id] = "personal";
    selected = c.id;
    mode = "configurations";
    recent = [template.id, ...recent.filter((id) => id !== template.id)].slice(
      0,
      6,
    );
    send("templateUsed", { id: template.id });
    mark(false);
    render();
    document.getElementById("field-name")?.focus();
  }
  function addConfiguration(event) {
    if (!flush()) return;
    if (!catalog) {
      notice("Loading…");
      send("templates");
      return;
    }
    picker.show(
      event?.currentTarget || document.getElementById("add-configuration"),
      catalog,
    );
  }
  function storageFields(main, c) {
    const section = el("section", undefined, "storage-section");
    section.setAttribute("aria-label", T("Save location"));
    section.append(el("span", "Save location", "storage-label"));
    for (const [id, label, icon] of [
      ["personal", "Personal configuration (this machine only)", "lock"],
      ["project", "Project configuration (shareable)", "organization"],
    ]) {
      const text = el("label", undefined, "storage-choice");
      const input = el("input");
      input.type = "radio";
      input.name = "configuration-storage";
      input.value = id;
      input.checked = (sources[c.id] || "project") === id;
      input.onchange = async () => {
        input.checked = false;
        const accepted = await confirmAction("confirmMigration", {
          id: c.id,
          name: c.name,
          source: id,
        });
        if (!accepted) {
          renderMain();
          return;
        }
        if (!flush()) return;
        sources[c.id] = id;
        mark(true);
        renderList();
        renderMain();
      };
      const codicon = el("span", undefined, "codicon codicon-" + icon);
      codicon.setAttribute("aria-hidden", "true");
      text.append(input, codicon, document.createTextNode(T(label)));
      section.append(text);
    }
    if (sources[c.id] === "project") {
      const path = el("div", undefined, "storage-path");
      path.append(
        el(
          "span",
          T("Project folder") +
            ": " +
            state.workspaces.find((w) => w.uri === state.folder)?.name,
        ),
        el("code", ".vscode/sakura-atelier.json"),
        button(
          "Open configuration file",
          () => send("openConfigurationFile"),
          "go-to-file",
        ),
      );
      section.append(path);
    }
    main.append(section);
  }
  function renderList() {
    const list = $("list");
    list.replaceChildren();
    list.setAttribute("role", "tree");
    const nav = (parent, label, action, icon, active = false) => {
      const n = button(
        label,
        () => {
          commitPending();
          action();
        },
        icon,
      );
      n.className = "tree-item" + (active ? " selected" : "");
      n.setAttribute("role", "treeitem");
      n.setAttribute("aria-selected", String(active));
      parent.append(n);
      return n;
    };
    const group = (label, key, action) => {
      const collapsed = new Set(vscode.getState()?.navigationCollapsed || []);
      const wrap = el("div", undefined, "navigation-group");
      const head = nav(
        wrap,
        label,
        () => {
          const closed = children.hidden;
          children.hidden = !closed;
          head.setAttribute("aria-expanded", String(closed));
          head.querySelector(".codicon").className =
            "codicon codicon-" + (closed ? "chevron-down" : "chevron-right");
          if (closed) collapsed.delete(key);
          else collapsed.add(key);
          vscode.setState({
            ...vscode.getState(),
            navigationCollapsed: [...collapsed],
          });
          if (closed) action?.();
        },
        collapsed.has(key) ? "chevron-right" : "chevron-down",
      );
      head.setAttribute("aria-expanded", String(!collapsed.has(key)));
      const children = el("div", undefined, "navigation-children");
      children.hidden = collapsed.has(key);
      children.setAttribute("role", "group");
      wrap.append(children);
      list.append(wrap);
      return children;
    };
    const configs = group("Run and Debug", "configurations", () => {
      mode = "configurations";
      renderMain();
    });
    const add = nav(
      configs,
      "Add Configuration...",
      () => addConfiguration({ currentTarget: add }),
      "add",
    );
    nav(configs, "New Embedded Project...", () => send("newProject"), "new-folder");
    add.id = "add-configuration";
    add.setAttribute("aria-haspopup", "dialog");
    add.setAttribute("aria-expanded", "false");
    for (const language of [
      ...new Set(draft.configurations.map((c) => c.language)),
    ]) {
      const heading = el(
        "div",
        languageName[language] || language,
        "group-title",
      );
      configs.append(heading);
      for (const c of draft.configurations.filter(
        (c) => c.language === language,
      )) {
        const item = nav(
          configs,
          "",
          () => {
            if (flush()) {
              selected = c.id;
              mode = "configurations";
              render();
            }
          },
          "play",
          mode === "configurations" && selected === c.id,
        );
        const name = el("span");
        name.textContent = (draft.default === c.id ? "★ " : "") + c.name;
        const badge = el(
          "span",
          undefined,
          "codicon codicon-" +
            (sources[c.id] === "personal" ? "lock" : "organization"),
        );
        badge.setAttribute("aria-hidden", "true");
        item.append(name, badge);
        item.title =
          c.name +
          " · " +
          T(
            sources[c.id] === "personal"
              ? "Stored only on this machine"
              : "Stored in .vscode/sakura-atelier.json",
          );
      }
    }
    const environment = group("Development Environments", "environment");
    nav(
      environment,
      "Overview",
      () => {
        mode = "toolchains";
        environmentLanguage = undefined;
        render();
      },
      "dashboard",
      mode === "toolchains" && !environmentLanguage,
    );
    for (const [language, label] of [
      ["go", "Go SDK"],
      ["rust", "Rust toolchain"],
      ["python", "Python interpreters"],
      ["node", "Node.js"],
      ["c", "C compiler"],
      ["cpp", "C++ compiler"],
      ["csharp", ".NET SDK"],
      ["java", "Java"],
    ]) {
      nav(
        environment,
        label,
        () => {
          mode = "toolchains";
          environmentLanguage = language;
          selectedTool = tools.find((t) => t.language === language)?.id;
          render();
        },
        language === "python" ? "symbol-variable" : "tools",
        mode === "toolchains" && environmentLanguage === language,
      );
    }
    const packages = group("SDK Installation and Updates", "sdk");
    for (const [id, label] of [
      ["installed", "Installed SDKs"],
      ["search", "Available SDKs"],
      ["updates", "Updates"],
    ]) {
      nav(
        packages,
        label,
        () => {
          mode = "sdk";
          sdkMode = id;
          sdkDetails = undefined;
          render();
          if (id !== "search") sdkQuery();
        },
        id === "updates" ? "cloud-download" : "package",
        mode === "sdk" && sdkMode === id,
      );
    }
    list.onkeydown = (event) => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const rows = [...list.querySelectorAll("button")].filter(
        (n) => !n.closest("[hidden]"),
      );
      const index = rows.indexOf(document.activeElement);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? rows.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + rows.length) %
              rows.length;
      event.preventDefault();
      rows[next]?.focus();
    };
  }
  async function deleteConfiguration() {
    const c = value();
    if (
      !c ||
      !(await confirmAction("confirmDelete", { id: c.id, name: c.name }))
    )
      return;
    delete sources[c.id];
    draft.configurations = draft.configurations.filter(
      (item) => item.id !== c.id,
    );
    if (draft.default === c.id) delete draft.default;
    selected = draft.configurations[0]?.id;
    mark(true);
    render();
  }
  function copyConfiguration() {
    if (!flush() || !value()) return;
    const c = JSON.parse(JSON.stringify(value()));
    c.id = uuid();
    c.name += T(" (copy)");
    draft.configurations.push(c);
    sources[c.id] = "personal";
    selected = c.id;
    mark(true);
    render();
  }
  function renderMain() {
    const main = $("main");
    main.replaceChildren();
    if (mode === "sdk") {
      renderSdk(main);
      return;
    }
    if (mode === "toolchains") {
      renderTools(main);
      return;
    }
    const c = value();
    if (!c) {
      const empty = el("div", undefined, "empty");
      empty.append(
        el("h2", "Choose how your project runs"),
        el(
          "p",
          "Add a configuration to choose its entry, SDK, arguments and debug configuration. Existing launch.json and tasks.json remain unchanged.",
        ),
        button("Add Configuration...", addConfiguration, "add", true),
      );
      main.append(empty);
      return;
    }
    const heading = el("h2");
    heading.textContent = c.name;
    const headingRow = el("div", undefined, "detail-heading");
    const actions = el("div", undefined, "buttons");
    actions.append(
      button("Copy", copyConfiguration, "copy"),
      button("Delete", deleteConfiguration, "trash"),
    );
    headingRow.append(heading, actions);
    main.append(headingRow);
    const template = catalog?.templates.find((t) => t.id === c.templateId);
    const uses = (key) => !template || template.fields.includes(key);
    if (template)
      main.append(
        el(
          "p",
          T(template.label) + " · " + T(languageName[c.language] || c.language),
          "template-form-caption",
        ),
      );
    storageFields(main, c);
    const form = el("div", undefined, "form");
    main.append(form);
    field(form, "name", "Configuration name", { wide: true });
    if (!template) {
      field(form, "language", "Language / Runtime", {
        options: languages.map((l) => [l, languageName[l]]),
        rerender: true,
      });
      const kinds = [
        "file",
        "project",
        "module",
        "executable",
        "task",
        "launch",
      ].filter(
        (k) =>
          !(
            ["rust", "csharp"].includes(c.language) &&
            ["file", "module"].includes(k)
          ) && !(k === "module" && !["python", "java"].includes(c.language)),
      );
      field(form, "kind", "Configuration type", {
        options: kinds,
        rerender: true,
      });
      field(form, "operation", "Action", {
        options: ["run", "build", "test"],
        rerender: true,
      });
    }
    const targetLabel =
      template?.targetLabel ||
      (c.kind === "module"
        ? "Module"
        : c.kind === "launch"
          ? "launch.json configuration name"
          : c.kind === "task"
            ? "tasks.json task label"
            : c.kind === "project" && ["c", "cpp"].includes(c.language)
              ? "CMake build directory / Make project"
              : "Target file / package / project");
    field(form, "target", targetLabel, {
      options:
        c.kind === "task"
          ? [
              ["", "Choose a task"],
              ...(catalog?.context.tasks || []).map((name) => [name, name]),
            ]
          : undefined,
      browse: !["module", "task", "launch"].includes(c.kind),
      directory:
        c.kind === "project" && !["rust", "csharp", "go"].includes(c.language),
      wide: true,
    });
    if (["task", "launch"].includes(c.kind)) {
      form.append(
        el(
          "p",
          "This configuration delegates to the existing native task/launch entry. Its SDK, working directory, parameters and environment remain in tasks.json / launch.json; they are not overwritten.",
          "hint",
        ),
      );
      field(form, "preLaunchTask", "Additional pre-launch task label");
      if (c.kind === "task")
        field(
          form,
          "debugName",
          "Corresponding launch.json Debug Configuration",
          {
            options: [
              ["", "Choose a Debug configuration"],
              ...state.launch.map((l) => [l.name, l.name]),
            ],
            wide: true,
          },
        );
      form.append(
        button(
          "Configure launch.json...",
          () => send("nativeDebug"),
          "debug-alt",
        ),
      );
      const def = el("label", undefined, "check");
      const tick = el("input");
      tick.type = "checkbox";
      tick.checked = draft.default === c.id;
      tick.onchange = () => {
        if (tick.checked) draft.default = c.id;
        else delete draft.default;
        mark(true);
        renderList();
      };
      def.append(
        tick,
        document.createTextNode(T("Project default configuration")),
      );
      form.append(def);
      return;
    }
    field(form, "cwd", "Working directory", {
      browse: true,
      directory: true,
      wide: true,
    });
    const label =
      c.language === "python"
        ? "Interpreter / Virtual Environment"
        : c.language === "rust"
          ? "Cargo executable"
          : c.language === "go"
            ? "Go executable / SDK"
            : c.language === "csharp"
              ? ".NET SDK executable"
              : ["c", "cpp"].includes(c.language)
                ? "Compiler executable"
                : ["javascript", "typescript", "node"].includes(c.language)
                  ? "Node Runtime"
                  : "JDK executable";
    const input = field(form, "toolchain", label, {
      browse: true,
      wide: true,
      hint: "Empty inherits workspace → Sakura Atelier global default → automatic discovery. Project paths support ${workspaceFolder}; external SDK paths are saved locally.",
    });
    const currentTemplate = catalog?.templates.find(
      (t) => t.id === c.templateId,
    );
    const known = tools.filter(
      (t) =>
        t.language === c.language ||
        (t.language === "node" &&
          ["typescript", "javascript", "node"].includes(c.language)),
    );
    const selectedSDK = c.toolchain.match(/^\$\{toolchain:([^}]+)\}$/)?.[1];
    const missingSelected =
      selectedSDK && !known.some((t) => t.id === selectedSDK);
    if (
      (currentTemplate?.status === "missing" && !c.toolchain) ||
      missingSelected
    ) {
      const banner = el("div", undefined, "sdk-banner wide");
      banner.setAttribute("role", "status");
      banner.append(
        el(
          "span",
          missingSelected
            ? "Selected SDK was not found. Choose another toolchain."
            : currentTemplate.reason,
        ),
        button(
          "Install SDK",
          () => {
            if (flush()) {
              mode = "sdk";
              render();
            }
          },
          "cloud-download",
        ),
        button(
          "Select Existing Toolchain",
          () => {
            if (flush()) {
              mode = "toolchains";
              render();
            }
          },
          "tools",
        ),
      );
      form.append(banner);
    }
    const choices = el("select");
    choices.setAttribute("aria-label", T("Choose discovered SDK"));
    const none = el("option", "Use project default");
    none.value = "";
    choices.append(none);
    for (const t of tools.filter(
      (t) =>
        t.language === c.language ||
        (t.language === "node" &&
          ["typescript", "javascript", "node"].includes(c.language)),
    )) {
      const o = el("option", `${t.name} · ${t.version} · ${t.manager}`);
      o.value = t.id;
      choices.append(o);
    }
    for (const [id, label] of [
      ["@scan", "Scan this machine"],
      ["@locate", "Choose existing SDK"],
      ["@install", "Install new SDK"],
    ]) {
      const o = el("option", label);
      o.value = id;
      choices.append(o);
    }
    choices.value = selectedSDK || "";
    choices.onchange = () => {
      if (!choices.value) {
        c.toolchain = "";
        input.value = "";
        mark(true);
        return;
      }
      if (choices.value === "@scan") {
        send("discover", { language: c.language });
        return;
      }
      if (choices.value === "@locate") {
        send("browse", { field: "toolchain", configurationId: c.id });
        return;
      }
      if (choices.value === "@install") {
        mode = "sdk";
        sdkMode = "search";
        vscode.setState({
          ...vscode.getState(),
          sdkSearch:
            c.language === "csharp"
              ? "dotnet"
              : c.language === "cpp"
                ? "clang"
                : c.language,
        });
        render();
        return;
      }
      c.toolchain = "${toolchain:" + choices.value + "}";
      const sdk = tools.find((t) => t.id === choices.value);
      if (c.language === "rust" && sdk?.rustToolchain)
        c.rustToolchain = sdk.rustToolchain;
      input.value = c.toolchain;
      mark(true);
      if (c.language === "python") send("pythonSelect", { id: choices.value });
    };
    form.append(
      choices,
      button(
        c.language === "python"
          ? "Discover Python Environments"
          : "Discover SDKs",
        () => {
          notice("Discovering installed toolchains...");
          send("discover", { language: c.language });
        },
        "search",
      ),
    );
    if (c.language === "python") {
      const help = el(
        "div",
        state.pythonStatus ||
          T(
            "Official terminal activation: {0}; legacy activateEnvironment: {1}",
            T(state.terminalActivation.modern),
            T(String(state.terminalActivation.legacy)),
          ),
        "hint wide",
      );
      form.append(help);
      check(
        form,
        "autoActivate",
        "Activate environment in new Sakura Atelier terminals",
      );
      form.append(
        button(
          "Open Python Terminal",
          () => {
            if (dirty) {
              notice(
                "Apply this configuration before opening its terminal.",
                true,
              );
              return;
            }
            send("terminal");
          },
          "terminal",
        ),
      );
    }
    const advanced = el("details", undefined, "advanced-options wide");
    advanced.append(el("summary", "Advanced options"));
    const advancedForm = el("div", undefined, "form");
    advanced.append(advancedForm);
    const advancedField = (key, label, opts = {}) =>
      field(advancedForm, key, label, opts);
    form.append(el("div", "Language options", "section-label"));
    if (["c", "cpp"].includes(c.language)) {
      field(form, "profile", "Build profile", {
        options: ["debug", "release"],
      });
      if (c.kind !== "project")
        field(
          form,
          "standard",
          c.language === "c"
            ? "C standard (e.g. c11)"
            : "C++ standard (e.g. c++20)",
        );
      if (c.kind !== "project") {
        advancedField("sources", "Source files (JSON array)", {
          json: true,
          wide: true,
        });
        advancedField("includePaths", "Include paths (JSON array)", {
          json: true,
        });
        advancedField("libraryPaths", "Library paths (JSON array)", {
          json: true,
        });
        advancedField("linkArgs", "Linker arguments (JSON array)", {
          json: true,
          wide: true,
        });
      } else {
        form.append(
          el(
            "p",
            "For CMake/Make projects, sources, include paths and libraries remain in the existing build files. CMake compiler changes require a separate build directory; Make controls its own build profile.",
            "hint",
          ),
        );
      }
      if (c.kind === "project") field(form, "binary", "CMake / Make target");
    }
    if (c.language === "go") {
      advancedField("goToolchain", "GOTOOLCHAIN", {
        hint: "Defaults to local; no global Go environment is changed.",
      });
      if (c.operation === "build")
        field(form, "output", "Build output", { browse: true });
    }
    if (c.language === "rust") {
      advancedField(
        "rustToolchain",
        "Installed rustup toolchain (stable / beta / nightly / custom)",
      );
      field(form, "profile", "Cargo profile", {
        options: ["debug", "release"],
      });
      field(form, "package", "Cargo package");
      field(form, "binary", "Cargo binary");
      field(form, "example", "Cargo example");
      field(form, "features", "Features (JSON array)", { json: true });
      advancedField("cargoTarget", "Cargo target triple");
    }
    if (
      [
        "node",
        "javascript",
        "typescript",
        "javascriptreact",
        "typescriptreact",
      ].includes(c.language)
    ) {
      if (!template)
        field(form, "packageManager", "Package manager", {
          options: ["npm", "pnpm", "yarn"],
        });
      if (!template || uses("script"))
        field(form, "script", "package.json script (optional)", {
          options: catalog?.context.scripts?.length
            ? [
                ["", "Choose a script"],
                ...catalog.context.scripts.map((name) => [name, name]),
              ]
            : undefined,
        });
      if (c.language.startsWith("typescript")) {
        field(form, "typescriptRunner", "TypeScript execution", {
          options: ["tsx", "ts-node", "tsc"],
          rerender: true,
        });
        if (c.typescriptRunner === "tsc")
          field(form, "output", "Compiled JavaScript entry (tsc)", {
            browse: true,
          });
      }
    }
    if (c.language === "csharp") {
      field(form, "profile", ".NET configuration", {
        options: ["debug", "release"],
      });
      field(form, "framework", "Target framework");
      field(form, "launchProfile", "launchSettings.json profile");
      form.append(
        el(
          "p",
          "For dotnet run select a startup .csproj; .sln/.slnx are valid build/test targets. SDK version policy within one dotnet installation follows the project global.json.",
          "hint",
        ),
      );
    }
    if (c.language === "java") {
      advancedField("classPath", "Classpath entries (JSON array)", {
        json: true,
      });
      advancedField("modulePath", "Module path entries (JSON array)", {
        json: true,
      });
    }
    if (
      ["c", "cpp", "rust"].includes(c.language) &&
      (!template ||
        uses("output") ||
        (["c", "cpp"].includes(c.language) && c.kind === "project"))
    )
      field(form, "output", "Executable output (optional for single files)", {
        browse: true,
        wide: true,
        hint: "Empty single-file outputs use an extension-owned temporary directory. CMake/Make requires the actual output path.",
      });
    advancedField("buildArgs", "Build / compiler arguments (JSON array)", {
      json: true,
      wide: true,
    });
    field(form, "args", "Program / test arguments (JSON array)", {
      json: true,
      wide: true,
    });
    form.append(el("div", "Environment and launch", "section-label"));
    field(form, "env", "Environment references (JSON object)", {
      json: true,
      wide: true,
      hint: 'Use {"API_TOKEN":"${secret:API_TOKEN}"} or {"MODE":"${env:MODE}"}. Plaintext environment values are rejected.',
    });
    form.append(button("Store Secret...", () => send("secret"), "key"));
    advancedField("preLaunchTask", "Pre-launch build task label", {
      options: [
        ["", "None"],
        ...(catalog?.context.tasks || []).map((name) => [name, name]),
      ],
    });
    advancedField("debugName", "Existing launch.json Debug Configuration", {
      options: [
        ["", "Automatic compatible debugger"],
        ...state.launch.map((l) => [l.name, l.name]),
      ],
      wide: true,
    });
    advancedField("debugType", "Debug adapter override (optional)", {
      hint: "Go / debugpy / lldb / cppdbg / cppvsdbg / pwa-node, when installed.",
    });
    check(
      form,
      "terminal",
      "Run in an interactive terminal / use a debug terminal",
    );
    const defaultCheck = el("label", undefined, "check");
    const defaultInput = el("input");
    defaultInput.type = "checkbox";
    defaultInput.checked = draft.default === c.id;
    defaultInput.onchange = () => {
      if (defaultInput.checked) draft.default = c.id;
      else delete draft.default;
      mark(true);
      renderList();
    };
    defaultCheck.append(
      defaultInput,
      document.createTextNode(T("Project default configuration")),
    );
    form.append(defaultCheck);
    advancedForm.append(
      button(
        "Configure launch.json...",
        () => send("nativeDebug"),
        "debug-alt",
      ),
    );
    form.append(advanced);
  }
  function renderTools(main) {
    const names = {
      go: "Go SDK",
      rust: "Rust toolchain",
      python: "Python interpreters",
      node: "Node.js",
      c: "C compiler",
      cpp: "C++ compiler",
      csharp: ".NET SDK",
      java: "Java",
    };
    const language = environmentLanguage;
    if (!language) {
      main.append(
        el("h2", "Environment overview"),
        el(
          "p",
          "Manage installed SDKs, interpreters and compilers for this workspace.",
        ),
      );
      const table = el("table", undefined, "environment-table");
      for (const [id, label] of Object.entries(names)) {
        const row = el("tr");
        const installed = tools.filter((t) => t.language === id);
        const cell = el("td", label);
        const summary = el(
          "td",
          installed.length
            ? T("Configured") +
                " · " +
                installed.map((t) => t.version || t.name).join(", ")
            : T("No SDK configured"),
        );
        const action = el("td");
        action.append(
          button(
            installed.length ? "Choose existing SDK" : "Scan this machine",
            () => {
              environmentLanguage = id;
              selectedTool = installed[0]?.id;
              render();
              if (!installed.length) send("discover", { language: id });
            },
            installed.length ? "settings-gear" : "search",
          ),
        );
        row.append(cell, summary, action);
        table.append(row);
      }
      list.append(table);
      return;
    }
    main.append(el("h2", names[language] || language));
    const matches = tools.filter((t) => t.language === language);
    let tool = matches.find((t) => t.id === selectedTool) || matches[0];
    if (tool) selectedTool = tool.id;
    const selector = el("select");
    selector.setAttribute("aria-label", T("Choose discovered SDK"));
    for (const t of matches) {
      const o = el("option");
      o.textContent = t.name + (t.version ? " · " + t.version : "");
      o.value = t.id;
      selector.append(o);
    }
    selector.value = tool?.id || "";
    selector.onchange = () => {
      selectedTool = selector.value;
      renderMain();
    };
    const row = el("div", undefined, "row");
    if (matches.length) row.append(selector);
    row.append(
      button(
        "Scan this machine",
        () => send("discover", { language }),
        "search",
      ),
      button(
        "Choose existing SDK",
        () => {
          const entry = {
            id: uuid(),
            name: T(names[language] || language),
            language,
            executable: "",
            version: "",
            manager: "custom",
            project: state.folder,
          };
          tools.push(entry);
          selectedTool = entry.id;
          mark(false);
          renderMain();
          send("browse", { field: "tcPath", toolId: entry.id });
        },
        "folder-opened",
      ),
      button(
        "Install SDK",
        () => {
          mode = "sdk";
          sdkMode = "search";
          vscode.setState({
            ...vscode.getState(),
            sdkSearch:
              language === "csharp"
                ? "dotnet"
                : language === "cpp"
                  ? "clang"
                  : language,
          });
          render();
        },
        "cloud-download",
      ),
    );
    main.append(row);
    if (!tool) {
      main.append(
        el("div", "No SDK configured", "sdk-banner"),
        el(
          "p",
          "Missing SDK does not prevent editing; Run will validate it.",
          "hint",
        ),
      );
      return;
    }
    const statusLine = el(
      "div",
      tool.executable ? T("Configured") : T("No SDK configured"),
      "environment-status",
    );
    main.append(statusLine);
    const form = el("div", undefined, "form");
    main.append(form);
    field(form, "name", "SDK name", { object: tool });
    field(form, "version", "Installed version", {
      object: tool,
      readonly: true,
    });
    field(form, "executable", "Executable path", {
      object: tool,
      browse: true,
      wide: true,
    });
    field(form, "manager", "Source", {
      object: tool,
      readonly: true,
      translateValue: true,
    });
    field(
      form,
      "details",
      "SDK details (GOROOT / installed SDKs / rustup toolchains)",
      { object: tool, multiline: true, wide: true, readonly: true },
    );
    const actions = el("div", undefined, "buttons");
    actions.append(
      button(
        "Set Workspace Default",
        () => send("defaultSdk", { id: tool.id, global: false }),
        "check",
      ),
      button("Set Atelier Global Default", () =>
        send("defaultSdk", { id: tool.id, global: true }),
      ),
      button(
        "Remove SDK record",
        async () => {
          if (
            !(await confirmAction("confirmRemoveTool", {
              id: tool.id,
              name: tool.name,
            }))
          )
            return;
          tools = tools.filter((t) => t.id !== tool.id);
          selectedTool = undefined;
          mark(true);
          renderMain();
        },
        "trash",
      ),
    );
    main.append(
      actions,
      el(
        "p",
        "Only removes the local record; SDK files are not deleted.",
        "hint",
      ),
    );
    if (language === "python")
      main.append(
        button(
          "Create Virtual Environment...",
          () => send("createVenv", { id: tool.id }),
          "add",
        ),
      );
  }
  function sdkQuery() {
    notice("Querying package manager...");
    send("sdkList", { mode: sdkMode, keyword: $("sdkSearch")?.value || "go" });
  }
  function renderSdk(main) {
    main.append(
      el("h2", "SDK Manager"),
      el("p", state.sdkStatus),
      el(
        "p",
        "System SDKs are installed only after a native confirmation showing the exact version, source and command. Project dependencies such as TypeScript/tsx should normally be installed through the project package manager.",
      ),
    );
    const row = el("div", undefined, "row");
    const search = el("input");
    search.id = "sdkSearch";
    search.placeholder = T("Search Go, Rust, Python, Node, Clang, .NET...");
    search.value = vscode.getState()?.sdkSearch || "go";
    search.oninput = () =>
      vscode.setState({
        ...(vscode.getState() || {}),
        sdkSearch: search.value,
      });
    search.onkeydown = (e) => {
      if (e.key === "Enter") {
        sdkMode = "search";
        sdkQuery();
      }
    };
    row.append(
      search,
      button(
        "Search",
        () => {
          sdkMode = "search";
          renderList();
          sdkQuery();
        },
        "search",
      ),
      button("Refresh", sdkQuery, "refresh"),
    );
    main.append(row);
    const actions = el("div", undefined, "buttons");
    actions.append(
      button(
        "Package Manager Instructions",
        () => send("sdkHelp"),
        "link-external",
      ),
      button(
        "Locate Existing SDK",
        () => {
          mode = "toolchains";
          render();
        },
        "folder-opened",
      ),
      button(
        "Refresh Toolchains",
        () => {
          notice("Refreshing SDKs...");
          send("refreshTools");
        },
        "refresh",
      ),
    );
    main.append(actions);
    const packages = el("div", undefined, "package-workbench");
    const list = el("div", undefined, "package-list");
    const detailPane = el("div", undefined, "package-details");
    packages.append(list, detailPane);
    main.append(packages);
    const table = el("table", undefined, "sdk-table");
    const head = el("tr");
    for (const name of [
      "SDK / Package",
      "Version",
      "Installed",
      "Source",
      "Kind",
    ])
      head.append(el("th", name));
    table.append(head);
    for (const item of sdkPackages) {
      const row = el("tr");
      for (const text of [
        item.name,
        item.version || "Query details",
        item.installedVersion || "—",
        item.source,
        item.kind,
      ])
        row.append(el("td", text));
      row.onclick = () => {
        notice("Querying exact package details...");
        send("sdkDetails", { item });
      };
      table.append(row);
    }
    list.append(table);
    if (!sdkPackages.length)
      list.append(
        el(
          "p",
          "Search a package or choose Installed SDKs / Updates. Empty results and missing package managers are reported without installing anything.",
          "hint",
        ),
      );
    if (sdkDetails) {
      const d = sdkDetails;
      const details = el("section", undefined, "details");
      details.append(
        el("h2", d.name),
        el(
          "p",
          `${T("ID")}: ${d.id}\n${T("Source")}: ${d.source}\n${T("Kind")}: ${T(d.kind)} · ${T(d.scope || "system")}\n${T("Language")}: ${T(d.language || "Unclassified")}\n${T("Installation path")}: ${d.installedPath || T("Locate the executable in Toolchains")}\n${T("Installed")}: ${d.installedVersion || T("not installed")}`,
        ),
        el("p", d.description || ""),
        el("p", d.details || ""),
      );
      const version = el("select");
      version.setAttribute("aria-label", T("SDK version"));
      for (const v of d.versions) {
        const o = el("option", v);
        o.value = v;
        version.append(o);
      }
      details.append(
        version,
        button(
          "Install",
          () =>
            send("sdkInstall", {
              key: `${d.kind}:${d.source}:${d.id}`,
              version: version.value,
            }),
          "cloud-download",
          true,
        ),
        el(
          "p",
          "Installation may prompt for administrator permission or licenses in the terminal. Sakura Atelier does not read passwords or accept licenses for you.",
          "hint",
        ),
      );
      detailPane.append(details);
    } else {
      detailPane.append(el("p", "Select a package to view details.", "hint"));
    }
  }
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || typeof message !== "object") return;
    if (["confirmed", "autosaved", "autosaveError"].includes(message.type)) {
      const pending = requests.get(message.request);
      if (pending) {
        requests.delete(message.request);
        if (message.type === "autosaveError") pending.reject(message);
        else pending.resolve(message);
      }
      return;
    }
    if (message.type === "state") {
      state = message;
      document.documentElement.lang = message.locale || locale;
      locale = message.locale || locale;
      catalog = message.catalog;
      recent = catalog?.recent || recent;
      sources = { ...message.sources };
      draft = JSON.parse(JSON.stringify(state.document));
      tools = JSON.parse(JSON.stringify(state.toolchains));
      selected = draft.configurations.some((c) => c.id === selected)
        ? selected
        : draft.default || draft.configurations[0]?.id;
      selectedTool = tools.some((t) => t.id === selectedTool)
        ? selectedTool
        : tools[0]?.id;
      if (message.mode) mode = message.mode;
      dirty = false;
      const buffer = buffers.get(state.folder);
      if (buffer) {
        draft = buffer.draft;
        sources = buffer.sources;
        tools = buffer.tools;
        selected = buffer.selected;
        dirty = buffer.dirty;
        state.revision = buffer.revision;
      }
      shell();
      render();
      session();
      status("clean");
      if (message.recoveredDraft && !buffer) {
        try {
          const recovered = JSON.parse(message.recoveredDraft);
          draft = recovered.document;
          sources = recovered.sources;
          tools = recovered.toolchains;
          selected = recovered.selected;
          dirty = true;
          const active = session();
          active.revision = recovered.revision || state.revision;
          active.snapshot = recovered;
          active.blocked = active.revision !== state.revision;
          render();
          for (const [key, val] of Object.entries(recovered.rawFields || {})) {
            const input = document.getElementById("field-" + key);
            if (input)
              input.type === "checkbox"
                ? (input.checked = val)
                : (input.value = val);
          }
          status(
            active.blocked
              ? "conflict"
              : recovered.invalid
                ? "invalid"
                : "pending",
            T("Draft restored"),
          );
          if (!active.blocked && !recovered.invalid)
            active.edit({ ...recovered, revision: active.revision }, false);
        } catch {
          status("error", T("Invalid input"));
        }
      }
      if (pendingTemplate && pendingTemplate.context.folder === state.folder) {
        const pending = pendingTemplate;
        pendingTemplate = undefined;
        catalog.context = pending.context;
        createFromTemplate(pending.template, pending.context);
      } else if (message.add) addConfiguration();
    } else if (message.type === "mode") {
      if (!flush()) return;
      mode = message.mode;
      state.file = message.file;
      state.language = message.language;
      if (message.sdkStatus) state.sdkStatus = message.sdkStatus;
      render();
      if (message.add) addConfiguration();
    } else if (message.type === "templates") {
      catalog = message.catalog;
      if (picker.popup) picker.update(catalog);
      else if (mode === "configurations" && flush()) renderMain();
    } else if (message.type === "locale") {
      const preserved = snapshot();
      picker.close(false);
      locale = message.locale;
      document.documentElement.lang = locale;
      rememberWorkspace();
      shell();
      render();
      for (const [key, val] of Object.entries(preserved.rawFields || {})) {
        const input = document.getElementById("field-" + key);
        if (input)
          input.type === "checkbox"
            ? (input.checked = val)
            : (input.value = val);
      }
      status(session()?.state || "clean");
    } else if (message.type === "toolsRefreshed") {
      if (!flush()) return;
      const map = new Map([...message.tools, ...tools].map((t) => [t.id, t]));
      tools = [...map.values()];
      state.sdkStatus = message.sdkStatus;
      render();
      notice(
        "Installed toolchains refreshed. Unsaved configuration edits were preserved.",
      );
    } else if (message.type === "saved") {
      state.document = message.document;
      state.revision = message.revision;
      draft = JSON.parse(JSON.stringify(message.document));
      sources = { ...message.sources };
      buffers.delete(state.folder);
      dirty = false;
      render();
      status("clean");
    } else if (message.type === "draftError") {
      const warning = el("div", message.message, "draft-warning");
      warning.setAttribute("role", "status");
      document.querySelector(".draft-warning")?.remove();
      document.querySelector("main")?.prepend(warning);
    } else if (message.type === "error") {
      notice(message.message, true);
    } else if (message.type === "notice") {
      notice(message.message);
    } else if (message.type === "browsed") {
      if (!flush()) return;
      if (message.field === "tcPath") {
        const t = tools.find((t) => t.id === (message.toolId || selectedTool));
        if (t) t.executable = message.path;
      } else {
        const c = draft.configurations.find(
          (item) => item.id === (message.configurationId || selected),
        );
        if (c) c[message.field] = message.path;
      }
      mark();
      renderMain();
    } else if (message.type === "discovered") {
      if (!flush()) return;
      const map = new Map([...message.tools, ...tools].map((t) => [t.id, t]));
      tools = [...map.values()];
      selectedTool = message.tools[0]?.id || selectedTool;
      mark(true);
      render();
      notice(
        T(
          "{0} installed SDK(s) found. Apply to retain this local SDK list.",
          message.tools.length,
        ),
      );
    } else if (message.type === "pythonStatus") {
      state.pythonStatus = message.message;
      notice(message.message);
    } else if (message.type === "sdkPackages") {
      sdkPackages = message.packages;
      sdkDetails = undefined;
      renderMain();
      notice(
        T(
          "{0} package(s) returned by the package manager.",
          sdkPackages.length,
        ),
      );
    } else if (message.type === "sdkDetails") {
      sdkDetails = message.details;
      renderMain();
      notice(
        "Verified package details. Install requires a separate native confirmation.",
      );
    }
  });
  picker = new AtelierTemplatePicker.TemplatePicker({
    translate: T,
    onSelect: createFromTemplate,
    onContext: (context) => send("templates", { context }),
    getRecent: () => recent,
  });
  shell();
  window.addEventListener("pagehide", () => {
    commitPending();
    for (const current of sessions.values()) current.dispose();
  });
  send("ready");
})();
