import test from 'node:test';
import assert from 'node:assert/strict';
import { makeStoreFixture } from './helpers/store.mjs';
import { createQueryService } from '../src/application/query.ts';
import { createResultService } from '../src/application/result.ts';
import { createReviewService } from '../src/application/review.ts';

const job = (id, overrides = {}) => ({
  id,
  status: 'completed',
  task: `task-${id}`,
  cwd: '/tmp/project',
  createdAt: 1000,
  updatedAt: 1010,
  finishedAt: 1010,
  agent: { name: 'agent-a', description: 'Agent A', systemPrompt: 'prompt', source: 'personal', filePath: '/tmp/a.md', tools: [] },
  model: { provider: 'faux', modelId: 'faux-1' },
  thinkingLevel: 'off',
  notified: false,
  resultMeta: { durationMs: 10, model: { provider: 'faux', modelId: 'faux-1' }, status: 'completed' },
  ...overrides,
});
const result = { finalResponse: 'resultado completo', durationMs: 10, model: { provider: 'faux', modelId: 'faux-1' }, status: 'completed' };
const pendingReview = { status: 'pending' };

async function seedReview(fixture, id, review) {
  await fixture.session.commit(async tx => {
    const document = await tx.doc((await import('../src/infrastructure/durable/documents.ts')).JobReviewDocFamily, id, review);
    Object.assign(document, review);
  }, (await import('@earendil-works/chord/context')).BACKGROUND_CONTEXT);
}

async function setup(review = pendingReview) {
  const fixture = await makeStoreFixture();
  await fixture.seedJob(job('job-review'), result);
  await seedReview(fixture, 'job-review', review);
  const query = createQueryService(fixture.repository);
  return { fixture, query, resultService: createResultService(fixture.repository, query), reviewService: createReviewService(fixture.repository, () => 2000) };
}

test('bloquea tool pending/rejected pero permite peek humano y no consume', async () => {
  const current = await setup();
  try {
    const tool = await current.resultService.getResult('job-review', { mode: 'tool', operation: 'peek', actor: { kind: 'model', id: 'm' } });
    assert.equal(tool.success, false);
    assert.equal(tool.error.code, 'RESULT_REVIEW_REQUIRED');
    const human = await current.resultService.getResult('job-review', { mode: 'human', operation: 'peek', actor: { kind: 'human', id: 'u' } });
    assert.equal(human.success, true);
    assert.equal(human.value.result.finalResponse, 'resultado completo');
    assert.equal((await current.fixture.repository.consumption('job-review')), undefined);
    await current.reviewService.decideReview('job-review', { requestId: 'review-reject', status: 'rejected', actor: { kind: 'human', id: 'u' }, reason: 'no' });
    const rejected = await current.resultService.getResult('job-review', { mode: 'tool', operation: 'peek', actor: { kind: 'model', id: 'm' } });
    assert.equal(rejected.success, false);
    assert.equal(rejected.error.code, 'RESULT_REJECTED');
  } finally { await current.fixture.close(); }
});

test('aprueba y consume con replay idempotente y consumidores distintos', async () => {
  const current = await setup();
  try {
    const nonHuman = await current.reviewService.decideReview('job-review', { requestId: 'review-human-required', status: 'approved', actor: { kind: 'model', id: 'm' } });
    assert.equal(nonHuman.success, false);
    assert.equal(nonHuman.error.code, 'INVALID_REQUEST');
    const approved = await current.reviewService.decideReview('job-review', { requestId: 'review-approve', status: 'approved', actor: { kind: 'human', id: 'u' }, reason: 'verified' });
    assert.equal(approved.success, true);
    const first = await current.resultService.consumeResult('job-review', { requestId: 'consume-1', actor: { kind: 'model', id: 'm' }, consumer: 'model:m' });
    assert.equal(first.success, true);
    assert.equal(first.value.count, 1);
    const replay = await current.resultService.consumeResult('job-review', { requestId: 'consume-1', actor: { kind: 'model', id: 'm' }, consumer: 'model:m' });
    assert.deepEqual(replay, first);
    const second = await current.resultService.consumeResult('job-review', { requestId: 'consume-2', actor: { kind: 'extension', id: 'e' }, consumer: 'extension:e' });
    assert.equal(second.value.count, 2);
    const conflict = await current.resultService.consumeResult('job-review', { requestId: 'consume-1', actor: { kind: 'extension', id: 'other' }, consumer: 'extension:other' });
    assert.equal(conflict.success, false);
    assert.equal(conflict.error.code, 'REQUEST_ID_CONFLICT');
    for (let index = 0; index < 35; index++) await current.resultService.consumeResult('job-review', { requestId: `consume-${index + 3}`, actor: { kind: 'model', id: 'm' }, consumer: 'model:m' });
    const state = await current.fixture.repository.consumption('job-review');
    assert.equal(state.count, 37);
    assert.equal(state.requestIds.length, 32);
    await current.fixture.reopen();
    const reopened = createResultService(current.fixture.repository, createQueryService(current.fixture.repository));
    assert.equal((await reopened.getResult('job-review', { mode: 'tool', operation: 'peek', actor: { kind: 'model', id: 'm' } })).success, true);
    assert.equal((await current.fixture.repository.consumption('job-review')).count, 37);
  } finally { await current.fixture.close(); }
});

test('review sin razón aprueba/rechaza con replay persistido, conflictos y autoridad humana', async () => {
  for (const status of ['approved', 'rejected']) for (const optional of [{}, { reason: undefined }]) {
    const current = await setup();
    try {
      const request = { requestId: 'optional-review', status, actor: { kind: 'human' }, ...optional };
      const denied = await current.reviewService.decideReview('job-review', { ...request, actor: { kind: 'model', id: 'm' } });
      assert.equal(denied.success, false); assert.equal(denied.error.code, 'INVALID_REQUEST');
      assert.equal((await current.fixture.repository.review('job-review')).status, 'pending');
      const first = await current.reviewService.decideReview('job-review', request);
      assert.equal(first.success, true, JSON.stringify(first)); assert.equal(first.value.status, status);
      assert.equal(first.value.reason, undefined); assert.equal(first.value.decidedBy, undefined);
      const replay = await current.reviewService.decideReview('job-review', { ...request, reason: undefined });
      assert.deepEqual(replay, first);
      await current.fixture.reopen();
      const reviews = createReviewService(current.fixture.repository, () => 3000);
      assert.deepEqual(await reviews.decideReview('job-review', request), first);
      const stored = await current.fixture.repository.review('job-review');
      assert.equal(stored.status, status); assert.equal(stored.reason, undefined);
      const changed = await reviews.decideReview('job-review', { ...request, reason: 'changed payload' });
      assert.equal(changed.success, false); assert.equal(changed.error.code, 'REQUEST_ID_CONFLICT');
      assert.equal((await current.fixture.repository.review('job-review')).status, status);
      const results = createResultService(current.fixture.repository, createQueryService(current.fixture.repository));
      const access = await results.getResult('job-review', { mode: 'tool', operation: 'peek', actor: { kind: 'model', id: 'm' } });
      if (status === 'approved') { assert.equal(access.success, true); assert.equal(access.value.result.finalResponse, 'resultado completo'); }
      else { assert.equal(access.success, false); assert.equal(access.error.code, 'RESULT_REJECTED'); }
      assert.equal(await current.fixture.repository.consumption('job-review'), undefined);
    } finally { await current.fixture.close(); }
  }
});

test('omitir reason elimina la razón anterior sin relajar canonicalJson', async () => {
  const current = await setup();
  try {
    const request = { requestId: 'reason-first', status: 'approved', actor: { kind: 'human', id: 'u' }, reason: 'previous reason' };
    assert.equal((await current.reviewService.decideReview('job-review', request)).success, true);
    const next = { requestId: 'reason-next', status: 'rejected', actor: request.actor };
    const rejected = await current.reviewService.decideReview('job-review', next);
    assert.equal(rejected.success, true, JSON.stringify(rejected));
    await current.fixture.reopen();
    const stored = await current.fixture.repository.review('job-review');
    assert.equal(stored.status, 'rejected'); assert.equal(stored.reason, undefined);
    const reviews = createReviewService(current.fixture.repository, () => 3000);
    const invalid = await reviews.decideReview('job-review', { ...next, requestId: 'invalid-reason', reason: () => {} });
    assert.equal(invalid.success, false); assert.equal(invalid.error.code, 'INVALID_REQUEST');
    assert.equal((await current.fixture.repository.review('job-review')).status, 'rejected');
  } finally { await current.fixture.close(); }
});

test('la admisión de un actor model crea revisión pending', async () => {
  const fixture = await makeStoreFixture({ createId: () => 'admitted-model' });
  try {
    const receipt = await fixture.repository.admit({ requestId: 'start-model', actor: { kind: 'model', id: 'm' }, intent: { agent: 'agent-a', task: 'task', cwd: '/tmp/project' }, payloadHash: 'hash' }, {
      task: 'task', cwd: '/tmp/project', agent: { name: 'agent-a', description: 'A', systemPrompt: 'p', source: 'personal', filePath: '/tmp/a', tools: [] }, model: { provider: 'faux', modelId: 'faux-1' }, thinkingLevel: 'off',
    });
    assert.equal(receipt.jobId, 'admitted-model');
    assert.equal((await fixture.repository.review(receipt.jobId)).status, 'pending');
  } finally { await fixture.close(); }
});

test('replay de consume vuelve a comprobar revisión y no aumenta consumo tras rechazo', async () => {
  const current = await setup({ status: 'approved' });
  try {
    const first = await current.resultService.consumeResult('job-review', { requestId: 'consume-revision', actor: { kind: 'model', id: 'm' }, consumer: 'model:m' });
    assert.equal(first.success, true);
    await current.reviewService.decideReview('job-review', { requestId: 'review-reject-after-consume', status: 'rejected', actor: { kind: 'human', id: 'u' }, reason: 'changed' });
    const replay = await current.resultService.consumeResult('job-review', { requestId: 'consume-revision', actor: { kind: 'model', id: 'm' }, consumer: 'model:m' });
    assert.equal(replay.success, false);
    assert.equal(replay.error.code, 'RESULT_REJECTED');
    assert.equal((await current.fixture.repository.consumption('job-review')).count, 1);
  } finally { await current.fixture.close(); }
});

test('consume también bloquea una revisión pending sin crear consumo', async () => {
  const current = await setup({ status: 'pending' });
  try {
    const denied = await current.resultService.consumeResult('job-review', { requestId: 'consume-pending', actor: { kind: 'model', id: 'm' }, consumer: 'model:m' });
    assert.equal(denied.success, false);
    assert.equal(denied.error.code, 'RESULT_REVIEW_REQUIRED');
    assert.equal(await current.fixture.repository.consumption('job-review'), undefined);
  } finally { await current.fixture.close(); }
});

test('peek usa la lectura autorizada y no consulta jobs.result sin revisión coherente', async () => {
  const fixture = await makeStoreFixture();
  try {
    await fixture.seedJob(job('job-coherent'), result);
    await seedReview(fixture, 'job-coherent', { status: 'approved' });
    const repository = { ...fixture.repository, result: async () => { throw new Error('unrestricted result read'); } };
    const query = createQueryService(repository);
    const results = createResultService(repository, query);
    const peek = await results.getResult('job-coherent', { mode: 'tool', operation: 'peek', actor: { kind: 'model', id: 'm' } });
    assert.equal(peek.success, true);
    assert.equal(peek.value.result.finalResponse, 'resultado completo');
  } finally { await fixture.close(); }
});

test('resultado ausente o no terminal no se puede recuperar', async () => {
  const fixture = await makeStoreFixture();
  try {
    const queued = job('queued', { status: 'queued' });
    delete queued.resultMeta;
    delete queued.finishedAt;
    await fixture.seedJob(queued, undefined);
    const service = createResultService(fixture.repository, createQueryService(fixture.repository));
    const missing = await service.getResult('queued', { mode: 'human', operation: 'peek', actor: { kind: 'human' } });
    assert.equal(missing.success, false);
    assert.equal(missing.error.code, 'RESULT_NOT_READY');
  } finally { await fixture.close(); }
});
