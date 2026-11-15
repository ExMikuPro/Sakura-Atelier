import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export const arduinoMain = '#include <Arduino.h>\n\nvoid setup() {\n}\n\nvoid loop() {\n}\n';
/** Seed an empty Arduino source directory only. Existing C/C++/INO sources always win. */
export async function ensureArduinoEntry(sourceDirectory: string): Promise<boolean> {
  await fs.mkdir(sourceDirectory,{recursive:true});
  const pending=[sourceDirectory];
  while (pending.length) {
    const directory=pending.pop()!;
    for (const entry of await fs.readdir(directory,{withFileTypes:true})) {
      if (/\.(?:ino|pde|c|cpp|cxx|cc|s)$/i.test(entry.name)) return false;
      if (entry.isDirectory() && !entry.isSymbolicLink()) pending.push(path.join(directory,entry.name));
    }
  }
  try { await fs.writeFile(path.join(sourceDirectory,'main.cpp'),arduinoMain,{flag:'wx'});return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code==='EEXIST') return false;throw error; }
}
