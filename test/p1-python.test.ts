import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { HostGuard, identifyHost } from "../src/environment/host";
import {
  PythonEnvironmentService,
  PythonEnvironmentPort,
} from "../src/environment/pythonEnvironmentService";
import {
  RemediationRunner,
  RemediationExecutor,
} from "../src/environment/remediationRunner";
import type { LocalToolchain } from "../src/configuration";
const host = identifyHost({
  hostname: "test",
  machineId: "test",
  platform: process.platform,
  arch: process.arch,
  extensionKind: "workspace",
});
async function fixture(
  work: (f: {
    root: string;
    base: LocalToolchain;
    service: PythonEnvironmentService;
    runner: RemediationRunner;
    calls: string[];
    port: PythonEnvironmentPort;
    accept(value: boolean): void;
    trust(value: boolean): void;
    guard: HostGuard;
  }) => Promise<void>,
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "atelier-python 空格 "));
  let accepted = true,
    trusted = true;
  const calls: string[] = [];
  const guard = new HostGuard(host, () => trusted);
  const base: LocalToolchain = {
    id: "py",
    name: "Python",
    language: "python",
    version: "3.12.4",
    manager: "system",
    executable: path.join(root, "system python"),
    project: "",
  };
  const port: PythonEnvironmentPort = {
    discover: async () => {
      calls.push("discover");
      return [base];
    },
    managers: async () => ["venv", "uv"],
    synchronize: async () => {
      calls.push("sync");
      return "";
    },
    terminal: async () => {
      calls.push("terminal");
      return undefined;
    },
  };
  const executor: RemediationExecutor = {
    exclusive: async (f) => {
      await f();
      return true;
    },
    run: async (plan) => {
      calls.push("run:" + JSON.stringify(plan.steps));
    },
    stop: () => {
      calls.push("stop");
    },
  };
  const runner = new RemediationRunner(guard, executor, async () => accepted);
  const service = new PythonEnvironmentService(
    guard,
    port,
    runner,
    async () => accepted,
  );
  try {
    await fs.writeFile(
      path.join(root, "pyproject.toml"),
      '[project]\nrequires-python = ">=3.11,<3.13"\n',
    );
    await work({
      root,
      base,
      service,
      runner,
      calls,
      port,
      accept: (v) => {
        accepted = v;
      },
      trust: (v) => {
        trusted = v;
      },
      guard,
    });
  } finally {
    guard.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
}
test("Python workflow diagnoses project requirements, managers and unknown dependencies", () =>
  fixture(async (f) => {
    const state = await f.service.diagnose(f.root, [f.root]);
    assert.equal(state.state, "available");
    assert.equal(state.dependencies, "unknown");
    assert.equal(state.recommended, "venv");
    await fs.writeFile(path.join(f.root, "uv.lock"), "version=1");
    assert.equal(
      (await f.service.diagnose(f.root, [f.root])).recommended,
      "uv",
    );
  }));
test("existing interpreter synchronizes official selection and terminal delegates once", () =>
  fixture(async (f) => {
    const state = await f.service.diagnose(f.root, [f.root]);
    f.port.synchronize = async () => {
      f.calls.push("sync");
      return "not available";
    };
    const selected = await f.service.useExisting(state, f.base.executable);
    assert.equal(selected.toolchain, f.base.executable);
    assert.ok(
      selected.diagnostics.some((d) => d.code === "python.selectionMismatch"),
    );
    await f.service.terminal(state, f.base.executable);
    assert.equal(f.calls.filter((c) => c === "terminal").length, 1);
  }));
test("venv creation plan passes spaced paths as separate arguments and rediscovers after execution", () =>
  fixture(async (f) => {
    const state = await f.service.diagnose(f.root, [f.root]);
    const plan = await f.service.prepareCreation(state, f.base);
    assert.deepEqual(plan.run.steps[0].args, [
      "-m",
      "venv",
      path.join(state.root, ".venv"),
    ]);
    assert.equal(plan.hostId, host.id);
    const before = f.calls.filter((c) => c === "discover").length;
    assert.equal((await f.runner.execute(plan.id)).state, "completed");
    assert.ok(f.calls.filter((c) => c === "discover").length > before);
    await assert.rejects(f.runner.execute(plan.id), /过期/);
  }));
test("existing directory and dangling symlink are never overwritten", () =>
  fixture(async (f) => {
    const state = await f.service.diagnose(f.root, [f.root]);
    await fs.mkdir(path.join(f.root, ".venv"));
    await assert.rejects(f.service.prepareCreation(state, f.base), /已存在/);
    await fs.rmdir(path.join(f.root, ".venv"));
    await fs.symlink(path.join(f.root, "missing"), path.join(f.root, ".venv"));
    await assert.rejects(f.service.prepareCreation(state, f.base), /已存在/);
    assert.ok(!f.calls.some((c) => c.startsWith("run:")));
  }));
test("creation checks version mismatch, scope and invalid directory input", () =>
  fixture(async (f) => {
    const state = await f.service.diagnose(f.root, [f.root]);
    await assert.rejects(
      f.service.prepareCreation(state, { ...f.base, version: "3.9.0" }),
      /兼容/,
    );
    await assert.rejects(
      f.service.prepareCreation(state, f.base, "venv", undefined, "../escape"),
      /目录名/,
    );
    await assert.rejects(f.service.useExisting(state, "/unknown"), /重新发现/);
  }));
test("uv creation prevents downloading a Python SDK and does not install dependencies", () =>
  fixture(async (f) => {
    const state = await f.service.diagnose(f.root, [f.root]);
    const plan = await f.service.prepareCreation(
      state,
      f.base,
      "uv",
      path.join(f.root, "uv"),
    );
    assert.ok(plan.run.steps[0].args.includes("--no-python-downloads"));
    assert.equal(plan.run.steps[0].env?.UV_PYTHON_DOWNLOADS, "never");
    assert.ok(!plan.run.steps[0].args.includes("sync"));
  }));
test("user refusal and untrusted workspace cannot run environment modifications", () =>
  fixture(async (f) => {
    const state = await f.service.diagnose(f.root, [f.root]);
    const plan = await f.service.prepareCreation(state, f.base);
    f.accept(false);
    assert.equal((await f.runner.execute(plan.id)).state, "cancelled");
    assert.ok(!f.calls.some((c) => c.startsWith("run:")));
    f.trust(false);
    await assert.rejects(f.service.diagnose(f.root, [f.root]), /信任/);
    await assert.rejects(f.runner.execute(plan.id), /信任/);
  }));
test("metadata changes and late directory creation invalidate previously approved plans", () =>
  fixture(async (f) => {
    const state = await f.service.diagnose(f.root, [f.root]);
    const plan = await f.service.prepareCreation(state, f.base);
    await fs.writeFile(path.join(f.root, "requirements.txt"), "requests");
    await assert.rejects(f.runner.execute(plan.id), /变化/);
    const next = await f.service.prepareCreation(state, f.base);
    await fs.mkdir(path.join(f.root, ".venv"));
    await assert.rejects(f.runner.execute(next.id), /已存在/);
  }));
test("unavailable official API is explicit; no silent fallback or deleting an existing environment", () =>
  fixture(async (f) => {
    const state = await f.service.diagnose(f.root, [f.root]);
    await assert.rejects(f.service.createOfficial(state), /API/);
    f.port.createOfficial = async () => {
      throw new Error("API failed");
    };
    await assert.rejects(f.service.createOfficial(state), /API failed/);
    assert.ok(!f.calls.some((c) => c.startsWith("run:")));
    await fs.mkdir(path.join(f.root, "venv"));
    await assert.rejects(f.service.createOfficial(state), /已有环境/);
  }));
test("remediation runner prevents duplicates and stops only its injected executor on cancel/timeout", async () => {
  const guard = new HostGuard(host, () => true);
  let release: () => void = () => {};
  let stop = 0;
  let confirmRelease: () => void = () => {};
  const confirming = new Promise<void>((r) => {
    confirmRelease = r;
  });
  const executor: RemediationExecutor = {
    exclusive: async (f) => {
      await f();
      return true;
    },
    run: () =>
      new Promise<void>((r) => {
        release = r;
      }),
    stop: () => {
      stop++;
      release();
    },
  };
  const runner = new RemediationRunner(guard, executor, async () => {
    confirmRelease();
    return true;
  });
  const make = (timeoutMs: number) =>
    runner.prepare(
      {
        workspace: "/w",
        root: "/w",
        title: { code: "test", message: "测试" },
        manager: "venv",
        run: { name: "test", steps: [] },
        mayModify: [],
        mayExecuteCode: true,
        timeoutMs,
        fingerprint: "x",
      },
      async () => {},
    );
  const controller = new AbortController();
  const plan = make(10000);
  const active = runner.execute(plan.id, controller.signal);
  await confirming;
  await assert.rejects(runner.execute(plan.id), /正在执行/);
  await new Promise((r) => setTimeout(r, 5));
  controller.abort();
  assert.equal((await active).state, "cancelled");
  assert.equal(stop, 1);
  assert.equal((await runner.execute(make(5).id)).state, "timed-out");
  assert.equal(stop, 2);
  guard.dispose();
});
test("official create uses its interactive API once, refreshes and synchronizes without fallback", () =>
  fixture(async (f) => {
    const state = await f.service.diagnose(f.root, [f.root]);
    let creates = 0;
    f.port.createOfficial = async (scope) => {
      assert.equal(scope, state.root);
      creates++;
      return f.base;
    };
    assert.equal(
      (await f.service.createOfficial(state))?.executable,
      f.base.executable,
    );
    assert.equal(creates, 1);
    assert.ok(f.calls.includes("sync"));
    assert.ok(!f.calls.some((c) => c.startsWith("run:")));
  }));
