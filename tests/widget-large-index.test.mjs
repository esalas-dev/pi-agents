import test from 'node:test';
import assert from 'node:assert/strict';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { makeStoreFixture } from './helpers/store.mjs';
import { JobsIndexDoc, JobDocFamily, JobResultDocFamily, StorageMetaDoc } from '../src/infrastructure/durable/documents.ts';
import { createQueryService } from '../src/application/query.ts';
import { createSubagentsWidget } from '../src/adapters/pi/subagents-widget.ts';

// Captura una regresión que expandiese todo el índice o leyese resultados para renderizar.
test('widget con 2000 summaries recorre el índice pero materializa solo dos páginas sin leer resultados voluminosos', { timeout: 30000 }, async t => {
  const f = await makeStoreFixture(); let widget;
  t.after(async () => { await widget?.close(); await f.close(); });
  await f.session.commit(async tx => {
    const meta = await tx.doc(StorageMetaDoc); meta.storageSchemaVersion = 5;
    const index = await tx.doc(JobsIndexDoc); index.storageSchemaVersion = 5;
    for (let i = 0; i < 2000; i++) {
      const id = `job-${String(i).padStart(4, '0')}`;
      const status = i < 10 ? 'running' : i < 20 ? 'queued' : 'completed';
      const record = { id, status, task: 'PRIVATE_TASK_SENTINEL', cwd: '/PRIVATE_CWD_SENTINEL', createdAt: i, updatedAt: i,
        agent: { name: 'worker', description: 'PRIVATE_DESCRIPTION_SENTINEL', systemPrompt: 'PRIVATE_PROMPT_SENTINEL', source: 'personal', filePath: '/PRIVATE_AGENT_SENTINEL', tools: [] },
        model: { provider: 'faux', modelId: 'faux-1' }, thinkingLevel: 'off', notified: false,
        ...(status === 'running' ? { startedAt: 1 } : {}) };
      Object.assign(await tx.doc(JobDocFamily, id, record), record);
      index.summaries[id] = { id, status, agent: 'worker', createdAt: i, updatedAt: i, hasResult: i >= 1998, notified: false };
      if (status === 'queued') index.order.push(id);
      if (i >= 1998) {
        const result = { finalResponse: `PRIVATE_RESULT_SENTINEL${'x'.repeat(1024 * 1024)}`, durationMs: 1, model: record.model, status: 'completed' };
        Object.assign(await tx.doc(JobResultDocFamily, id, result), result);
      }
    }
  }, context);
  await f.reopen(); f.readKinds.length = 0;
  const calls = {}; let summaryVisits = 0;
  const repository = new Proxy(f.repository, { get(target, key) {
    const value = target[key];
    if (typeof value !== 'function') return value;
    return async (...args) => {
      (calls[key] ??= []).push(args);
      const result = await value.apply(target, args);
      if (key !== 'index') return result;
      return { ...result, summaries: new Proxy(result.summaries, { get(summaries, id) { summaryVisits++; return summaries[id]; } }) };
    };
  } });
  const query = createQueryService(repository); const filters = []; const pages = [];
  const mounted = Promise.withResolvers(); let renders = 0;
  widget = createSubagentsWidget({ jobs: { async listJobs(filter) { filters.push(filter); const page = await query.listJobs(filter); pages.push(page); return page; } },
    ui: { setWidget(_key, factory) { if (factory) mounted.resolve(factory({ requestRender() { renders++; } }, { fg: (_color, text) => text, bold: text => text })); } } });
  widget.start(); const component = await mounted.promise;
  try {
    const text = component.render(120).join('\n');
    assert.deepEqual(filters, [{ statuses: ['running', 'cancelling'], limit: 5 }, { statuses: ['queued', 'paused'], limit: 5 }]);
    assert.ok(pages.every(page => page.success && page.value.items.length === 5 && page.value.nextCursor));
    assert.deepEqual(calls.get.map(([id]) => id), ['job-0009', 'job-0008', 'job-0007', 'job-0006', 'job-0005', 'job-0019', 'job-0018', 'job-0017', 'job-0016', 'job-0015']);
    assert.ok(calls.index.length <= 2); assert.ok(summaryVisits <= 4000, 'no más de un recorrido por listado');
    assert.equal(calls.result, undefined); assert.equal(f.readKinds.includes('pi-agents.job-result'), false);
    assert.match(text, /4 visibles/); assert.match(text, /Hay más trabajos/);
    for (const id of ['job-0009', 'job-0008', 'job-0007', 'job-0006']) assert.match(text, new RegExp(id));
    assert.doesNotMatch(text, /job-0005|job-0019|PRIVATE_/);
    assert.ok(text.split('\n').length <= 6);
    const expanded = calls.get.length, visits = summaryVisits, renderCount = renders;
    for (let i = 0; i < 20; i++) component.render(80);
    assert.equal(calls.get.length, expanded); assert.equal(summaryVisits, visits); assert.equal(renders, renderCount);
    console.log(`Índice widget: 2000 summaries, ${summaryVisits} visitas en ${filters.length} listados, ${calls.get.length} jobs expandidos, 0 lecturas de resultados; 2 cuerpos de >1 MiB en SQLite.`);
  } finally { await widget.close(); }
});
