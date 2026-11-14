const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const files = fs
  .readdirSync(path.join(__dirname, "../out/test"))
  .filter((file) => /^p1-.*\.test\.js$/.test(file))
  .map((file) => path.join(__dirname, "../out/test", file));
if (!files.length) throw new Error("请先运行 npm run compile。");
const result = spawnSync(process.execPath, ["--test", ...files], {
  stdio: "inherit",
});
process.exitCode = result.status ?? 1;
