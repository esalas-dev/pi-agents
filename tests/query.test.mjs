import test from 'node:test';
import assert from 'node:assert/strict';
import { makeStoreFixture } from './helpers/store.mjs';
import { createQueryService } from '../src/application/query.ts';

const job = (id, overrides = {}) => ({
  id,
  status: 'queued',
  task: `task-${id}`,
  cwd: '/tmp/project',
  createdAt: 1000,
  updatedAt: 1000,
  agent: { name: 'agent-a', description: 'Agent A', systemPrompt: 'prompt', source: 'personal', filePath: '/tmp/a.md', tools: [] },
  model: { provider: 'faux', modelId: 'faux-1' },
  thinkingLevel: 'off',
  notified: false,
  ...overrides,
});

const result = id => ({ finalResponse: 'x'.repeat(70_000), durationMs: 10, model: { provider: 'faux', modelId: 'faux-1' }, status: 'completed' });

test('lista por cursor estable cuando createdAt se repite y no lee resultados', async () => {
  const fixture = await makeStoreFixture();
  try {
    await fixture.seedJob(job('job-a', { createdAt: 1000 }), result('job-a'));
    await fixture.seedJob(job('job-b', { createdAt: 1000 }), result('job-b'));
    await fixture.seedJob(job('job-c', { createdAt: 999, status: 'completed' }), result('job-c'));
    const query = createQueryService(fixture.repository);
    const first = await query.listJobs({ limit: 2 });
    assert.equal(first.success, true);
    assert.deepEqual(first.value.items.map(item => item.id), ['job-b', 'job-a']);
    assert.ok(first.value.nextCursor);
    const second = await query.listJobs({ limit: 2, cursor: first.value.nextCursor });
    assert.deepEqual(second.value.items.map(item => item.id), ['job-c']);
    assert.equal(second.value.nextCursor, undefined);
    assert.equal(fixture.readKinds.includes('pi-agents.job-result'), false);
  } finally { await fixture.close(); }
});

test('getJob combina metadatos sin materializar el cuerpo del resultado', async () => {
  const fixture = await makeStoreFixture();
  try {
    await fixture.seedJob(job('job-q', { status: 'completed', finishedAt: 1010, resultMeta: { durationMs: 10, model: { provider: 'faux', modelId: 'faux-1' }, status: 'completed' } }), result('job-q'));
    const query = createQueryService(fixture.repository);
    const view = await query.getJob('job-q');
    assert.equal(view.success, true);
    assert.equal(view.value.task, 'task-job-q');
    assert.equal(view.value.hasResult, true);
    assert.equal(view.value.result, undefined);
    assert.equal(view.value.resultMeta.durationMs, 10);
    const compact = await query.getJob('job-q', { includeTask: false });
    assert.equal(compact.value.task, undefined);
  } finally { await fixture.close(); }
});

test('rechaza cursor alterado y aplica filtros combinados', async () => {
  const fixture = await makeStoreFixture();
  try {
    await fixture.seedJob(job('job-running', { status: 'running', createdAt: 1002, agent: { ...job('x').agent, name: 'agent-b' } }));
    await fixture.seedJob(job('job-failed', { status: 'failed', createdAt: 1001 }), result('job-failed'));
    const query = createQueryService(fixture.repository);
    const listed = await query.listJobs({ statuses: ['running'], agent: 'agent-b', createdAfter: 1000, createdBefore: 1003, limit: 100 });
    assert.deepEqual(listed.value.items.map(item => item.id), ['job-running']);
    const invalid = await query.listJobs({ cursor: 'not-a-cursor' });
    assert.equal(invalid.success, false);
    assert.equal(invalid.error.code, 'INVALID_FILTER');
  } finally { await fixture.close(); }
});
