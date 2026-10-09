import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRpcFixture, observeRpc, rpcRequest } from './helpers/rpc.mjs';

const call = async (fixture, operation, request) => observeRpc(fixture, operation, request).response;
const eventCount = async (fixture, type) => (await fixture.store.outbox.pending(100)).filter(event => event.type === type).length;

test('control exige propiedad extension y mapea el conflicto de requestId', async t => {
  const fixture = await makeRpcFixture(); t.after(() => fixture.close());
  await fixture.seedJob('foreign-job', { createdBy: { kind: 'extension', id: 'other-extension' } });
  const unauthorized = await call(fixture, 'control', rpcRequest('control', { id: 'foreign-job', action: 'pause' }));
  assert.equal(unauthorized.success, false);
  assert.equal(unauthorized.error.code, 'CONTROL_NOT_AUTHORIZED');
  assert.equal(await eventCount(fixture, 'job.paused'), 0);

  await fixture.seedJob('owned-job');
  const first = await call(fixture, 'control', rpcRequest('control', { id: 'owned-job', action: 'pause' }, { requestId: 'same-intent', correlationId: 'first-attempt' }));
  assert.equal(first.success, true);
  const conflict = await call(fixture, 'control', rpcRequest('control', { id: 'owned-job', action: 'resume' }, { requestId: 'same-intent', correlationId: 'different-intent' }));
  assert.equal(conflict.success, false);
  assert.equal(conflict.error.code, 'REQUEST_ID_CONFLICT');
  assert.equal(await eventCount(fixture, 'job.paused'), 1);
});

test('replay de control tras reopen conserva recibo y evento originales', async t => {
  const fixture = await makeRpcFixture(); t.after(() => fixture.close());
  await fixture.seedJob('replay-job');
  const intent = { id: 'replay-job', action: 'pause', reason: 'r'.repeat(2048) };
  const first = await call(fixture, 'control', rpcRequest('control', intent, { requestId: 'pause-once', correlationId: 'corr-first' }));
  assert.equal(first.success, true);
  await fixture.reopen();
  const replay = await call(fixture, 'control', rpcRequest('control', intent, { requestId: 'pause-once', correlationId: 'corr-replay' }));
  assert.equal(replay.success, true);
  assert.equal(replay.data.replayed, true);
  assert.equal(replay.data.status, 'paused');
  assert.equal(await eventCount(fixture, 'job.paused'), 1);
  const tooLong = await call(fixture, 'control', rpcRequest('control', { id: 'replay-job', action: 'resume', reason: 'x'.repeat(2049) }, { requestId: 'bad-reason', correlationId: 'bad-reason' }));
  assert.equal(tooLong.success, false);
  assert.equal(tooLong.error.code, 'INVALID_REQUEST');
});

test('cancelación activa conserva actor extension y requiere confirmación TUI una sola vez', async t => {
  const confirmations = [];
  const fixture = await makeRpcFixture({ confirm: async (id) => { confirmations.push(id); return true; } }); t.after(() => fixture.close());
  await fixture.seedJob('active-job', { status: 'running', startedAt: 1000, submissionId: 7 });
  const intent = { id: 'active-job', action: 'cancel' };
  const first = await call(fixture, 'control', rpcRequest('control', intent, { requestId: 'cancel-active', correlationId: 'cancel-first' }));
  assert.equal(first.success, true);
  assert.equal(first.data.status, 'cancelling');
  assert.deepEqual(confirmations, ['active-job']);
  const stored = await fixture.store.repository.get('active-job');
  assert.deepEqual(stored.control.pending === 'cancel' ? stored.control.requestedBy : undefined, { kind: 'extension', id: 'trusted-extension' });
  const replay = await call(fixture, 'control', rpcRequest('control', intent, { requestId: 'cancel-active', correlationId: 'cancel-replay' }));
  assert.equal(replay.success, true);
  assert.equal(replay.data.replayed, true);
  assert.deepEqual(confirmations, ['active-job']);
  assert.equal(await eventCount(fixture, 'job.cancel-requested'), 1);
});

test('cancelación activa sin TUI o consentimiento no crea intención', async t => {
  let confirmations = 0;
  const fixture = await makeRpcFixture({ mode: 'rpc', hasUI: false, confirm: async () => { confirmations++; return true; } }); t.after(() => fixture.close());
  await fixture.seedJob('active-job', { status: 'running', startedAt: 1000, submissionId: 8 });
  const response = await call(fixture, 'control', rpcRequest('control', { id: 'active-job', action: 'cancel' }));
  assert.equal(response.success, false);
  assert.equal(response.error.code, 'CAPABILITY_UNAVAILABLE');
  assert.equal(confirmations, 0);
  assert.equal(await eventCount(fixture, 'job.cancel-requested'), 0);
  assert.equal((await fixture.store.repository.get('active-job')).status, 'running');
});

test('consentimiento TUI denegado no crea intención durable', async t => {
  const fixture = await makeRpcFixture({ confirm: async () => false }); t.after(() => fixture.close());
  await fixture.seedJob('denied-active', { status: 'running', startedAt: 1000, submissionId: 10 });
  const response = await call(fixture, 'control', rpcRequest('control', { id: 'denied-active', action: 'cancel' }));
  assert.equal(response.error.code, 'CAPABILITY_UNAVAILABLE');
  assert.equal(await eventCount(fixture, 'job.cancel-requested'), 0);
  assert.equal((await fixture.store.repository.get('denied-active')).status, 'running');
});

test('carrera queued→provisioning solicita consentimiento y reintenta la misma intención', async t => {
  const confirmations = [];
  const fixture = await makeRpcFixture({ confirm: async id => { confirmations.push(id); return true; } }); t.after(() => fixture.close());
  await fixture.seedJob('racing-job');
  const originalControl = fixture.jobs.control.bind(fixture.jobs);
  let raced = false;
  fixture.setJobs({ control: async (...args) => {
    if (!raced) { raced = true; await fixture.store.repository.claimNext(1, async () => 17); }
    return originalControl(...args);
  } });
  const response = await call(fixture, 'control', rpcRequest('control', { id: 'racing-job', action: 'cancel' }, { requestId: 'race-cancel', correlationId: 'race-corr' }));
  assert.equal(response.success, true);
  assert.equal(response.data.status, 'cancelling');
  assert.deepEqual(confirmations, ['racing-job']);
  const job = await fixture.store.repository.get('racing-job');
  assert.deepEqual(job.control.requestedBy, { kind: 'extension', id: 'trusted-extension' });
  assert.equal(await eventCount(fixture, 'job.cancel-requested'), 1);
});

test('result pending o rejected no se revela y consume replay tras reopen no duplica evento', async t => {
  const fixture = await makeRpcFixture(); t.after(() => fixture.close());
  await fixture.seedJob('pending-result', { status: 'completed', finishedAt: 1010, resultMeta: { durationMs: 10, model: { provider: 'faux', modelId: 'faux-1' }, status: 'completed' } }, true);
  await fixture.seedReview('pending-result', 'pending');
  const hidden = await call(fixture, 'result', rpcRequest('result', { id: 'pending-result', operation: 'peek' }));
  assert.equal(hidden.success, false);
  assert.equal(hidden.error.code, 'RESULT_REVIEW_REQUIRED');
  assert.equal(JSON.stringify(hidden).includes('resulto completo'), false);
  await fixture.seedReview('pending-result', 'rejected');
  const rejected = await call(fixture, 'result', rpcRequest('result', { id: 'pending-result', operation: 'peek' }, { correlationId: 'rejected-result' }));
  assert.equal(rejected.error.code, 'RESULT_REJECTED');
  assert.equal(JSON.stringify(rejected).includes('resulto completo'), false);
  await fixture.seedReview('pending-result', 'approved');
  const request = () => rpcRequest('result', { id: 'pending-result', operation: 'consume' }, { requestId: 'consume-once', correlationId: 'consume-corr-1' });
  const consumed = await call(fixture, 'result', request());
  assert.equal(consumed.success, true);
  assert.equal((await fixture.store.repository.consumption('pending-result')).count, 1);
  await fixture.reopen();
  const replay = await call(fixture, 'result', rpcRequest('result', { id: 'pending-result', operation: 'consume' }, { requestId: 'consume-once', correlationId: 'consume-corr-2' }));
  assert.equal(replay.success, true);
  assert.equal((await fixture.store.repository.consumption('pending-result')).count, 1);
  assert.equal(await eventCount(fixture, 'job.consumed'), 1);
});

test('retry usa el servicio real y su replay conserva la única admisión durable', async t => {
  const fixture = await makeRpcFixture(); t.after(() => fixture.close());
  await fixture.seedJob('terminal-job', { status: 'completed', finishedAt: 1010, resultMeta: { durationMs: 10, model: { provider: 'faux', modelId: 'faux-1' }, status: 'completed' } }, true);
  const first = await call(fixture, 'control', rpcRequest('control', { id: 'terminal-job', action: 'retry' }, { requestId: 'retry-once', correlationId: 'retry-first' }));
  assert.equal(first.success, true);
  assert.equal(first.data.status, 'queued');
  assert.equal(first.data.retryOf, 'terminal-job');
  await fixture.reopen();
  const replay = await call(fixture, 'control', rpcRequest('control', { id: 'terminal-job', action: 'retry' }, { requestId: 'retry-once', correlationId: 'retry-again' }));
  assert.equal(replay.success, true);
  assert.equal(replay.data.replayed, true);
  assert.equal(await eventCount(fixture, 'job.queued'), 1);
});

test('timeout después del commit devuelve una sola respuesta y el replay no duplica consume', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { makeFakeTimers } = await import('./helpers/rpc.mjs');
  const timers = makeFakeTimers();
  const fixture = await makeRpcFixture({ timers: timers.api }); t.after(() => fixture.close());
  await fixture.seedJob('consume-timeout', { status: 'completed', finishedAt: 1010, resultMeta: { durationMs: 10, model: { provider: 'faux', modelId: 'faux-1' }, status: 'completed' } }, true);
  await fixture.seedReview('consume-timeout', 'approved');
  const original = fixture.jobs.getResult.bind(fixture.jobs);
  fixture.setJobs({ getResult: async (...args) => { const value = await original(...args); await gate; return value; } });
  const request = rpcRequest('result', { id: 'consume-timeout', operation: 'consume' }, { requestId: 'consume-timeout-id', correlationId: 'consume-timeout-first' });
  const attempt = observeRpc(fixture, 'result', request);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await fixture.store.repository.consumption('consume-timeout')).count, 1);
  timers.advance(30000);
  assert.equal((await attempt.response).error.code, 'RPC_TIMEOUT');
  release();
  await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
  assert.equal(attempt.replies.length, 1);
  fixture.setJobs({ getResult: original });
  const replay = await call(fixture, 'result', rpcRequest('result', { id: 'consume-timeout', operation: 'consume' }, { requestId: 'consume-timeout-id', correlationId: 'consume-timeout-replay' }));
  assert.equal(replay.success, true);
  assert.equal(replay.data.job.id, 'consume-timeout');
  assert.equal((await fixture.store.repository.consumption('consume-timeout')).count, 1);
  assert.equal(await eventCount(fixture, 'job.consumed'), 1);
});

test('confirmación que cruza de generación no admite control ni publica tarde', async t => {
  let approve;
  let started;
  const waiting = new Promise(resolve => { approve = resolve; });
  const begun = new Promise(resolve => { started = resolve; });
  const fixture = await makeRpcFixture({ confirm: async () => { started(); return waiting; } }); t.after(() => fixture.close());
  await fixture.seedJob('generation-active', { status: 'running', startedAt: 1000, submissionId: 11 });
  const attempt = observeRpc(fixture, 'control', rpcRequest('control', { id: 'generation-active', action: 'cancel' }));
  await begun;
  fixture.generation.seal();
  approve(true);
  await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
  assert.equal(attempt.replies.length, 0);
  assert.equal(await eventCount(fixture, 'job.cancel-requested'), 0);
  assert.equal((await fixture.store.repository.get('generation-active')).status, 'running');
});

test('timeout de confirmación ignora consentimiento tardío y no admite control', async t => {
  let approve;
  const confirmation = new Promise(resolve => { approve = resolve; });
  const { makeFakeTimers } = await import('./helpers/rpc.mjs');
  const timers = makeFakeTimers();
  const fixture = await makeRpcFixture({ confirm: () => confirmation, timers: timers.api }); t.after(() => fixture.close());
  await fixture.seedJob('active-job', { status: 'running', startedAt: 1000, submissionId: 9 });
  const request = rpcRequest('control', { id: 'active-job', action: 'cancel' }, { requestId: 'late-confirm', correlationId: 'late-confirm' });
  const attempt = observeRpc(fixture, 'control', request);
  timers.advance(30000);
  assert.equal((await attempt.response).error.code, 'RPC_TIMEOUT');
  approve(true);
  await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
  assert.equal(attempt.replies.length, 1);
  assert.equal(await eventCount(fixture, 'job.cancel-requested'), 0);
});
