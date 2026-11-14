import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { HostGuard, identifyHost } from "../src/environment/host";
import {
  DependencyHost,
  ProjectDependencyService,
} from "../src/environment/projectDependencyService";
import { RemediationRunner } from "../src/environment/remediationRunner";
const hostFacts = identifyHost({
  hostname: "deps",
  machineId: "test",
  platform: process.platform,
  arch: process.arch,
  extensionKind: "workspace",
});
async function fixture(
  work: (f: {
    root: string;
    service: ProjectDependencyService;
    runner: RemediationRunner;
    host: DependencyHost;
    commands: unknown[];
    guard: HostGuard;
    accept(value: boolean): void;
  }) => Promise<void>,
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "atelier-deps 空格 "));
  let accepted = true;
  const guard = new HostGuard(hostFacts, () => true);
  const commands: unknown[] = [];
  const host: DependencyHost = {
    python: path.join(root, ".venv/bin/python"),
    tool: async (manager) => ({
      command:
        manager === "pip"
          ? path.join(root, ".venv/bin/python")
          : path.join(root, manager),
    }),
    query: async () => ({ code: 0, stdout: "{}" }),
  };
  const runner = new RemediationRunner(
    guard,
    {
      exclusive: async (work) => {
        await work();
        return true;
      },
      run: async (plan) => {
        commands.push(plan);
      },
      stop: () => {
        commands.push("stop");
      },
    },
    async (plan) => {
      commands.push({ confirmation: plan });
      return accepted;
    },
  );
  const service = new ProjectDependencyService(guard, host, runner);
  try {
    await work({
      root,
      service,
      runner,
      host,
      commands,
      guard,
      accept: (v) => {
        accepted = v;
      },
    });
  } finally {
    guard.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
}
test("checksum and lock files alone never become dependency declarations", () =>
  fixture(async (f) => {
    for (const name of [
      "go.sum",
      "Cargo.lock",
      "package-lock.json",
      "uv.lock",
      "packages.lock.json",
    ])
      await fs.writeFile(path.join(f.root, name), "{}");
    assert.deepEqual(await f.service.diagnose(f.root, [f.root]), []);
  }));
test("all requested ecosystems detect managers with Unknown status from metadata only", () =>
  fixture(async (f) => {
    for (const [name, text] of Object.entries({
      "go.mod": "module test\ngo 1.22",
      "Cargo.toml": '[package]\nname="test"',
      "pyproject.toml": '[project]\nname="test"',
      "requirements.txt": "requests",
      "package.json": "{}",
      "App.csproj": "<Project/>",
      "pom.xml": "<project/>",
      "build.gradle.kts": "plugins {}",
      "vcpkg.json": "{}",
      "conanfile.txt": "[requires]",
    }))
      await fs.writeFile(path.join(f.root, name), text);
    const states = await f.service.diagnose(f.root, [f.root]);
    assert.deepEqual(
      states.map((s) => s.manager).sort(),
      [
        "go",
        "cargo",
        "pip",
        "npm",
        "dotnet",
        "maven",
        "gradle",
        "vcpkg",
        "conan",
      ].sort(),
    );
    assert.ok(states.every((s) => s.state === "unknown"));
    assert.equal(f.commands.length, 0);
  }));
test("npm manager and lock conflicts are explicit, with no repair plan", () =>
  fixture(async (f) => {
    await fs.writeFile(
      path.join(f.root, "package.json"),
      '{"packageManager":"pnpm@9.0.0"}',
    );
    await fs.writeFile(path.join(f.root, "package-lock.json"), "{}");
    let [state] = await f.service.diagnose(f.root, [f.root]);
    assert.equal(state.state, "conflict");
    assert.equal(state.remediation.length, 0);
    await fs.writeFile(
      path.join(f.root, "package.json"),
      '{"dependencies":{"foo":"^2"}}',
    );
    await fs.writeFile(
      path.join(f.root, "package-lock.json"),
      '{"packages":{"":{"dependencies":{"foo":"^1"}}}}',
    );
    [state] = await f.service.diagnose(f.root, [f.root]);
    assert.equal(state.state, "conflict");
  }));
test("npm official structured check distinguishes ready, dependency problems, and query failure", () =>
  fixture(async (f) => {
    await fs.writeFile(path.join(f.root, "package.json"), "{}");
    let [state] = await f.service.diagnose(f.root, [f.root], {
      checkInstalled: true,
    });
    assert.equal(state.state, "ready");
    assert.equal(state.evidence, "official-query");
    f.host.query = async () => ({
      code: 1,
      stdout: '{"problems":["missing: dep@1"]}',
    });
    [state] = await f.service.diagnose(f.root, [f.root], {
      checkInstalled: true,
    });
    assert.equal(state.state, "missing");
    f.host.query = async () => {
      throw new Error("offline or corrupt npm");
    };
    [state] = await f.service.diagnose(f.root, [f.root], {
      checkInstalled: true,
    });
    assert.equal(state.state, "error");
  }));
test("lock-preserving repair commands use arrays and expose script/file effects", () =>
  fixture(async (f) => {
    await fs.writeFile(path.join(f.root, "package.json"), "{}");
    await fs.writeFile(path.join(f.root, "package-lock.json"), "{}");
    const [state] = await f.service.diagnose(f.root, [f.root]);
    const plan = state.remediation[0];
    assert.deepEqual(plan.run.steps[0].args, ["ci"]);
    assert.equal(plan.run.steps[0].command, path.join(f.root, "npm"));
    assert.ok(plan.mayExecuteCode);
    assert.ok(plan.mayModify.includes("node_modules"));
    assert.equal((await f.runner.execute(plan.id)).state, "completed");
    assert.equal(f.commands.length, 2);
  }));
test("Cargo requires lock; Go checksum is not a version lock; Python pip requires a venv", () =>
  fixture(async (f) => {
    await fs.writeFile(
      path.join(f.root, "Cargo.toml"),
      '[package]\nname="test"',
    );
    let states = await f.service.diagnose(f.root, [f.root]);
    assert.equal(states[0].remediation.length, 0);
    await fs.writeFile(path.join(f.root, "Cargo.lock"), "version=3");
    await fs.writeFile(path.join(f.root, "go.mod"), "module test");
    await fs.writeFile(path.join(f.root, "requirements.txt"), "requests");
    states = await f.service.diagnose(f.root, [f.root]);
    assert.deepEqual(
      states.find((s) => s.manager === "cargo")!.remediation[0].run.steps[0]
        .args,
      ["fetch", "--locked"],
    );
    assert.deepEqual(states.find((s) => s.manager === "go")!.declarations, [
      "go.mod",
    ]);
    assert.ok(
      states
        .find((s) => s.manager === "pip")!
        .remediation[0].run.steps[0].args.includes("--require-virtualenv"),
    );
  }));
test("missing package manager and malformed manifest do not claim installed dependencies", () =>
  fixture(async (f) => {
    await fs.writeFile(path.join(f.root, "package.json"), "{}");
    f.host.tool = async () => undefined;
    let [state] = await f.service.diagnose(f.root, [f.root]);
    assert.equal(state.state, "unknown");
    assert.ok(
      state.diagnostics.some((d) => d.code === "dependency.managerMissing"),
    );
    assert.equal(state.remediation.length, 0);
    await fs.writeFile(path.join(f.root, "package.json"), "{bad");
    [state] = await f.service.diagnose(f.root, [f.root]);
    assert.equal(state.state, "error");
  }));
test("new locks or changed declarations invalidate minted plans; user refusal cannot execute", () =>
  fixture(async (f) => {
    await fs.writeFile(path.join(f.root, "package.json"), "{}");
    await fs.writeFile(path.join(f.root, "package-lock.json"), "{}");
    let [state] = await f.service.diagnose(f.root, [f.root]);
    f.accept(false);
    assert.equal(
      (await f.runner.execute(state.remediation[0].id)).state,
      "cancelled",
    );
    assert.equal(f.commands.length, 1);
    f.accept(true);
    await fs.writeFile(
      path.join(f.root, "pnpm-lock.yaml"),
      "lockfileVersion: 9",
    );
    await assert.rejects(f.runner.execute(state.remediation[0].id), /变化/);
    [state] = await f.service.diagnose(f.root, [f.root]);
    assert.equal(state.state, "conflict");
  }));
test("multi-root isolation, cancellation and disconnect guard every dependency action", () =>
  fixture(async (f) => {
    const one = path.join(f.root, "one");
    const two = path.join(f.root, "two");
    await fs.mkdir(one);
    await fs.mkdir(two);
    await fs.writeFile(path.join(one, "go.mod"), "module one");
    await fs.writeFile(path.join(two, "Cargo.toml"), '[package]\nname="two"');
    const a = await f.service.diagnose(one, [one, two]);
    const b = await f.service.diagnose(two, [one, two]);
    assert.equal(a[0].manager, "go");
    assert.equal(b[0].manager, "cargo");
    assert.notEqual(a[0].workspace, b[0].workspace);
    const c = new AbortController();
    c.abort();
    await assert.rejects(
      f.service.diagnose(one, [one, two], { signal: c.signal }),
      /取消/,
    );
    f.guard.disconnect();
    await assert.rejects(f.runner.execute(a[0].remediation[0].id), /断开/);
  }));
test("SDK-selected npm JS entry preserves Node and argument prefixes", () =>
  fixture(async (f) => {
    await fs.writeFile(path.join(f.root, "package.json"), "{}");
    await fs.writeFile(path.join(f.root, "package-lock.json"), "{}");
    const node = path.join(f.root, "Node Runtime/node.exe");
    const cli = path.join(
      f.root,
      "Node Runtime/node_modules/npm/bin/npm-cli.js",
    );
    f.host.tool = async () => ({ command: node, prefix: [cli] });
    const [state] = await f.service.diagnose(f.root, [f.root]);
    assert.equal(state.remediation[0].run.steps[0].command, node);
    assert.deepEqual(state.remediation[0].run.steps[0].args, [cli, "ci"]);
  }));
test("untrusted dependency service cannot even query package managers", async () => {
  const guard = new HostGuard(hostFacts, () => false);
  const runner = new RemediationRunner(
    guard,
    {
      exclusive: async () => false,
      run: async () => {
        throw new Error("unexpected");
      },
      stop: () => {},
    },
    async () => true,
  );
  const service = new ProjectDependencyService(
    guard,
    {
      tool: async () => {
        throw new Error("unexpected");
      },
    },
    runner,
  );
  await assert.rejects(service.diagnose("/outside", ["/"]), /信任/);
});
test("host registry commands have packaged Chinese defaults and English fallback resources", async () => {
  const root = path.resolve(__dirname, "../..");
  const manifest = JSON.parse(
    await fs.readFile(path.join(root, "package.json"), "utf8"),
  );
  const zh = JSON.parse(
    await fs.readFile(path.join(root, "package.nls.json"), "utf8"),
  );
  const en = JSON.parse(
    await fs.readFile(path.join(root, "package.nls.en.json"), "utf8"),
  );
  for (const id of ["openToolchainRegistry", "rescanToolchains"]) {
    const command = manifest.contributes.commands.find(
      (c: { command: string }) => c.command === "sakuraAtelier." + id,
    );
    assert.ok(command);
    const key = command.title.slice(1, -1);
    assert.ok(zh[key]);
    assert.ok(en[key]);
    assert.match(zh[key], /[\u4e00-\u9fff]/);
  }
  assert.equal(manifest.version, "0.1.0");
  assert.deepEqual(manifest.extensionKind, ["workspace"]);
});
