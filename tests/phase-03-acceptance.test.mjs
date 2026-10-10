import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const acceptancePath = new URL('../docs/PHASE-03-ACCEPTANCE.md', import.meta.url);
const roadmapPath = new URL('../specs/ROADMAP.md', import.meta.url);

test('registra AC-03-01..17 y conserva los límites de la promoción administrativa', async () => {
  const acceptance = await readFile(acceptancePath, 'utf8');
  const roadmap = await readFile(roadmapPath, 'utf8');
  const registered = [...acceptance.matchAll(/^\| (AC-03-\d{2}) \|/gm)].map(match => match[1]);
  assert.deepEqual(registered, Array.from({ length: 17 }, (_, index) => `AC-03-${String(index + 1).padStart(2, '0')}`));
  assert.match(acceptance, /^\| Revisión independiente \| Completada por decisión humana \|/m);
  assert.match(acceptance, /^\| Aceptación TUI humana \| Completada con límites \|/m);
  assert.match(roadmap, /^\| 03 \| `completada` \|/m);
  assert.match(acceptance, /Los gates automáticos no equivalen a revisión independiente ni aceptación TUI humana\./);
});
