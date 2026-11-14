import { hostToolchains } from './environment/registryAccess';
import { ui } from "./ui";
import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { query, toolchainId } from "./toolchains";
import { randomBytes } from "node:crypto";
import { launchConfigurations } from "./launchConfigurations";
import type { AtelierController, EditorContext } from "./controller";
import {
  LocalToolchain,
  RuntimeLanguage,
  runtimeLanguages,
  validateFile,
  validateEditorFile,
} from "./configuration";
import { SdkManager } from "./sdkManager";
import { PackageSummary } from "./packageManagers";
import { RunnerError } from "./model";
import { language, t } from "./i18n";
import {
  projectContexts,
  templateContext,
  templateViews,
  templateRecent,
} from "./templateCatalog";
import { templateById, templateGroups } from "./templates";
import { ConfigurationSource, validateToolchains } from "./configurationStore";
export class ManagerPanel implements vscode.Disposable {
  readonly panel: vscode.WebviewPanel;
  private editor?: EditorContext;
  private subscriptions: vscode.Disposable[] = [];
  private sdk: SdkManager;
  private discovered = new Map<string, LocalToolchain>();
  private ready = false;
  private disposed = false;
  private initializing = false;
  private mode = "configurations";
  private pendingAdd = false;
  private approvals = new Set<string>();
  private drafts = new Map<string, Promise<void>>();
  private writes = new Map<string, Promise<void>>();
  private latestDrafts = new Map<string, Record<string, unknown>>();
  private lastSaved = new Map<string, { revision: string; draftId: unknown }>();
  constructor(
    private readonly controller: AtelierController,
    closed: () => void,
  ) {
    const root = vscode.Uri.joinPath(controller.context.extensionUri, "media");
    this.panel = vscode.window.createWebviewPanel(
      "sakuraAtelier.configurations",
      t("Sakura Atelier — Run / Debug Configurations"),
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [root],
        retainContextWhenHidden: true,
      },
    );
    this.sdk = new SdkManager(async (details) => {
      await this.discoverAll();
      if (details?.installedPath) {
        await this.discoverPrefix(details.installedPath);
      }
      await this.sendTools();
    });
    const nonce = randomBytes(24).toString("base64");
    const uri = (name: string) =>
      this.panel.webview.asWebviewUri(vscode.Uri.joinPath(root, name));
    this.panel.webview.html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.panel.webview.cspSource}; font-src ${this.panel.webview.cspSource}; script-src 'nonce-${nonce}';"><link href="${uri("codicon.css")}" rel="stylesheet"><link href="${uri("manager.css")}" rel="stylesheet"></head><body><div id="app"></div><script nonce="${nonce}" src="${uri("localization.js")}"></script><script nonce="${nonce}" src="${uri("templatePicker.js")}"></script><script nonce="${nonce}" src="${uri("autosave.js")}"></script><script nonce="${nonce}" src="${uri("manager.js")}"></script></body></html>`;
    this.subscriptions.push(
      this.panel.onDidDispose(() => {
        this.disposed = true;
        void this.flushOnClose();
        this.sdk.dispose();
        for (const sub of this.subscriptions) {
          sub.dispose();
        }
        closed();
      }),
    );
    const registry = hostToolchains();
    if (registry) { this.subscriptions.push(registry.subscribe(() => { void this.sendTools().catch(error => console.error('Sakura Atelier SDK UI:', error)); })); }
    this.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("sakuraAtelier.language")) {
          this.panel.title = t("Sakura Atelier — Run / Debug Configurations");
          void this.panel.webview.postMessage({
            type: "locale",
            locale: language(),
          });
        }
      }),
    );
    this.subscriptions.push(
      this.panel.webview.onDidReceiveMessage((message) => {
        void this.message(message).catch((error) => this.error(error));
      }),
    );
  }
  async show(editor: EditorContext, mode: string, add: boolean): Promise<void> {
    const same =
      this.editor?.folder.uri.toString() === editor.folder.uri.toString() &&
      this.editor?.root === editor.root;
    this.editor = editor;
    this.mode = mode;
    this.pendingAdd = add;
    this.panel.reveal();
    this.initializing = true;
    try {
      await this.sdk.detect(editor.folder.uri.fsPath);
    } finally {
      this.initializing = false;
    }
    if (this.ready) {
      if (same) {
        await this.panel.webview.postMessage({
          type: "mode",
          mode,
          add,
          sdkStatus: this.sdkStatus(),
          file: editor.file,
          language: editor.language,
        });
        this.pendingAdd = false;
      } else {
        await this.sendState();
      }
    }
  }
  private error(error: unknown): void {
    void this.panel.webview.postMessage({
      type: "error",
      message: t(error instanceof Error ? error.message : String(error)),
    });
  }
  private async sendState(mode?: string, add = false): Promise<void> {
    if (!this.editor) {
      return;
    }
    const { document, revision, sources } = await this.controller.store.read(
      this.editor.folder,
    );
    const tools = this.controller.store.toolchains(this.editor.folder);
    for (const tool of tools) {
      this.discovered.set(tool.id, tool);
    }
    await this.panel.webview.postMessage({
      type: "state",
      document,
      revision,
      sources,
      recoveredDraft: await this.controller.context.secrets.get(
        "atelier.editorDraft:" + this.editor.folder.uri.toString(),
      ),
      locale: language(),
      catalog: await this.catalog(),
      mode: mode ?? this.mode,
      add: add || this.pendingAdd,
      folder: this.editor.folder.uri.toString(),
      root: this.editor.root,
      file: this.editor.file,
      language: this.editor.language,
      workspaces: (vscode.workspace.workspaceFolders ?? []).map((f) => ({
        name: f.name,
        uri: f.uri.toString(),
      })),
      projects: this.controller.projects.map((p) => ({
        root: p.root,
        marker: p.marker,
        languages: p.languages,
        folder: p.folder.uri.toString(),
      })),
      toolchains: tools,
      launch: await launchConfigurations(this.editor.folder),
      sdkStatus: this.sdkStatus(),
      sdkHelp: this.sdk.helpUrl,
      pythonStatus: this.controller.python.mismatch,
      terminalActivation: {
        modern: vscode.workspace
          .getConfiguration("python-envs", this.editor.folder.uri)
          .get("terminal.autoActivationType", "unavailable"),
        legacy: vscode.workspace
          .getConfiguration("python", this.editor.folder.uri)
          .get("terminal.activateEnvironment", true),
      },
    });
    this.pendingAdd = false;
  }
  private async catalog(contextId?: string) {
    const editor = this.editor!;
    await this.controller.refreshProjects();
    const contexts = projectContexts(
      vscode.workspace.workspaceFolders ?? [],
      this.controller.projects,
    );
    const summary =
      contexts.find((c) => c.id === contextId) ??
      contexts.find(
        (c) =>
          c.root === editor.root && c.folder === editor.folder.uri.toString(),
      ) ??
      contexts.find((c) => c.folder === editor.folder.uri.toString());
    if (!summary) {
      throw new RunnerError("Workspace folder is no longer open.");
    }
    const folder = vscode.workspace.workspaceFolders!.find(
      (f) => f.uri.toString() === summary.folder,
    )!;
    const context = await templateContext(summary, folder, {
      file: editor.file,
      language: editor.language,
    });
    const tools = this.controller.store.toolchains(folder);
    const templates = await templateViews(
      context,
      tools,
      vscode.workspace.isTrusted,
      (l) => this.controller.store.defaultToolchain(l, folder),
    );
    return {
      contexts,
      context,
      templates,
      groups: templateGroups,
      recent: this.controller.context.workspaceState.get<string[]>(
        "atelier.recentTemplates",
        [],
      ),
    };
  }
  private async sendTemplates(contextId?: string): Promise<void> {
    await this.panel.webview.postMessage({
      type: "templates",
      catalog: await this.catalog(contextId),
    });
  }
  private async flushOnClose(): Promise<void> {
    await Promise.allSettled([
      ...this.drafts.values(),
      ...this.writes.values(),
    ]);
    for (const [key, draft] of this.latestDrafts) {
      try {
        if (draft.invalid === true) {
          continue;
        }
        const folder = this.folderFor(key);
        const current = await this.controller.store.read(folder);
        const saved = this.lastSaved.get(key);
        if (saved?.draftId === draft.draftId) {
          await this.controller.context.secrets.delete(
            "atelier.editorDraft:" + key,
          );
          continue;
        }
        if (
          current.revision !== draft.revision &&
          current.revision !== saved?.revision
        ) {
          continue;
        }
        validateEditorFile(draft.document);
        await this.autosave({ ...draft, revision: current.revision });
        if (this.lastSaved.get(key)?.draftId === draft.draftId) {
          await this.controller.context.secrets.delete(
            "atelier.editorDraft:" + key,
          );
        }
      } catch {
        /* Encrypted drafts remain available when validation, persistence or external revision checks fail. */
      }
    }
  }
  private folderFor(value: unknown): vscode.WorkspaceFolder {
    const folder = vscode.workspace.workspaceFolders?.find(
      (f) => f.uri.toString() === value,
    );
    if (!folder) {
      throw new RunnerError("Workspace folder is no longer open.");
    }
    return folder;
  }
  private async autosave(m: Record<string, unknown>): Promise<void> {
    const folder = this.folderFor(m.folder);
    const folderKey = folder.uri.toString();
    const request = m.request;
    const previous = this.writes.get(folderKey) ?? Promise.resolve();
    const work = previous
      .catch(() => {})
      .then(async () => {
        try {
          if (typeof m.revision !== "string") {
            throw new RunnerError("Missing editor revision.");
          }
          const document = validateEditorFile(m.document);
          const current = await this.controller.store.read(folder);
          const sources = m.sources as Record<string, ConfigurationSource>;
          if (!sources || typeof sources !== "object") {
            throw new RunnerError("Invalid configuration storage locations.");
          }
          const approvalsUsed: string[] = [];
          for (const c of current.document.configurations) {
            if (!document.configurations.some((d) => d.id === c.id)) {
              const approval = folderKey + ":delete:" + c.id;
              if (!this.approvals.has(approval)) {
                throw new RunnerError(
                  "Configuration deletion requires confirmation.",
                );
              }
              approvalsUsed.push(approval);
            }
            if (sources[c.id] && sources[c.id] !== current.sources[c.id]) {
              const approval =
                folderKey + ":move:" + c.id + ":" + sources[c.id];
              if (!this.approvals.has(approval)) {
                throw new RunnerError(
                  "Configuration migration requires confirmation.",
                );
              }
              approvalsUsed.push(approval);
            }
          }
          const tools = m.toolchains as LocalToolchain[] | undefined;
          if (tools) {
            validateToolchains(tools);
            for (const tool of this.controller.store.toolchains(folder)) {
              const approval = folderKey + ":tool:" + tool.id;
              if (
                !tools.some((t) => t.id === tool.id) &&
                this.approvals.has(approval)
              ) {
                approvalsUsed.push(approval);
              }
            }
          }
          if (current.revision !== m.revision) {
            throw new RunnerError(
              "Configuration changed on disk. Reload before saving.",
            );
          }
          const saved = await this.controller.store.save(
            folder,
            document,
            m.revision,
            sources,
          );
          if (tools) {
            const bindings = new Set(
              saved.document.configurations
                .filter(
                  (c) =>
                    c.toolchain !==
                    document.configurations.find((before) => before.id === c.id)
                      ?.toolchain,
                )
                .map(
                  (c) => c.toolchain.match(/^\$\{toolchain:([^}]+)\}$/)?.[1],
                ),
            );
            const actual = this.controller.store.toolchains(folder);
            const merged = new Map(
              [...actual, ...tools.filter((t) => !bindings.has(t.id))].map(
                (t) => [t.id, t],
              ),
            );
            for (const tool of [...merged.values()]) {
              if (
                !tools.some((t) => t.id === tool.id) &&
                this.approvals.has(folderKey + ":tool:" + tool.id)
              )
                merged.delete(tool.id);
            }
            await this.controller.store.putToolchains(
              [...merged.values()],
              folder,
            );
          }
          for (const approval of approvalsUsed) this.approvals.delete(approval);
          if (
            typeof m.selected === "string" &&
            saved.document.configurations.some((c) => c.id === m.selected)
          ) {
            await this.controller.store.select(
              folder,
              typeof m.root === "string" ? m.root : folder.uri.fsPath,
              { kind: "managed", id: m.selected },
            );
          }
          this.lastSaved.set(folderKey, {
            revision: saved.revision,
            draftId: m.draftId,
          });
          await this.panel.webview.postMessage({
            type: "autosaved",
            request,
            folder: folderKey,
            draftId: m.draftId,
            toolchains: this.controller.store.toolchains(folder),
            ...saved,
          });
          this.controller.updateStatus();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          await this.panel.webview.postMessage({
            type: "autosaveError",
            request,
            folder: folderKey,
            kind: /changed|conflict|interrupted/.test(message)
              ? "conflict"
              : /Configuration:|Invalid|requires confirmation|required|Choose a Cargo/.test(
                    message,
                  )
                ? "invalid"
                : "error",
            message: t(message),
          });
        }
      });
    this.writes.set(folderKey, work);
    await work;
  }
  private async discoverPrefix(prefix: string): Promise<void> {
    if (!this.editor) {
      return;
    }
    const directory = await fs.realpath(prefix);
    const bin = path.join(directory, "bin");
    const files = await fs
      .readdir(bin, { withFileTypes: true })
      .catch(() => []);
    const found: LocalToolchain[] = [];
    for (const file of files) {
      const name = file.name;
      let language: RuntimeLanguage | undefined;
      if (name === "go") language = "go";
      else if (name === "cargo") language = "rust";
      else if (/^python(?:3(?:\.\d+)?)?$/.test(name)) language = "python";
      else if (name === "node") language = "node";
      else if (/^(clang|gcc(?:-\d+)?)$/.test(name)) language = "c";
      else if (/^(clang\+\+|g\+\+(?:-\d+)?)$/.test(name)) language = "cpp";
      else if (name === "dotnet") language = "csharp";
      else if (name === "java") language = "java";
      if (!language) {
        continue;
      }
      const executable = path.join(bin, name);
      const canonical = await fs.realpath(executable).catch(() => executable);
      if (
        language === "rust" &&
        path.basename(canonical).startsWith("rustup")
      ) {
        continue;
      }
      try {
        const version = (
          await query(
            executable,
            language === "go" ? ["version"] : ["--version"],
            this.editor.folder.uri.fsPath,
            { ...process.env, GOTOOLCHAIN: "local" },
          )
        ).split(/\r?\n/)[0];
        found.push({
          id: toolchainId(language, executable),
          name: `${name} ${version}`,
          language,
          executable,
          version,
          manager: "Installed package SDK",
          project: this.editor.folder.uri.toString(),
        });
      } catch {
        /* An unavailable executable can still be located manually. */
      }
    }
    const existing = this.controller.store.toolchains(this.editor.folder);
    const map = new Map([...existing, ...found].map((t) => [t.id, t]));
    await this.controller.store.putToolchains(
      [...map.values()],
      this.editor.folder,
    );
    for (const tool of found) {
      this.discovered.set(tool.id, tool);
    }
  }
  private sdkStatus(): string {
    const snapshot = hostToolchains()?.snapshot();
    return this.sdk.status + (snapshot ? ` · ${snapshot.host.label} · ${snapshot.message} · ${snapshot.lastScanAt ?? '尚未扫描'}` : '');
  }
  private async sendTools(): Promise<void> {
    if (this.editor && !this.disposed) {
      await this.panel.webview.postMessage({
        type: "toolsRefreshed",
        tools: this.controller.store.toolchains(this.editor.folder),
        sdkStatus: this.sdkStatus(),
      });
      await this.sendTemplates();
    }
  }
  private async discoverAll(): Promise<LocalToolchain[]> {
    if (!this.editor) {
      return [];
    }
    const discovered = (
      await Promise.all(
        (
          [
            "go",
            "rust",
            "python",
            "node",
            "c",
            "cpp",
            "csharp",
            "java",
          ] as RuntimeLanguage[]
        ).map((language) =>
          this.controller.discovery.discover(language, this.editor!.folder),
        ),
      )
    ).flat();
    const previous = this.controller.store.toolchains(this.editor.folder);
    const map = new Map([...previous, ...discovered].map((t) => [t.id, t]));
    await this.controller.store.putToolchains(
      [...map.values()],
      this.editor.folder,
    );
    for (const t of discovered) {
      this.discovered.set(t.id, t);
    }
    return discovered;
  }
  private async message(value: unknown): Promise<void> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new RunnerError("Invalid configuration editor message.");
    }
    const m = value as Record<string, unknown>;
    if (typeof m.type !== "string") {
      return;
    }
    if (!this.editor) {
      return;
    }
    const editor = this.editor;
    if (m.type === "ready" || m.type === "reload") {
      this.ready = true;
      if (!this.initializing) {
        await this.sendState();
      }
      return;
    }
    if (m.type === "newProject") {
      await vscode.commands.executeCommand("sakuraAtelier.newProject");
      return;
    }
    if (m.type === "workspace") {
      const folder = vscode.workspace.workspaceFolders?.find(
        (f) => f.uri.toString() === m.folder,
      );
      if (!folder) {
        throw new RunnerError("Workspace folder is no longer open.");
      }
      this.editor = await this.controller.editorContext(folder);
      await this.sdk.detect(folder.uri.fsPath);
      await this.sendState();
      return;
    }
    if (m.type === "project") {
      const project = this.controller.projects.find(
        (p) =>
          p.root === m.root &&
          p.folder.uri.toString() === editor.folder.uri.toString(),
      );
      if (!project) {
        throw new RunnerError(
          "Choose a detected project inside this workspace.",
        );
      }
      this.editor = {
        ...editor,
        root: project.root,
        project: true,
        language: project.languages[0] ?? editor.language,
      };
      await this.sendState();
      return;
    }
    if (m.type === "draft") {
      const folder = this.folderFor(m.folder);
      const key = folder.uri.toString();
      if (JSON.stringify(m).length > 2_000_000) {
        throw new RunnerError("Editor draft is too large.");
      }
      this.latestDrafts.set(key, m);
      const queued = (this.drafts.get(key) ?? Promise.resolve())
        .catch(() => {})
        .then(() =>
          this.controller.context.secrets.store(
            "atelier.editorDraft:" + key,
            JSON.stringify(m),
          ),
        );
      this.drafts.set(key, queued);
      try {
        await queued;
      } catch {
        await this.panel.webview.postMessage({
          type: "draftError",
          message: t(
            "Secure draft storage is unavailable. Valid configurations still autosave; unfinished drafts remain in memory until this page closes. Check the VS Code system keyring.",
          ),
        });
      }
      return;
    }
    if (m.type === "clearDraft") {
      const folder = this.folderFor(m.folder);
      const key = folder.uri.toString();
      const queued = (this.drafts.get(key) ?? Promise.resolve())
        .catch(() => {})
        .then(async () => {
          if (
            m.force === true ||
            this.latestDrafts.get(key)?.draftId === m.draftId
          ) {
            await this.controller.context.secrets.delete(
              "atelier.editorDraft:" + key,
            );
            this.latestDrafts.delete(key);
          }
        });
      this.drafts.set(key, queued);
      await queued;
      return;
    }
    if (m.type === "autosave") {
      await this.autosave(m);
      return;
    }
    if (m.type === "confirmReload") {
      const accepted = await ui.showWarningMessage(
        t("Discard the editor draft and reload saved configurations?"),
        { modal: true },
        "Confirm",
      );
      await this.panel.webview.postMessage({
        type: "confirmed",
        request: m.request,
        accepted: accepted === "Confirm",
      });
      return;
    }
    if (
      m.type === "confirmDelete" ||
      m.type === "confirmMigration" ||
      m.type === "confirmRemoveTool"
    ) {
      const folder = this.folderFor(m.folder);
      if (typeof m.id !== "string") {
        throw new RunnerError("Invalid confirmation request.");
      }
      const current = await this.controller.store.read(folder);
      const c = current.document.configurations.find((c) => c.id === m.id);
      const name = c?.name ?? String(m.name || m.id);
      let message: string;
      let approval: string;
      if (m.type === "confirmMigration") {
        if (!["personal", "project"].includes(String(m.source))) {
          throw new RunnerError("Invalid configuration storage locations.");
        }
        message = t(
          'Move "{0}" to {1}?',
          name,
          t(
            m.source === "personal"
              ? "Personal configuration (this machine only)"
              : "Project configuration (shareable)",
          ),
        );
        approval = folder.uri.toString() + ":move:" + m.id + ":" + m.source;
      } else if (m.type === "confirmRemoveTool") {
        message =
          t("Remove SDK record") +
          " · " +
          name +
          "\n" +
          t("Only removes the local record; SDK files are not deleted.");
        approval = folder.uri.toString() + ":tool:" + m.id;
      } else {
        message = t('Delete configuration "{0}"?', name);
        approval = folder.uri.toString() + ":delete:" + m.id;
      }
      const accepted = await ui.showWarningMessage(
        message,
        { modal: true },
        "Confirm",
      );
      if (accepted === "Confirm") {
        this.approvals.add(approval);
      }
      await this.panel.webview.postMessage({
        type: "confirmed",
        request: m.request,
        accepted: accepted === "Confirm",
      });
      return;
    }
    if (m.type === "compareDraft") {
      const folder = this.folderFor(m.folder);
      const draft = validateFile(m.document);
      const current = await this.controller.store.read(folder);
      const left = await vscode.workspace.openTextDocument({
        language: "json",
        content: JSON.stringify(current.document, null, 2),
      });
      const right = await vscode.workspace.openTextDocument({
        language: "json",
        content: JSON.stringify(draft, null, 2),
      });
      await vscode.commands.executeCommand(
        "vscode.diff",
        left.uri,
        right.uri,
        t("Configuration changed externally"),
      );
      return;
    }
    if (m.type === "templates") {
      if (m.context !== undefined && typeof m.context !== "string") {
        throw new RunnerError("Invalid template project.");
      }
      await this.sendTemplates(m.context as string | undefined);
      return;
    }
    if (m.type === "templateUsed") {
      if (typeof m.id !== "string" || !templateById(m.id)) {
        throw new RunnerError("Unsupported template.");
      }
      await this.controller.context.workspaceState.update(
        "atelier.recentTemplates",
        templateRecent(
          this.controller.context.workspaceState.get<string[]>(
            "atelier.recentTemplates",
            [],
          ),
          m.id,
        ),
      );
      return;
    }
    if (m.type === "openConfigurationFile") {
      const file = path.join(
        editor.folder.uri.fsPath,
        ".vscode/sakura-atelier.json",
      );
      if (
        !(await fs
          .stat(file)
          .then((s) => s.isFile())
          .catch(() => false))
      ) {
        throw new RunnerError(
          "No project configuration file exists. Save a project configuration first.",
        );
      }
      if (
        !(await (
          await import("./detect")
        ).contained(editor.folder.uri.fsPath, file))
      ) {
        throw new RunnerError("Configuration points outside the workspace.");
      }
      await vscode.window.showTextDocument(
        await vscode.workspace.openTextDocument(file),
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      );
      return;
    }
    if (m.type === "cancel") {
      this.panel.dispose();
      return;
    }
    if (m.type === "browse") {
      if (
        !["target", "cwd", "toolchain", "output", "tcPath"].includes(
          String(m.field),
        )
      ) {
        throw new RunnerError("Invalid file picker field.");
      }
      const uri =
        m.field === "output"
          ? await ui.showSaveDialog({
              title: "Select executable / output path",
            })
          : (
              await ui.showOpenDialog({
                title: "Locate existing file or SDK",
                canSelectFiles: m.directory !== true,
                canSelectFolders: m.directory === true,
                canSelectMany: false,
              })
            )?.[0];
      if (uri) {
        await this.panel.webview.postMessage({
          type: "browsed",
          field: m.field,
          path: uri.fsPath,
          configurationId: m.configurationId,
          toolId: m.toolId,
        });
      }
      return;
    }
    if (m.type === "discover") {
      const language = m.language as RuntimeLanguage;
      if (!(runtimeLanguages as readonly unknown[]).includes(language)) {
        throw new RunnerError("Choose a supported language.");
      }
      const tools = await this.controller.discovery.discover(
        language,
        editor.folder,
      );
      for (const tool of tools) {
        this.discovered.set(tool.id, tool);
      }
      await this.panel.webview.postMessage({
        type: "discovered",
        tools,
        language,
      });
      return;
    }
    if (m.type === "pythonSelect") {
      const tool =
        this.discovered.get(String(m.id)) ??
        this.controller.store
          .toolchains(editor.folder)
          .find((t) => t.id === m.id);
      if (!tool || tool.language !== "python") {
        throw new RunnerError(
          "Discover or save this Python interpreter first.",
        );
      }
      await this.controller.python.synchronize(
        tool.executable,
        editor.folder.uri,
      );
      await this.panel.webview.postMessage({
        type: "pythonStatus",
        message:
          this.controller.python.mismatch ||
          "Synchronized with the official Python environment selection.",
      });
      return;
    }
    if (m.type === "createVenv") {
      if (!vscode.workspace.isTrusted) {
        throw new RunnerError(
          "Trust the workspace before creating an environment.",
        );
      }
      const modern = await this.controller.python.modern();
      if (modern?.createEnvironment) {
        await modern.createEnvironment(editor.folder.uri, {
          quickCreate: false,
        });
      } else {
        const tool =
          this.discovered.get(String(m.id)) ??
          this.controller.store
            .toolchains(editor.folder)
            .find((t) => t.id === m.id);
        if (!tool || tool.language !== "python") {
          throw new RunnerError(
            "Select a discovered Python interpreter first.",
          );
        }
        const name = await ui.showInputBox({
          title: "Create virtual environment in this workspace",
          value: ".venv",
          validateInput: (v) =>
            /^[a-zA-Z0-9_. -]+$/.test(v) && v !== "." && v !== ".."
              ? undefined
              : "Use one new directory name.",
        });
        if (!name) {
          return;
        }
        const target = path.join(editor.folder.uri.fsPath, name);
        if (
          await fs
            .stat(target)
            .then(() => true)
            .catch(() => false)
        ) {
          throw new RunnerError(
            "That directory already exists; it will not be overwritten.",
          );
        }
        await this.controller.executor.exclusive(() =>
          this.controller.executor.run(
            {
              name: "Create Python venv",
              steps: [
                {
                  command: tool.executable,
                  args: ["-m", "venv", target],
                  cwd: editor.folder.uri.fsPath,
                  label: "Create Python environment",
                },
              ],
            },
            editor.folder,
          ),
        );
      }
      const tools = await this.controller.discovery.discover(
        "python",
        editor.folder,
      );
      for (const tool of tools) {
        this.discovered.set(tool.id, tool);
      }
      await this.panel.webview.postMessage({
        type: "discovered",
        tools,
        language: "python",
      });
      return;
    }
    if (m.type === "terminal") {
      await this.controller.createPythonTerminal();
      return;
    }
    if (m.type === "defaultSdk") {
      const tool =
        this.discovered.get(String(m.id)) ??
        this.controller.store
          .toolchains(editor.folder)
          .find((t) => t.id === m.id);
      if (!tool) {
        throw new RunnerError("Discover or save this SDK first.");
      }
      const existing = this.controller.store
        .toolchains(editor.folder)
        .filter((t) => t.id !== tool.id);
      await this.controller.store.putToolchains(
        [
          ...existing,
          { ...tool, project: m.global === true ? "" : tool.project },
        ],
        editor.folder,
      );
      await this.controller.store.setDefaultToolchain(
        tool.language,
        tool.id,
        editor.folder,
        m.global === true,
      );
      await this.panel.webview.postMessage({
        type: "notice",
        message: `${tool.name} is now the ${m.global === true ? "Sakura Atelier global" : "workspace"} default. System defaults were not changed.`,
      });
      return;
    }
    if (m.type === "secret") {
      const name = await ui.showInputBox({
        title: "Secret reference name",
        prompt:
          "Stored locally in VS Code SecretStorage, never in the project file.",
        validateInput: (value) =>
          /^[a-zA-Z_][a-zA-Z0-9_.-]*$/.test(value)
            ? undefined
            : "Use letters, digits, dots, underscores and hyphens.",
      });
      if (!name) {
        return;
      }
      const secret = await ui.showInputBox({
        title: `Store ${name}`,
        password: true,
        ignoreFocusOut: true,
      });
      if (secret === undefined) {
        return;
      }
      await this.controller.context.secrets.store(
        `atelier:${editor.folder.uri.toString()}:${name}`,
        secret,
      );
      await this.panel.webview.postMessage({
        type: "notice",
        message: `Saved secret reference: \${secret:${name}}`,
      });
      return;
    }
    if (m.type === "nativeDebug") {
      await vscode.commands.executeCommand("workbench.action.debug.configure");
      return;
    }
    if (m.type === "sdkHelp") {
      if (this.sdk.helpUrl) {
        await vscode.env.openExternal(vscode.Uri.parse(this.sdk.helpUrl));
      }
      return;
    }
    if (m.type === "sdkList") {
      if (
        !["search", "installed", "updates"].includes(String(m.mode)) ||
        typeof m.keyword !== "string"
      ) {
        throw new RunnerError("Invalid SDK query.");
      }
      const packages = await this.sdk.list(
        m.mode as "search" | "installed" | "updates",
        m.keyword,
      );
      await this.panel.webview.postMessage({ type: "sdkPackages", packages });
      return;
    }
    if (m.type === "sdkDetails") {
      const details = await this.sdk.details(m.item as PackageSummary);
      await this.panel.webview.postMessage({ type: "sdkDetails", details });
      return;
    }
    if (m.type === "sdkInstall") {
      if (typeof m.key !== "string" || typeof m.version !== "string") {
        throw new RunnerError("Invalid install request.");
      }
      const result = await this.sdk.install(
        m.key,
        m.version,
        editor.folder.uri.fsPath,
      );
      await this.panel.webview.postMessage({
        type: "notice",
        message: result.cancelled
          ? "Installation cancelled."
          : "Installation completed. Toolchains were refreshed; your selected SDK was not changed.",
      });
      return;
    }
    if (m.type === "refreshTools") {
      await hostToolchains()?.refresh();
      await this.discoverAll();
      await this.sendTools();
      return;
    }
    throw new RunnerError("Unsupported editor operation.");
  }
  dispose(): void {
    this.panel.dispose();
  }
}
