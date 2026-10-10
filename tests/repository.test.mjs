import test from 'node:test';
import assert from 'node:assert/strict';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { makeStoreFixture } from './helpers/store.mjs';

function job(id, status = 'queued') {
  return {
    id, status, task: 'tarea', cwd: process.cwd(), createdAt: 1000, updatedAt: 1000,
    agent: { name: 'agent', description: 'd', systemPrompt: 's', source: 'personal', filePath: '/tmp/a', tools: [] },
    model: { provider: 'faux', modelId: 'faux-1' }, thinkingLevel: 'off', notified: false,
    ...(status === 'provisioning' || status === 'running' ? { conversationId: 1 } : {}),
    ...(status === 'running' ? { submissionId: 2, startedAt: 1001 } : {}),
    ...(status === 'completed' ? { finishedAt: 1002 } : {}),
  };
}
function result(text = 'done', status = 'completed') { return { finalResponse: text, durationMs: 1, model: { provider: 'faux', modelId: 'faux-1' }, status }; }

for (const id of ['__proto__', 'constructor']) test(`almacena IDs de datos sin contaminar diccionarios: ${id}`, async () => {
  const f = await makeStoreFixture();
  try { await f.seedJob(job(id)); assert.equal((await f.repository.get(id)).id, id); assert.equal(await f.repository.queuedPosition(id), 1); }
  finally { await f.close(); }
});

test('consulta estado sin leer cuerpo de resultado grande y resultado lo recupera', async () => {
  const f = await makeStoreFixture();
  try {
    const large = result('x'.repeat(1024 * 1024));
    await f.seedJob({ ...job('done'), status: 'completed', result: large, finishedAt: 1002 }, large);
    await f.reopen(); f.readKinds.length = 0;
    const view = await f.repository.get('done');
    assert.equal(view.result, undefined);
    assert.ok(!f.readKinds.includes('pi-agents.job-result'));
    const body = await f.repository.result('done');
    assert.equal(body.finalResponse.length, 1024 * 1024);
    assert.equal(await f.repository.get('missing'), undefined);
    assert.equal(await f.repository.result('missing'), undefined);
  } finally { await f.close(); }
});

test('finalización y notificación son condicionales e idempotentes', async () => {
  const f = await makeStoreFixture();
  try {
    await f.seedJob({ ...job('active'), status: 'running' });
    await f.repository.finish('active', result(), 2001);
    await f.repository.finish('active', result('different'), 2002);
    assert.equal((await f.repository.result('active')).finalResponse, 'done');
    await f.repository.markNotified('active');
    const first = await f.repository.get('active');
    await f.repository.markNotified('active');
    const second = await f.repository.get('active');
    assert.deepEqual(second, first);
  } finally { await f.close(); }
});

test('claimNext comprueba concurrencia y configura conversación dentro del commit', async () => {
  const f = await makeStoreFixture();
  try {
    await f.seedJob(job('one')); await f.seedJob(job('two'));
    const calls = [];
    const claimed = await f.repository.claimNext(1, async (tx, selected) => { calls.push(selected.id); return 10; });
    assert.equal(claimed.id, 'one'); assert.deepEqual(calls, ['one']);
    assert.equal((await f.repository.get('one')).status, 'provisioning');
    assert.equal(await f.repository.queuedPosition('two'), 1);
    assert.equal((await f.repository.claimNext(1, async () => 11)), undefined);
    await f.reopen(); assert.equal((await f.repository.get('one')).conversationId, 10);
  } finally { await f.close(); }
});

test('seal del repositorio rechaza commits nuevos antes de llegar a la sesión', async () => {
  const f = await makeStoreFixture();
  try {
    f.repository.seal();
    await assert.rejects(f.repository.markNotified('missing'), error => error?.error?.code === 'RUNTIME_CLOSING');
    assert.equal(await f.repository.get('missing'), undefined);
  } finally { await f.close(); }
});

test('fallo al crear conversación no publica transición ni consume cola', async () => {
  const f = await makeStoreFixture();
  try {
    await f.seedJob(job('one'));
    await assert.rejects(f.repository.claimNext(1, async () => { throw new Error('create failed'); }), /create failed/);
    assert.equal((await f.repository.get('one')).status, 'queued');
    assert.equal(await f.repository.queuedPosition('one'), 1);
  } finally { await f.close(); }
});
