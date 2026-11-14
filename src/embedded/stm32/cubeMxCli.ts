import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import type { CancellationToken } from 'vscode';
import type { CubeMxGeneration } from './cubeMxScript';
import { parseIoc } from './ioc';

/** Metadata only: never start a GUI application to query its version. */
export async function requireClassicCubeMx(executable: string): Promise<void> {
  if (!/^STM32CubeMX(?:\.exe)?$/i.test(path.basename(executable))) throw new Error('Select the classic STM32CubeMX 6.x executable.');
  if (process.platform === 'darwin') {
    const plist = await fs.readFile(path.resolve(path.dirname(executable), '../Info.plist'), 'utf8').catch(() => '');
    const version = plist.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
    if (!version || !/^6\./.test(version)) throw new Error(`This workflow requires classic STM32CubeMX 6.x. Selected app version: ${version ?? 'unknown'}.`);
  }
}

const running = new Map<string, () => void>();
export function cancelCubeMxGenerations(): void { for (const stop of running.values()) stop(); }

async function hasMainSource(root: string, depth = 0): Promise<boolean> {
  if (depth > 4) return false;
  const entries = await fs.readdir(root, { withFileTypes: true });
  if (entries.some(entry => entry.isFile() && /^main\.c(?:pp)?$/i.test(entry.name))) return true;
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith('.') && !['Drivers', 'Middlewares', 'build'].includes(entry.name) && await hasMainSource(path.join(root, entry.name), depth + 1)) return true;
  }
  return false;
}
export async function generateWithCubeMx(job: CubeMxGeneration, output: (text: string) => void, cancellation?: CancellationToken): Promise<void> {
  const key = await fs.realpath(job.root);
  if (running.has(key)) throw new Error('CubeMX is already generating this project.');
  let cancelled = false;
  running.set(key, () => { cancelled = true; });
  let log = '';
  let directory: string | undefined;
  try {
    await requireClassicCubeMx(job.executable);
    if (cancelled || cancellation?.isCancellationRequested) throw new Error('CubeMX generation cancelled.');
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sakura-cubemx-'));
    const script = path.join(directory, 'generate.mx');
    await fs.writeFile(script, job.script, { flag: 'wx' });
    if (cancelled || cancellation?.isCancellationRequested) throw new Error('CubeMX generation cancelled.');
    output(`STM32CubeMX 6.x ${job.mode}\nProject: ${job.root}\nScript: ${script}\n`);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(job.executable, [job.mode, script], { cwd: path.dirname(job.executable), shell: false, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let done = false;
      const subscription: { value?: { dispose(): void } } = {};
      const finish = (error?: Error) => { if (done) return; done = true; clearTimeout(timer); subscription.value?.dispose(); if (error) reject(error); else resolve(); };
      const stop = (message: string) => {
        try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* already exited */ }
        finish(new Error(message));
      };
      const timer = setTimeout(() => stop('CubeMX generation timed out after 5 minutes. Check firmware packages and the generation log.'), 300000);
      running.set(key, () => stop('CubeMX generation cancelled. Partial generated files were kept.'));
      subscription.value = cancellation?.onCancellationRequested(() => stop('CubeMX generation cancelled. Partial generated files were kept.'));
      const receive = (chunk: Buffer) => {
        const text = chunk.toString('utf8'); log = (log + text).slice(-8 * 1024 * 1024); output(text);
      };
      child.stdout.on('data', receive); child.stderr.on('data', receive);
      child.once('error', error => finish(error));
      child.once('close', (code, signal) => finish(code === 0 ? undefined : new Error(`CubeMX failed (${signal ?? code}). Check the generation log.`)));
      if (cancellation?.isCancellationRequested) stop('CubeMX generation cancelled.');
    });
    // CubeMX can report command/generation errors yet exit with status zero.
    if (/(?:^|\n)\s*(?:\[ERROR\]|ERROR\s*:|Exception in thread|Code generation failed|Project generation failed|Unknown command|Invalid command|KO\b)/i.test(log)) throw new Error('CubeMX reported a generation error. Check its log.');
    const info = parseIoc(await fs.readFile(job.ioc, 'utf8'));
    if (!info.mcu || info.projectName !== (job.projectName ?? path.basename(job.ioc, path.extname(job.ioc)))) throw new Error('CubeMX did not save the expected .ioc project. Check the selected device and generation log.');
    if (job.device?.kind === 'stm32-mcu' && info.mcu.toUpperCase() !== job.device.id.toUpperCase()) throw new Error('The generated .ioc MCU does not match the selected MCU.');
    if (job.device?.kind === 'stm32-board' && info.board.toUpperCase() !== job.device.id.toUpperCase()) throw new Error('The generated .ioc board does not match the selected board.');
    if (job.toolchain === 'CMake') {
      const cmake = await fs.readFile(path.join(job.root, 'CMakeLists.txt'), 'utf8');
      const files = await fs.readdir(path.join(job.root, 'cmake'));
      if (!cmake.trim() || !files.some(file => /arm-none-eabi.*\.cmake$/i.test(file)) || !await hasMainSource(job.root)) throw new Error('CubeMX did not generate a complete CMake / ARM GCC project. Use a CubeMX 6.x version supporting CMake and install the required STM32Cube firmware package.');
    } else {
      const marker = job.toolchain === 'Makefile' ? 'Makefile' : '.project';
      try { await fs.access(path.join(job.root, marker)); }
      catch (error) { if (job.toolchain !== 'STM32CubeIDE') throw error; await fs.access(path.join(job.root, 'STM32CubeIDE', marker)); }
    }
    output('\nCubeMX generation completed: .ioc and build-system files are present.\n');
  } catch (error) {
    log += `\nGeneration failed: ${String(error)}\n`;
    output(`\nGeneration failed: ${String(error)}\nMissing firmware packages must be installed in STM32CubeMX before retrying.\n`);
    throw new Error(`${error instanceof Error ? error.message : String(error)}${directory ? ` Log: ${path.join(directory, 'generation.log')}` : ''}`);
  } finally {
    if (directory) await fs.writeFile(path.join(directory, 'generation.log'), log, { flag: 'wx' }).catch(() => {});
    running.delete(key);
  }
}
