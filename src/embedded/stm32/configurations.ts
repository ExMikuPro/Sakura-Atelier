import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { AtelierConfiguration, ConfigurationFile, newConfiguration, portablePath } from '../../configuration';
import { Stm32Project } from './project';

/** Only families with an explicit known upstream target are recommended. Unknown parts remain unset. */
export function recommendedTarget(mcu: string): string {
  if (/^STM32(H7[RS]|WBA)/i.test(mcu)) return '';
  const family = mcu.toUpperCase().match(/^STM32(F0|F1|F2|F3|F4|F7|G0|G4|H7|L0|L1|L4|L5|U5|WB|WL)/)?.[1];
  const targets: Record<string,string> = { F0:'stm32f0x', F1:'stm32f1x', F2:'stm32f2x', F3:'stm32f3x', F4:'stm32f4x', F7:'stm32f7x', G0:'stm32g0x', G4:'stm32g4x', H7:'stm32h7x', L0:'stm32l0', L1:'stm32l1', L4:'stm32l4x', L5:'stm32l5x', U5:'stm32u5x', WB:'stm32wbx', WL:'stm32wlx' };
  return family && targets[family] ? `target/${targets[family]}.cfg` : '';
}
export function stm32Configurations(project: Stm32Project, workspace: string): AtelierConfiguration[] {
  const relative = path.relative(workspace, project.root).split(path.sep).join('/');
  const prefix = 'stm32-' + createHash('sha256').update(relative || '.').digest('hex').slice(0,12);
  const debugPreset = project.presets.find(p => /debug/i.test(project.presetBuildTypes?.[p] || p)) || project.presets[0] || '';
  const releasePreset = project.presets.find(p => /release/i.test(project.presetBuildTypes?.[p] || p));
  const variants = [['build-debug','编译 Debug','build','debug',debugPreset], ...(releasePreset ? [['build-release','编译 Release','build','release',releasePreset]] : []), ['run','运行（烧录并启动）','run','debug',debugPreset], ['debug','OpenOCD 调试','debug','debug',debugPreset]];
  return variants.map(([suffix,label,action,profile,preset]) => ({ ...newConfiguration('c', `STM32 — ${label}`), id:`${prefix}-${suffix}`, templateId:'stm32', kind:'project', target:portablePath(project.root, workspace), cwd:portablePath(project.root, workspace), operation:action === 'build' ? 'build' : 'run', profile:profile as 'debug'|'release', stm32Action:action, stm32Preset:preset, stm32Target:recommendedTarget(project.ioc?.info.mcu || '') }));
}
/** Stable project-relative ids make repeated scanning idempotent and preserve user edits. */
export function mergeStm32Configurations(document: ConfigurationFile, projects: Stm32Project[], workspace: string): ConfigurationFile {
  const configurations = [...document.configurations];
  for (const project of projects) for (const c of stm32Configurations(project, workspace)) if (!configurations.some(existing => existing.id === c.id || (existing.templateId === 'stm32' && existing.target === c.target && existing.stm32Action === c.stm32Action && existing.profile === c.profile))) configurations.push(c);
  return { ...document, configurations };
}
/** Tcl string quoting is independent of shell argv quoting. */
export function tclString(value: string): string {
  if (/[\0\r\n]/.test(value)) throw new Error('OpenOCD 路径不能包含控制字符。');
  return '"' + value.replace(/([\\"$\[\]])/g, '\\$1') + '"';
}
export function openocdArguments(c: AtelierConfiguration): string[] {
  if (!c.stm32Probe || !c.stm32Interface || !c.stm32Target) throw new Error('请选择调试探针、Interface 配置和芯片 Target 配置后再烧录或调试。');
  if (!['swd','jtag'].includes(c.stm32Transport)) throw new Error('请选择 SWD 或 JTAG。');
  if (!/^\d+$/.test(c.stm32Speed) || Number(c.stm32Speed) < 1 || Number(c.stm32Speed) > 50000) throw new Error('Adapter Speed 必须为 1–50000 kHz。');
  if (!/^\d+$/.test(c.stm32Port) || Number(c.stm32Port) < 1024 || Number(c.stm32Port) > 65535) throw new Error('GDB Server 端口必须为 1024–65535。');
  const transport = c.stm32Probe === 'stlink' ? `hla_${c.stm32Transport}` : c.stm32Transport;
  return ['-f',c.stm32Interface,'-c',`transport select ${transport}`,'-f',c.stm32Target,'-c',`adapter speed ${Number(c.stm32Speed)}`];
}
export function cortexConfiguration(c: AtelierConfiguration, root: string, elf: string, gdb: string): Record<string,unknown> {
  return { name:c.name, type:'cortex-debug', request:'launch', servertype:'external', cwd:root, executable:elf, gdbPath:gdb, armToolchainPath:path.dirname(gdb), gdbTarget:`localhost:${Number(c.stm32Port)}`, ...(c.stm32Main === 'true' ? { runToEntryPoint:'main' } : { breakAfterReset:true }), overrideLaunchCommands:['monitor reset halt', ...(c.stm32Load === 'true' ? ['load'] : []), 'monitor reset halt'] };
}
