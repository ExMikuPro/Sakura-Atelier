// Verify the actual ZIP, including nested runtime modules, before declaring packaging successful.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
// yauzl is the ZIP reader shipped with the existing vsce packaging dependency.
const yauzl = require('yauzl');
(async () => {
  const manifest = JSON.parse(await fs.readFile('package.json', 'utf8'));
  assert.equal(`${manifest.publisher}.${manifest.name}`, 'ExMikuPro.sakura-atelier');
  assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/);
  let packagedManifest;
  let vsixManifest;
  const candidate = process.argv[2] || `${manifest.name}-${manifest.version}.vsix`;
  const entries = await new Promise((resolve, reject) => {
    yauzl.open(candidate, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      const files = new Set();
      zip.on('error', reject);
      zip.on('entry', entry => {
        files.add(entry.fileName);
        if (!['extension/package.json', 'extension.vsixmanifest'].includes(entry.fileName)) { zip.readEntry(); return; }
        zip.openReadStream(entry, (error, stream) => {
          if (error) return reject(error);
          const chunks = [];
          stream.on('error', reject);
          stream.on('data', chunk => chunks.push(chunk));
          stream.on('end', () => {
            try {
              const content = Buffer.concat(chunks).toString('utf8');
              if (entry.fileName === 'extension/package.json') packagedManifest = JSON.parse(content);
              else vsixManifest = content;
              zip.readEntry();
            } catch (error) { reject(error); }
          });
        });
      });
      zip.on('end', () => resolve(files));
      zip.readEntry();
    });
  });
  assert.ok(packagedManifest && vsixManifest, 'VSIX manifests missing');
  for (const key of ['name', 'publisher', 'version', 'main']) assert.equal(packagedManifest[key], manifest[key], `Packaged ${key} mismatch`);
  for (const [key, value] of [['Id', manifest.name], ['Publisher', manifest.publisher], ['Version', manifest.version]]) assert.ok(vsixManifest.includes(`${key}="${value}"`), `VSIX identity ${key} mismatch`);
  assert.ok(entries.has('extension/' + manifest.main.replace(/^\.\//, '')), 'VSIX entry point missing');
  let modules = 0;
  const expectedModules = new Set();
  async function check(directory) {
    for (const item of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.posix.join(directory, item.name);
      if (item.isDirectory()) await check(file);
      else if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
        const runtime = 'extension/out/' + file.replace(/\.ts$/, '.js');
        expectedModules.add(runtime);
        assert.ok(entries.has(runtime), `VSIX missing runtime module: ${runtime}`); modules++;
      }
    }
  }
  await check('src');
  for (const file of entries) {
    if (file.startsWith('extension/out/src/') && file.endsWith('.js')) assert.ok(expectedModules.has(file), `VSIX contains stale runtime module: ${file}`);
  }
  for (const file of ['package.json', 'configuration.schema.json', 'media/manager.js', 'media/autosave.js', 'media/templatePicker.js', 'media/localization.js', 'package.nls.json', 'package.nls.en.json', 'package.nls.zh-cn.json', 'media/manager.css', 'media/codicon.css', 'media/codicon.ttf', 'media/icon.png', 'media/CODICONS-LICENSE.txt', 'readme.md', 'changelog.md', 'LICENSE.txt', 'THIRD_PARTY_NOTICES.md', 'docs/PROJECT_CREATION.md']) {
    assert.ok(entries.has('extension/' + file), `VSIX missing resource: ${file}`);
  }
  assert.ok(!entries.has('extension/docs/embedded-manual-testing.md'), 'VSIX includes uncommitted user documentation');
  for (const file of entries) assert.ok(!/^extension\/(?:node_modules|node-test|src|scripts|test|\.test-output|\.vscode-test|\.vscode|\.git)\//.test(file), `VSIX contains development or local data: ${file}`);
  for (const file of entries) assert.ok(!/(?:^|\/)(?:\.DS_Store|\.env(?:\..*)?|[^/]+\.(?:pem|key|vsix|map))$/.test(file), `VSIX contains unexpected private/cache file: ${file}`);
  console.log(`Verified VSIX: ${modules} runtime modules and required UI resources included.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
