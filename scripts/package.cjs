const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const manifest = require('../package.json');
// A unique candidate directory prevents overwriting an existing package.
const directory = fs.mkdtempSync(path.resolve('sakura-release-candidate-'));
const output = path.join(directory, `${manifest.name}-${manifest.version}.vsix`);
const cli = require.resolve('@vscode/vsce/vsce');
const result = spawnSync(process.execPath, [cli, 'package', '--no-dependencies',
  '--baseContentUrl', 'https://github.com/ExMikuPro/Sakura-Atelier/blob/dev/',
  '--baseImagesUrl', 'https://github.com/ExMikuPro/Sakura-Atelier/raw/dev/', '--out', output], { stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
const verified = spawnSync(process.execPath, [path.resolve('scripts/verify-package.cjs'), output], { stdio: 'inherit' });
if (verified.error) throw verified.error;
process.exitCode = verified.status || (verified.signal ? 1 : 0);
