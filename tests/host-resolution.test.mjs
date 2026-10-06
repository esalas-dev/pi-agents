import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { resolveHost, generateHostConfig } from '../scripts/host-types.mjs';

test('resuelve declaraciones públicas del host real y subpaths de pi-ai', async () => {
  const host = await resolveHost();
  assert.equal(host.version, '1.0.4');
  assert.ok(isAbsolute(host.root));
  await access(host.declarations['@earendil-works/pi-coding-agent']);
  await access(host.declarations['@earendil-works/pi-ai/models']);
  await access(host.declarations['@earendil-works/pi-ai/providers/*'].replace('*', 'faux'));
  assert.equal(host.packages['@earendil-works/pi-ai'].version, '1.0.4');
  // Source-only exports are not silently made into fabricated declarations.
  assert.equal(host.declarations['@earendil-works/pi-coding-agent/client'], undefined);
});

test('rechaza host ausente o un paquete que no es Pi', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-agents-host-'));
  try {
    await assert.rejects(resolveHost({ packageRoot: join(root, 'absent') }), /Pi/);
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'unrelated', version: '1.0.4' }));
    await assert.rejects(resolveHost({ packageRoot: root }), /Pi/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('configuración de tipos se genera fuera de los archivos versionados', async () => {
  const { readFile } = await import('node:fs/promises');
  const root = await mkdtemp(join(tmpdir(), 'pi-agents-config-'));
  try {
    await writeFile(join(root, 'tsconfig.json'), '{"compilerOptions":{"strict":true,"noEmit":true}}');
    const outFile = join(root, '.cache', 'pi-agents', 'tsconfig.host.json');
    await generateHostConfig({ root, outFile });
    const generated = JSON.parse(await readFile(outFile, 'utf8'));
    assert.equal(generated.extends, '../../tsconfig.json');
    assert.ok(generated.compilerOptions.paths['@earendil-works/pi-ai/models'][0].endsWith('models.d.ts'));
    assert.equal((await readFile(join(root, 'tsconfig.json'), 'utf8')), '{"compilerOptions":{"strict":true,"noEmit":true}}');
  } finally { await rm(root, { recursive: true, force: true }); }
});
