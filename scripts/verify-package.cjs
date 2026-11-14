// Verify the actual ZIP, including nested runtime modules, before declaring packaging successful.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
// yauzl is the ZIP reader shipped with the existing vsce packaging dependency.
const yauzl = require('yauzl');
(async () => {
  const manifest = JSON.parse(await fs.readFile('package.json', 'utf8'));
  assert.equal(`${manifest.publisher}.${manifest.name}`, 'ExMikuPro.sakura-atelier');
  assert.equal(manifest.version, '0.1.0');
  const entries = await new Promise((resolve, reject) => {
    yauzl.open(`sakura-atelier-${manifest.version}.vsix`, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      const files = new Set();
      zip.on('error', reject);
      zip.on('entry', entry => { files.add(entry.fileName); zip.readEntry(); });
      zip.on('end', () => resolve(files));
      zip.readEntry();
    });
  });
  let modules = 0;
  async function check(directory) {
    for (const item of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.posix.join(directory, item.name);
      if (item.isDirectory()) await check(file);
      else if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
        const runtime = 'extension/out/' + file.replace(/\.ts$/, '.js');
        assert.ok(entries.has(runtime), `VSIX missing runtime module: ${runtime}`); modules++;
      }
    }
  }
  await check('src');
  for (const file of ['package.json', 'configuration.schema.json', 'media/manager.js', 'media/autosave.js', 'media/templatePicker.js', 'media/localization.js', 'package.nls.json']) {
    assert.ok(entries.has('extension/' + file), `VSIX missing resource: ${file}`);
  }
  for (const file of entries) assert.ok(!/^extension\/(?:node_modules|test|\.test-output|\.vscode-test|\.vscode)\//.test(file), `VSIX contains development or local data: ${file}`);
  console.log(`Verified VSIX: ${modules} runtime modules and required UI resources included.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
