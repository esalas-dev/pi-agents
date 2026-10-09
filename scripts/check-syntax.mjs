import { readdir, readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

async function typescriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(entries.map(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? typescriptFiles(path) : entry.isFile() && path.endsWith('.ts') ? [path] : [];
  }));
  return groups.flat().sort();
}

for (const file of ['index.ts', 'rpc.ts', ...await typescriptFiles('src')]) {
  try {
    const javascript = stripTypeScriptTypes(await readFile(file, 'utf8'), { mode: 'strip', sourceUrl: file });
    const result = spawnSync(process.execPath, ['--input-type=module', '--check'], {
      input: javascript, encoding: 'utf8',
    });
    if (result.status !== 0) {
      console.error(file, result.error?.message ?? result.stderr);
      process.exitCode = result.status ?? 1;
      break;
    }
  } catch (error) {
    console.error(file, error.message);
    process.exitCode = 1;
    break;
  }
}
