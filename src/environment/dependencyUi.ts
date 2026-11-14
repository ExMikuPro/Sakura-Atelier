import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AtelierController } from '../controller';
import { ui } from '../ui';
import { t } from '../i18n';
import { resolveTool } from '../tools';
import { createProjectDependencyServices } from './dependencyServiceHost';
import { hostToolchains } from './registryAccess';

/** Uses the existing Run Configuration and SDK binding; inspection never creates a second selection store. */
export async function inspectProjectDependencies(controller: AtelierController, id?: string): Promise<void> {
  const registry = hostToolchains();
  registry?.guard.assert();
  await registry?.settled();
  const ctx = await controller.editorContext();
  const { document } = await controller.store.read(ctx.folder);
  const selected = controller.store.selection(ctx.folder, ctx.root, document);
  const config = document.configurations.find(c => c.id === (id ?? (selected.kind === 'managed' ? selected.id : '')));
  const selection = { python: controller.defaultSdk('python', ctx.folder)?.executable, node: controller.defaultSdk('node', ctx.folder)?.executable };
  let root = ctx.root;
  if (config && ['python', 'node', 'javascript', 'javascriptreact', 'typescript', 'typescriptreact'].includes(config.language)) {
    const cache = await fs.mkdtemp(path.join(os.tmpdir(), 'sakura-dependency-inspection-'));
    try {
      // Resolve portable SDK references without changing the official Python interpreter selection.
      const resolved = await controller.resolved(config, ctx, cache, false);
      root = resolved.context.root;
      if (config.language === 'python') selection.python = await resolveTool(resolved.context.toolchain || 'python3', root);
      else selection.node = await resolveTool(resolved.context.toolchain || 'node', root);
    } finally { await fs.rm(cache, { recursive: true, force: true }); }
  }
  const services = createProjectDependencyServices(selection);
  try {
    const statuses = await services.service.diagnose(root, (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath), { checkInstalled: true });
    const summary = statuses.map(s => `${s.manager ?? s.language}: ${s.state} · ${s.root}\n${s.diagnostics.map(d => d.message).join('\n')}`).join('\n\n');
    const choices = statuses.flatMap(s => s.remediation.map(plan => ({ label: plan.title.message, description: `${s.manager}: ${s.state}`, detail: s.root, plan })));
    if (!choices.length) { await ui.showInformationMessage(summary || t('No dependency declarations found in this project.')); return; }
    const choice = await ui.showQuickPick([{ label: t('Inspect only; do not run a repair'), description: '', detail: summary, plan: undefined }, ...choices], { title: t('Dependency inspection'), placeHolder: t('Select a repair plan to review its native confirmation.') });
    if (!choice?.plan) return;
    // The runner revalidates the plan and always shows the production native confirmation.
    const result = await services.runner.execute(choice.plan.id);
    await ui.showInformationMessage(t('Dependency operation: {0}', result.state));
  } finally { services.dispose(); }
}
