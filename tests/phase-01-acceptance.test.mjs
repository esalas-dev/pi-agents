import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = name => readFile(join(root, name), 'utf8');

test('documenta la interfaz y los gates de fase 01', async () => {
  const [readme, architecture, roadmap, acceptance] = await Promise.all([
    read('README.md'), read('docs/ARCHITECTURE.md'), read('specs/ROADMAP.md'), read('docs/PHASE-01-ACCEPTANCE.md'),
  ]);
  const all = `${readme}\n${architecture}\n${roadmap}\n${acceptance}`;
  for (const name of ['/subagents list', '/subagents wait', '/subagents approve', '/subagents reject', 'pi_agents_status', 'pi_agents_list', 'pi_agents_wait', 'pi_agents_result']) assert.match(all, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(all, /64 KiB/);
  assert.match(all, /esquema 2/);
  assert.match(all, /2.*3|3.*2/);
  assert.match(all, /snapshot.*suscri|suscri.*snapshot/i);
  assert.doesNotMatch(all, /TODO|TBD/);
  assert.match(acceptance, /AC-01/);
  assert.match(acceptance, /migraci[oó]n humana/i);
});
