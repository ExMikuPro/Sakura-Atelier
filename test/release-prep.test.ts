import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { runInNewContext } from 'node:vm';

test('managed Run and Debug reject a concurrent operation without planning or executing it', async () => {
  const source = await fs.readFile(path.resolve(__dirname, '../src/controller.js'), 'utf8');
  const exports: { AtelierController?: { prototype: { run: (action: string) => Promise<void> } } } = {};
  runInNewContext(source, { exports, require: (id: string) => id === 'vscode' ? { workspace: { isTrusted: true, workspaceFolders: [{}] } } : id === './model' ? { RunnerError: Error } : id === './embedded/platformio/workflow' ? { activePlatformioRoot: async () => undefined } : {} });
  const controller = Object.create(exports.AtelierController!.prototype);
  let attempts = 0;
  controller.editorContext = async () => ({ folder: {}, root: '/fixture' });
  controller.store = { read: async () => ({ document: { configurations: [{ id: 'run', templateId: 'node.application' }] } }), selection: () => ({ kind: 'managed', id: 'run' }) };
  controller.executor = { exclusive: async () => { attempts++; return false; } };
  for (const action of ['run', 'debug']) await assert.rejects(controller.run(action), /Another Sakura Atelier operation is running/);
  assert.equal(attempts, 2);
});
