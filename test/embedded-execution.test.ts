import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { runInNewContext } from 'node:vm';
import type { EmbeddedPlan } from '../src/embedded/plan';

test('embedded device cancellation performs neither a build nor a debug launch; confirmed debug builds first and uses shared ownership', async () => {
  const calls: string[] = []; let approved = false; let fails = false;
  const exports: { executeEmbeddedPlan?: (...args: unknown[]) => Promise<void> } = {};
  const vscode = { window: { showWarningMessage: async () => { calls.push('confirm'); return approved ? 'Continue' : undefined; } }, extensions: { getExtension: () => ({}) } };
  const source = await fs.readFile(path.join(__dirname, '../src/embedded/commands.js'), 'utf8');
  runInNewContext(source, { exports, require: (id: string) => id === 'vscode' ? vscode : id === '../model' ? { RunnerError: Error } : {}, console });
  const executor = { exclusive: async (work: () => Promise<void>) => { await work(); return true; }, run: async () => { calls.push('build'); if (fails) throw new Error('compiler failed'); } };
  const debug = { start: async () => { calls.push('owned-debug'); } };
  const plan: EmbeddedPlan = { backend: 'stm32', operation: 'debug', label: 'Debug', blockers: [], risk: 'writes-device', confirm: 'Write firmware?', steps: [{ command: 'cmake', args: ['--build', 'build'], cwd: '/fixture', label: 'Build' }], debug: { extension: 'marus25.cortex-debug', configuration: { type: 'cortex-debug' } } };
  await exports.executeEmbeddedPlan!(plan, {}, executor, debug); assert.deepEqual(calls, ['confirm']);
  calls.length = 0; approved = true;
  await exports.executeEmbeddedPlan!(plan, {}, executor, debug); assert.deepEqual(calls, ['confirm', 'build', 'owned-debug']);
  calls.length = 0; fails = true;
  await assert.rejects(exports.executeEmbeddedPlan!(plan, {}, executor, debug), /compiler failed/); assert.deepEqual(calls, ['confirm', 'build']);
});
