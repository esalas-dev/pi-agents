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

test('los artefactos operativos de fase 03 coinciden con el cierre integrado', async () => {
  for (const path of ['README.md', 'docs/ARCHITECTURE.md', 'specs/README.md',
    'specs/ROADMAP.md', 'specs/RECONCILIATION.md', 'specs/003-eventos-rpc/spec.md',
    'specs/003-eventos-rpc/plan.md', 'specs/003-eventos-rpc/tasks.md']) {
    const content = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
    let operative = content;
    if (path.endsWith('/tasks.md')) operative = content.split('**Tests**:')[0];
    if (path === 'specs/ROADMAP.md') operative = content.split('## Fase 03 —')[1].split('## Fase 04 —')[0];
    if (path === 'specs/RECONCILIATION.md') operative = content.split('## Base y autoridad')[0] + '\n' + content.match(/^\| 003 \|.*$/m)?.[0];
    assert.match(operative, /[Ff]ase 03 completada e integrada en `main`/, path);
    assert.doesNotMatch(operative, /fase (?:03|implementada).*?en validación|gates (?:propios )?pendientes|nueva revisión aún pendiente|alcance por precisar/i, path);
  }
  const acceptance = await readFile(acceptancePath, 'utf8');
  assert.match(acceptance, /9c87c77/);
  assert.match(acceptance, /54e095a/);
  assert.doesNotMatch(acceptance, /^\| AC-03-\d{2} \|.*(?:\bpendiente\b|por precisar)/m);
  const tasks = await readFile(new URL('../specs/003-eventos-rpc/tasks.md', import.meta.url), 'utf8');
  assert.equal([...tasks.matchAll(/^- \[ \] T\d{3}/gm)].length, 53, 'conservar las casillas históricas');
});
