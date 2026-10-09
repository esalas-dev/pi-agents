import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateHostConfig } from '../scripts/host-types.mjs';

const root = resolve(import.meta.dirname, '..');
async function typecheckSource(source) {
  const directory = await mkdtemp(join(tmpdir(), 'pi-agents-type-'));
  try {
    const generated = join(directory, 'host.json');
    await generateHostConfig({ root, outFile: generated });
    await writeFile(join(directory, 'fixture.ts'), source);
    await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({
      extends: './host.json', files: ['./fixture.ts'], include: [], exclude: [],
    }));
    const result = spawnSync(process.execPath, [
      join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--pretty', 'false',
      '-p', join(directory, 'tsconfig.json'),
    ], { encoding: 'utf8' });
    result.emitted = await access(join(directory, 'fixture.js')).then(() => true, () => false);
    return result;
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('tsc rechaza una asignación inválida aunque su sintaxis sea correcta', () => typecheckSource('const count: number = "wrong";').then(result => {
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /TS2322/);
}));

test('tsc acepta una asignación correcta sin emitir JavaScript', async () => {
  const result = await typecheckSource('const count: number = 1;');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.emitted, false);
});

test('check-syntax incluye todos los TS de src y el entrypoint rpc.ts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-agents-syntax-'));
  try {
    await writeFile(join(directory, 'package.json'), '{"type":"module"}');
    await mkdir(join(directory, 'src', 'nested'), { recursive: true });
    await writeFile(join(directory, 'index.ts'), 'export default () => {};');
    await writeFile(join(directory, 'rpc.ts'), 'const bad: number = ;');
    await writeFile(join(directory, 'src', 'nested', 'new.ts'), 'const bad: number = ;');
    const run = () => spawnSync(process.execPath, [join(root, 'scripts/check-syntax.mjs')], { cwd: directory, encoding: 'utf8' });
    assert.notEqual(run().status, 0);
    await writeFile(join(directory, 'src', 'nested', 'new.ts'), 'const good: number = 1;');
    assert.notEqual(run().status, 0, 'rpc.ts debe formar parte del gate');
    await writeFile(join(directory, 'rpc.ts'), 'export type RpcVersion = 1;');
    const good = run();
    assert.equal(good.status, 0, good.stdout + good.stderr);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
