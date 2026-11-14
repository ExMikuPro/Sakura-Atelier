import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import type { RuntimeLanguage } from "../configuration";
export interface HostCandidate {
  language: RuntimeLanguage;
  executable: string;
  source: string;
  variant?: string;
}
/** Enumerates only named SDK roots and one version-directory level. Never walks a disk or a home directory. */
export async function hostCandidates(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home = os.homedir(),
): Promise<HostCandidate[]> {
  const p = platform === "win32" ? path.win32 : path.posix;
  const result: HostCandidate[] = [];
  const win = platform === "win32";
  const bins: Partial<Record<RuntimeLanguage, string[]>> = {
    go: ["go"],
    rust: ["cargo"],
    python: ["python3", "python"],
    node: ["node"],
    c: ["clang", "gcc", ...(win ? ["cl"] : [])],
    cpp: ["clang++", "g++", ...(win ? ["cl"] : [])],
    csharp: ["dotnet"],
    java: ["java"],
  };
  const add = (
    language: RuntimeLanguage,
    directory: string,
    source: string,
    variant?: string,
  ) => {
    for (const name of bins[language] ?? []) {
      const executable = p.join(directory, name + (win ? ".exe" : ""));
      result.push({ language, executable, source, variant });
    }
  };
  const each = async (
    root: string,
    callback: (directory: string, name: string) => void,
  ) => {
    try {
      for (const entry of (await fs.readdir(root, { withFileTypes: true }))
        .filter((e) => e.isDirectory() || e.isSymbolicLink())
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 80))
        callback(p.join(root, entry.name), entry.name);
    } catch {
      /* Missing known install roots are normal. */
    }
  };
  const pathDirectories = (env.PATH ?? env.Path ?? "")
    .split(win ? ";" : ":")
    .filter((d) => p.isAbsolute(d));
  for (const directory of [
    ...pathDirectories,
    ...(win ? [] : ["/usr/bin", "/usr/local/bin"]),
    ...(platform === "darwin" ? ["/opt/homebrew/bin", "/usr/local/bin"] : []),
  ])
    for (const language of Object.keys(bins) as RuntimeLanguage[])
      add(language, directory, "PATH / 系统安装");
  if (env.GOROOT) add("go", p.join(env.GOROOT, "bin"), "GOROOT");
  const cargo = env.CARGO_HOME || p.join(home, ".cargo");
  add("rust", p.join(cargo, "bin"), "Cargo");
  await each(
    p.join(env.RUSTUP_HOME || p.join(home, ".rustup"), "toolchains"),
    (dir, variant) => add("rust", p.join(dir, "bin"), "rustup", variant),
  );
  await each(
    p.join(env.NVM_DIR || p.join(home, ".nvm"), "versions", "node"),
    (dir) => add("node", p.join(dir, "bin"), "nvm"),
  );
  await each(
    p.join(env.VOLTA_HOME || p.join(home, ".volta"), "tools", "image", "node"),
    (dir) => add("node", p.join(dir, "bin"), "Volta"),
  );
  const fnm =
    env.FNM_DIR ||
    p.join(env.XDG_DATA_HOME || p.join(home, ".local", "share"), "fnm");
  await each(p.join(fnm, "node-versions"), (dir) =>
    add("node", p.join(dir, "installation", win ? "" : "bin"), "fnm"),
  );
  await each(
    p.join(env.PYENV_ROOT || p.join(home, ".pyenv"), "versions"),
    (dir) => add("python", win ? dir : p.join(dir, "bin"), "pyenv"),
  );
  for (const [root, source] of [
    [env.ASDF_DATA_DIR || p.join(home, ".asdf"), "asdf"],
    [env.MISE_DATA_DIR || p.join(home, ".local", "share", "mise"), "mise"],
  ]) {
    const installs = p.join(root, "installs");
    for (const [name, language] of [
      ["python", "python"],
      ["nodejs", "node"],
      ["node", "node"],
      ["golang", "go"],
      ["go", "go"],
      ["java", "java"],
    ] as const) {
      await each(p.join(installs, name), (dir) =>
        add(language, p.join(dir, "bin"), source),
      );
    }
  }
  for (const key of ["CONDA_PREFIX", "VIRTUAL_ENV"])
    if (env[key])
      add("python", win ? env[key]! : p.join(env[key]!, "bin"), key);
  for (const prefix of (env.CONDA_ENVS_PATH || "")
    .split(win ? ";" : ":")
    .filter(Boolean))
    await each(prefix, (dir) =>
      add("python", win ? dir : p.join(dir, "bin"), "Conda"),
    );
  for (const prefix of [
    p.join(home, "miniconda3"),
    p.join(home, "anaconda3"),
  ]) {
    add("python", win ? prefix : p.join(prefix, "bin"), "Conda");
    await each(p.join(prefix, "envs"), (dir) =>
      add("python", win ? dir : p.join(dir, "bin"), "Conda"),
    );
  }
  if (env.JAVA_HOME) add("java", p.join(env.JAVA_HOME, "bin"), "JAVA_HOME");
  if (env.DOTNET_ROOT) add("csharp", env.DOTNET_ROOT, ".NET");
  if (platform === "darwin") {
    for (const opt of ["/opt/homebrew/opt", "/usr/local/opt"])
      await each(opt, (dir, name) => {
        if (/^openjdk(?:@\d+)?$/.test(name))
          add("java", p.join(dir, "bin"), "Homebrew");
        if (/^python(?:@\d+(?:\.\d+)?)?$/.test(name)) {
          add("python", p.join(dir, "bin"), "Homebrew");
          add("python", p.join(dir, "libexec", "bin"), "Homebrew");
        }
        if (/^node(?:@\d+)?$/.test(name))
          add("node", p.join(dir, "bin"), "Homebrew");
      });
    await each("/Library/Java/JavaVirtualMachines", (dir) =>
      add("java", p.join(dir, "Contents", "Home", "bin"), "macOS JDK"),
    );
    await each("/Library/Frameworks/Python.framework/Versions", (dir) =>
      add("python", p.join(dir, "bin"), "Python 官方安装"),
    );
    add("csharp", "/usr/local/share/dotnet", ".NET 官方安装");
    await each("/opt/homebrew/Cellar/go", (dir) =>
      add("go", p.join(dir, "libexec", "bin"), "Homebrew"),
    );
    await each("/usr/local/Cellar/go", (dir) =>
      add("go", p.join(dir, "libexec", "bin"), "Homebrew"),
    );
  } else if (platform === "linux") {
    await each("/usr/lib/jvm", (dir) =>
      add("java", p.join(dir, "bin"), "Linux JDK"),
    );
    add("csharp", "/usr/share/dotnet", ".NET 系统安装");
    add("go", "/usr/local/go/bin", "Go 官方安装");
  } else if (win) {
    for (const root of [env.ProgramFiles, env["ProgramFiles(x86)"]].filter(
      (r): r is string => !!r,
    )) {
      add("go", p.join(root, "Go", "bin"), "Go 官方安装");
      add("node", p.join(root, "nodejs"), "Node.js 官方安装");
      add("csharp", p.join(root, "dotnet"), ".NET 官方安装");
      add("c", p.join(root, "LLVM", "bin"), "LLVM");
      add("cpp", p.join(root, "LLVM", "bin"), "LLVM");
      await each(p.join(root, "Java"), (dir) =>
        add("java", p.join(dir, "bin"), "Windows JDK"),
      );
    }
    if (env.LOCALAPPDATA)
      await each(p.join(env.LOCALAPPDATA, "Programs", "Python"), (dir) =>
        add("python", dir, "Python 官方安装"),
      );
    for (const key of ["MINGW_PREFIX", "MSYSTEM_PREFIX"])
      if (env[key]) {
        add("c", p.join(env[key]!, "bin"), "MSYS2");
        add("cpp", p.join(env[key]!, "bin"), "MSYS2");
      }
  }
  const unique = new Map<string, HostCandidate>();
  for (const candidate of result) {
    const key =
      candidate.language +
      "\0" +
      (win ? candidate.executable.toLowerCase() : candidate.executable);
    if (!unique.has(key)) unique.set(key, candidate);
  }
  return [...unique.values()];
}
/** Bootstrap/version-manager shims may download runtimes. Probe physical installed versions instead. */
export function safeAutomaticCandidate(
  candidate: HostCandidate,
  workspaces: readonly string[],
): boolean {
  const normalized = candidate.executable.replace(/\\/g, "/");
  if (/\/(?:shims|\.volta\/bin|\.cargo\/bin)\//.test(normalized)) return false;
  return !workspaces.some((root) => {
    const r = root.replace(/\\/g, "/").replace(/\/$/, "");
    return normalized === r || normalized.startsWith(r + "/");
  });
}
