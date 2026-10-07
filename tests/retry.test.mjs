import test from 'node:test';
import assert from 'node:assert/strict';
import { createControlService } from '../src/application/control.ts';
import { makeStoreFixture } from './helpers/store.mjs';
import { legacyInput } from './helpers/legacy.mjs';

const actor = { kind: 'human', id: 'tui' };
const request = (requestId) => ({ requestId, action: 'retry', actor });
const terminalJob = (id, status = 'completed', extra = {}) => ({ id, ...legacyInput(`tarea ${id}`), status, createdAt: 1000, updatedAt: 1000, notified: true, createdBy: actor, attemptNumber: 2, rootAttemptId: 'root-original', ...extra });
const result = { status: 'completed', finalResponse: 'resultado original', durationMs: 4, model: terminalJob('result').model };

async function controlError(service, id, requestId) {
  const outcome = await service.retry(id, request(requestId));
  assert.equal(outcome.success, false);
  return outcome.error.code;
}

test('retry crea un intento nuevo enlazado sin copiar resultado, consumo ni notificación', async () => {
  const ids = ['retry-1'];
  const fixture = await makeStoreFixture({ createId: () => ids.shift() });
  try {
    await fixture.seedJob(terminalJob('original'), result);
    const service = createControlService(fixture.repository, () => 2001);
    const outcome = await service.retry('original', request('retry:1'));
    assert.equal(outcome.success, true);
    assert.deepEqual(outcome.value, { jobId: 'retry-1', requestId: 'retry:1', action: 'retry', previousStatus: 'completed', status: 'queued', replayed: false, appliedAt: 2001, retryJobId: 'retry-1', retryOf: 'original', attemptNumber: 3 });
    const created = await fixture.repository.get('retry-1');
    assert.equal(created.status, 'queued');
    assert.equal(created.retryOf, 'original');
    assert.equal(created.rootAttemptId, 'root-original');
    assert.equal(created.attemptNumber, 3);
    assert.equal(created.notified, false);
    assert.equal(created.result, undefined);
    assert.equal((await fixture.repository.result('retry-1')), undefined);
    assert.equal((await fixture.repository.consumption('retry-1')), undefined);
    assert.equal((await fixture.repository.review('retry-1')).status, 'not_required');
    assert.equal((await fixture.repository.get('original')).result, undefined);
    assert.equal((await fixture.repository.result('original')).finalResponse, 'resultado original');
  } finally { await fixture.close(); }
});

test('retry acepta estados terminales, rechaza estados no terminales y repite por requestId', async () => {
  const ids = ['retry-completed', 'retry-failed', 'retry-interrupted', 'retry-cancelled'];
  const fixture = await makeStoreFixture({ createId: () => ids.shift() });
  try {
    for (const status of ['completed', 'failed', 'interrupted', 'cancelled']) await fixture.seedJob(terminalJob(`job-${status}`, status), result);
    const service = createControlService(fixture.repository, () => 2002);
    for (const status of ['completed', 'failed', 'interrupted', 'cancelled']) {
      const first = await service.retry(`job-${status}`, request(`retry:${status}`));
      assert.equal(first.success, true);
    }
    const replay = await service.retry('job-completed', request('retry:completed'));
    assert.equal(replay.value.replayed, true);
    for (const status of ['queued', 'paused', 'running']) {
      const id = `not-${status}`;
      await fixture.seedJob(terminalJob(id, status, status === 'running' ? { conversationId: 1, submissionId: 2 } : {}));
      assert.equal(await controlError(service, id, `retry:${status}`), 'RETRY_NOT_ALLOWED');
    }
  } finally { await fixture.close(); }
});
