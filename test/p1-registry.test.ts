import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  identifyHost,
  HostGuard,
  debuggerAvailability,
} from "../src/environment/host";
import { ToolchainRegistry } from "../src/environment/toolchainRegistry";
import { ToolProbe } from "../src/environment/probe";
import {
  hostCandidates,
  safeAutomaticCandidate,
} from "../src/environment/hostSearch";
import type { LocalToolchain } from "../src/configuration";
const facts = {
  hostname: "fixture-host",
  machineId: "fixture-machine",
  platform: "linux" as const,
  arch: "x64",
  extensionKind: "workspace" as const,
};
const sdk = (executable: string, id = "sdk"): LocalToolchain => ({
  id,
  language: "node",
  name: "Node SDK",
  executable,
  version: "v22.0.0",
  manager: "custom",
  project: "",
});
async function fixture(fn: (root: string) => Promise<void>) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "atelier registry 空格-"),
  );
  try {
    await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
test("official host facts isolate local/WSL/SSH/container and real runtime platform/architecture", () => {
  const hosts = [
    identifyHost(facts),
    identifyHost({ ...facts, remoteName: "wsl", authority: "wsl+Ubuntu" }),
    identifyHost({
      ...facts,
      remoteName: "ssh-remote",
      authority: "ssh-remote+one",
    }),
    identifyHost({
      ...facts,
      remoteName: "ssh-remote",
      authority: "ssh-remote+two",
    }),
    identifyHost({
      ...facts,
      remoteName: "dev-container",
      authority: "dev-container+one",
    }),
  ];
  assert.equal(new Set(hosts.map((h) => h.id)).size, 5);
  assert.deepEqual(
    hosts.map((h) => h.kind),
    ["local", "wsl", "ssh", "ssh", "container"],
  );
  assert.equal(hosts[1].platform, "linux");
  assert.throws(
    () =>
      identifyHost({ ...facts, remoteName: "ssh-remote", extensionKind: "ui" }),
    /远程工作区/,
  );
});
test("registry migration preserves legacy references, deduplicates physical paths and shares host IDs across workspaces", () =>
  fixture(async (root) => {
    const exe = path.join(root, "node");
    await fs.copyFile(process.execPath, exe);
    const alias = path.join(root, "node-alias");
    await fs.symlink(exe, alias);
    const guard = new HostGuard(identifyHost(facts), () => true);
    const registry = new ToolchainRegistry(
      path.join(root, "storage"),
      guard,
      async () => [],
    );
    await registry.load([
      { ...sdk(exe, "old-one"), project: "file:///project-one" },
      { ...sdk(alias, "old-two"), project: "file:///project-two" },
    ]);
    assert.equal(registry.snapshot().tools.length, 1);
    assert.ok(
      registry
        .asLocalToolchains("file:///project-one")
        .some((t) => t.id === "old-one"),
    );
    assert.ok(
      !registry
        .asLocalToolchains("file:///project-two")
        .some((t) => t.id === "old-one"),
    );
    const id = registry.snapshot().tools[0].id;
    assert.ok(
      registry
        .asLocalToolchains("file:///new-project")
        .some((t) => t.id === id),
    );
    const reopened = new ToolchainRegistry(
      path.join(root, "storage"),
      guard,
      async () => [],
    );
    await reopened.load();
    assert.equal(reopened.snapshot().tools[0].id, id);
    assert.equal(
      JSON.parse(await fs.readFile(registry.file, "utf8")).host.id,
      guard.environment.id,
    );
  }));
test("cache is visible before refresh, TTL prevents redundant local scans, explicit refresh updates versions", () =>
  fixture(async (root) => {
    let scans = 0;
    let version = "v20.1.0";
    const guard = new HostGuard(identifyHost(facts), () => true);
    const scan = async () => {
      scans++;
      return [{ ...sdk(process.execPath), version }];
    };
    const first = new ToolchainRegistry(root, guard, scan);
    await first.start();
    await first.settled();
    assert.equal(scans, 1);
    const restarted = new ToolchainRegistry(root, guard, scan);
    await restarted.start();
    await restarted.settled();
    assert.equal(scans, 1);
    assert.equal(restarted.snapshot().tools[0].version, version);
    version = "v22.1.0";
    await restarted.refresh();
    assert.equal(scans, 2);
    assert.equal(restarted.snapshot().tools[0].version, version);
  }));
test("a missing path is marked unavailable and manual records are never silently deleted", () =>
  fixture(async (root) => {
    const guard = new HostGuard(identifyHost(facts), () => true);
    const registry = new ToolchainRegistry(root, guard, async () => []);
    await registry.load([sdk(path.join(root, "removed-python"))]);
    await registry.refresh();
    assert.equal(registry.snapshot().tools.length, 1);
    assert.equal(registry.snapshot().tools[0].available, false);
    assert.equal(registry.snapshot().tools[0].manual, true);
  }));
test("another SSH host never loads the first host cache; old file is preserved", () =>
  fixture(async (root) => {
    const firstGuard = new HostGuard(
      identifyHost({
        ...facts,
        remoteName: "ssh-remote",
        authority: "ssh-remote+first",
      }),
      () => true,
    );
    const first = new ToolchainRegistry(root, firstGuard, async () => [
      sdk(process.execPath),
    ]);
    await first.start();
    await first.settled();
    const secondGuard = new HostGuard(
      identifyHost({
        ...facts,
        remoteName: "ssh-remote",
        authority: "ssh-remote+second",
      }),
      () => true,
    );
    const second = new ToolchainRegistry(root, secondGuard, async () => []);
    await second.load();
    assert.equal(second.snapshot().tools.length, 0);
    assert.ok(
      (await fs.readdir(root)).some((file) =>
        file.startsWith("toolchains.json.preserved-"),
      ),
    );
  }));
test("SSH reconnect and container restart revalidate cached paths even inside TTL", () =>
  fixture(async (root) => {
    let scans = 0;
    const host = identifyHost({
      ...facts,
      remoteName: "dev-container",
      authority: "container",
    });
    const first = new ToolchainRegistry(
      root,
      new HostGuard(host, () => true),
      async () => {
        scans++;
        return [sdk(process.execPath)];
      },
    );
    await first.start();
    await first.settled();
    const reopened = new ToolchainRegistry(
      root,
      new HostGuard(host, () => true),
      async () => {
        scans++;
        return [];
      },
    );
    await reopened.load();
    assert.equal(reopened.snapshot().tools[0].available, false);
    await reopened.start();
    await reopened.settled();
    assert.equal(scans, 2);
    assert.equal(reopened.snapshot().tools[0].available, false);
  }));
test("untrusted workspaces expose cache without executing any scanner", () =>
  fixture(async (root) => {
    let scanned = 0;
    const registry = new ToolchainRegistry(
      root,
      new HostGuard(identifyHost(facts), () => false),
      async () => {
        scanned++;
        return [];
      },
    );
    await registry.start();
    await registry.settled();
    assert.equal(scanned, 0);
    assert.equal(registry.snapshot().state, "blocked");
    await assert.rejects(registry.add(sdk(process.execPath)), /未受信任/);
  }));
test("simultaneous refresh calls coalesce; disconnect cancels the host and prevents late imports", () =>
  fixture(async (root) => {
    let complete: (value: LocalToolchain[]) => void = () => {};
    let calls = 0;
    const guard = new HostGuard(identifyHost(facts), () => true);
    const registry = new ToolchainRegistry(root, guard, () => {
      calls++;
      return new Promise((resolve) => {
        complete = resolve;
      });
    });
    const first = registry.refresh();
    const second = registry.refresh();
    guard.disconnect();
    complete([sdk(process.execPath)]);
    await Promise.all([first, second]);
    assert.equal(calls, 1);
    assert.equal(registry.snapshot().tools.length, 0);
    assert.equal(registry.snapshot().state, "error");
  }));
test("probe cancellation/timeout, concurrency limit and argument boundaries are enforced", () =>
  fixture(async (root) => {
    const guard = new HostGuard(
      identifyHost({
        ...facts,
        platform: process.platform,
        arch: process.arch,
      }),
      () => true,
    );
    const probe = new ToolProbe(guard, 2);
    const values = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        probe.run(
          process.execPath,
          ["-e", "process.stdout.write(process.argv[1])", "space & $ " + i],
          root,
        ),
      ),
    );
    assert.equal(values[4], "space & $ 4");
    await assert.rejects(
      probe.run(process.execPath, ["-e", "setInterval(()=>{},1000)"], root, {
        timeoutMs: 30,
      }),
      /检测失败/,
    );
    const abort = new AbortController();
    const operation = probe.run(
      process.execPath,
      ["-e", "setInterval(()=>{},1000)"],
      root,
      { signal: abort.signal },
    );
    abort.abort();
    await assert.rejects(operation, /检测失败/);
  }));
test("bounded discovery handles platform paths without walking the disk or accepting bootstrap shims", async () => {
  const windows = await hostCandidates(
    "win32",
    {
      Path: "C:\\SDK\\bin;relative-path",
      ProgramFiles: "D:\\Program Files",
      LOCALAPPDATA: "D:\\Local",
    },
    "D:\\User",
  );
  assert.ok(
    windows.some((c) => c.executable === "D:\\Program Files\\Go\\bin\\go.exe"),
  );
  assert.ok(!windows.some((c) => c.executable.startsWith("relative-path")));
  assert.equal(
    safeAutomaticCandidate(
      {
        language: "node",
        source: "Volta",
        executable: "/home/user/.volta/bin/node",
      },
      [],
    ),
    false,
  );
  assert.equal(
    safeAutomaticCandidate(
      {
        language: "python",
        source: "pyenv",
        executable: "/home/user/.pyenv/shims/python",
      },
      [],
    ),
    false,
  );
  assert.equal(
    safeAutomaticCandidate(
      { language: "go", source: "project", executable: "/work/tools/go" },
      ["/work"],
    ),
    false,
  );
});
test("remote debug checks reject UI-host-only adapters and never choose a local fallback", () => {
  const host = identifyHost({ ...facts, remoteName: "ssh-remote" });
  assert.ok(
    debuggerAvailability(host, "go", [
      { id: "go", types: ["go"], extensionKind: "ui" },
    ]),
  );
  assert.equal(
    debuggerAvailability(host, "go", [
      { id: "go", types: ["go"], extensionKind: "workspace" },
    ]),
    undefined,
  );
});
