import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { makeStoreFixture } from './helpers/store.mjs';
import { createQueryService } from '../src/application/query.ts';
import { createResultService } from '../src/application/result.ts';
import { createReviewService } from '../src/application/review.ts';
import { RequestLedgerDocFamily, JobReviewDocFamily, JobsIndexDoc } from '../src/infrastructure/durable/documents.ts';

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

async function setup(review = pendingReview, { parentAuthority, parentSessionId } = {}) {
  const fixture = await makeStoreFixture({ parentAuthority });
  await fixture.seedJob(job('job-review', parentSessionId === undefined ? {} : { parentSessionId }), result);
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

test('aprobación parental consume y rechazo humano bloquea replay del ledger antiguo', async () => {
  const parentAuthority = Object.freeze({ sessionId: 'parent-review-session', isActive: () => true });
  const current = await setup(pendingReview, { parentAuthority, parentSessionId: parentAuthority.sessionId });
  try {
    const approved = await current.reviewService.decideReview('job-review', { requestId: 'review-parent-approve', status: 'approved' }, parentAuthority);
    assert.equal(approved.success, true);
    assert.deepEqual(approved.value.decidedByActor, { kind: 'model', id: 'parent:parent-review-session' });
    assert.deepEqual((await current.fixture.repository.review('job-review')).decidedByActor, { kind: 'model', id: 'parent:parent-review-session' });

    const request = { requestId: 'consume-old', actor: { kind: 'model', id: 'm' }, consumer: 'model:m' };
    const first = await current.resultService.consumeResult('job-review', request);
    assert.equal(first.success, true);
    assert.equal(first.value.count, 1);
    assert.equal((await current.fixture.repository.receipt(request.requestId)).requestId, request.requestId);

    const rejected = await current.reviewService.decideReview('job-review', {
      requestId: 'review-human-reject',
      status: 'rejected',
      actor: { kind: 'human', id: 'u' },
    });
    assert.equal(rejected.success, true);
    assert.deepEqual(rejected.value.decidedByActor, { kind: 'human', id: 'u' });

    const beforeReplay = {
      review: await current.fixture.repository.review('job-review'),
      index: await current.fixture.repository.index(),
      consumption: await current.fixture.repository.consumption('job-review'),
      ledger: await current.fixture.repository.receipt(request.requestId),
    };
    const replay = await current.resultService.consumeResult('job-review', request);
    assert.equal(replay.success, false);
    assert.equal(replay.error.code, 'RESULT_REJECTED');
    assert.equal(Object.hasOwn(replay, 'value'), false);
    assert.deepEqual(await current.fixture.repository.review('job-review'), beforeReplay.review);
    assert.deepEqual(await current.fixture.repository.index(), beforeReplay.index);
    assert.deepEqual(await current.fixture.repository.consumption('job-review'), beforeReplay.consumption);
    assert.deepEqual(await current.fixture.repository.receipt(request.requestId), beforeReplay.ledger);
  } finally {
    await current.fixture.close();
  }
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

test('aprueba y rechaza sin motivo opcional con replay idempotente', async () => {
  for (const status of ['approved', 'rejected']) {
    const current = await setup();
    try {
      const decision = { requestId: `review-without-reason-${status}`, status, actor: { kind: 'human', id: 'tui' } };
      const first = await current.reviewService.decideReview('job-review', decision);
      assert.equal(first.success, true, first.error?.message);
      assert.equal(first.value.status, status);
      assert.equal(Object.hasOwn(first.value, 'reason'), false);
      assert.equal((await current.fixture.repository.review('job-review')).status, status);
      assert.deepEqual(await current.reviewService.decideReview('job-review', decision), first);
      await current.fixture.reopen();
      const reopened = createReviewService(current.fixture.repository, () => 3000);
      assert.deepEqual(await reopened.decideReview('job-review', decision), first);
    } finally { await current.fixture.close(); }
  }
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

test('replay de consume vuelve a comprobar review vigente sin incrementar consumo', async () => {
  for (const nextStatus of ['rejected', 'pending']) {
    const current = await setup();
    try {
      await current.reviewService.decideReview('job-review', { requestId: `review-approved-${nextStatus}`, status: 'approved', actor: { kind: 'human', id: 'u' } });
      const request = { requestId: `consume-replay-${nextStatus}`, actor: { kind: 'model', id: 'm' }, consumer: 'model:m' };
      const first = await current.resultService.consumeResult('job-review', request);
      assert.equal(first.success, true);
      if (nextStatus === 'pending') {
        // Pending is a persisted gate, not an allowed review decision.
        await current.fixture.session.commit(async tx => {
          const review = await tx.doc(JobReviewDocFamily, 'job-review', null); review.status = 'pending';
          const index = await tx.doc(JobsIndexDoc); index.summaries['job-review'].reviewStatus = 'pending';
        }, BACKGROUND_CONTEXT);
      } else {
        const rejected = await current.reviewService.decideReview('job-review', { requestId: `review-${nextStatus}`, status: nextStatus, actor: { kind: 'human', id: 'u' } });
        assert.equal(rejected.success, true);
      }
      const replay = await current.resultService.consumeResult('job-review', request);
      assert.equal(replay.success, false);
      assert.equal(replay.error.code, nextStatus === 'rejected' ? 'RESULT_REJECTED' : 'RESULT_REVIEW_REQUIRED');
      assert.equal((await current.fixture.repository.consumption('job-review')).count, 1);
      assert.equal((await current.fixture.outbox.pending(20)).filter(event => event.type === 'job.consumed').length, 1);
    } finally { await current.fixture.close(); }
  }
});

test('peek carga resultado autorizado sin consultar repository.result', async () => {
  const current = await setup({ status: 'approved' });
  try {
    const repository = { ...current.fixture.repository, result: async () => { throw new Error('unrestricted result read'); } };
    const service = createResultService(repository, current.query);
    const peek = await service.getResult('job-review', { mode: 'tool', operation: 'peek', actor: { kind: 'model', id: 'm' } });
    assert.equal(peek.success, true);
    assert.equal(peek.value.result.finalResponse, 'resultado completo');
  } finally { await current.fixture.close(); }
});

test('resultado cancelled conserva RESULT_NOT_READY', async () => {
  const current = await setup({ status: 'not_required' });
  try {
    await current.fixture.seedJob(job('cancelled', { status: 'cancelled', finishedAt: 1010 }), { ...result, status: 'interrupted' });
    const service = createResultService(current.fixture.repository, createQueryService(current.fixture.repository));
    const outcome = await service.getResult('cancelled', { mode: 'human', operation: 'peek', actor: { kind: 'human', id: 'u' } });
    assert.equal(outcome.success, false);
    assert.equal(outcome.error.code, 'RESULT_NOT_READY');
  } finally { await current.fixture.close(); }
});

test('cancelled con resultado aprobado no consume ni emite evento al rechazar', async () => {
  const current = await setup({ status: 'not_required' });
  try {
    await current.fixture.seedJob(job('cancelled-consume', { status: 'cancelled', finishedAt: 1010 }), { ...result, status: 'interrupted' });
    await seedReview(current.fixture, 'cancelled-consume', { status: 'approved' });
    const service = createResultService(current.fixture.repository, createQueryService(current.fixture.repository));
    const access = { mode: 'human', operation: 'consume', actor: { kind: 'human', id: 'u' }, requestId: 'cancelled-via-get' };
    const viaGet = await service.getResult('cancelled-consume', access);
    assert.equal(viaGet.success, false);
    assert.equal(viaGet.error.code, 'RESULT_NOT_READY');
    const viaDirect = await service.consumeResult('cancelled-consume', { requestId: 'cancelled-direct', actor: { kind: 'human', id: 'u' }, consumer: 'human:u' });
    assert.equal(viaDirect.success, false);
    assert.equal(viaDirect.error.code, 'RESULT_NOT_READY');
    assert.equal(await current.fixture.repository.consumption('cancelled-consume'), undefined);
    const pending = await current.fixture.outbox.pending(100);
    assert.equal(pending.filter(event => event.type === 'job.consumed' && event.jobId === 'cancelled-consume').length, 0);
    for (const requestId of ['cancelled-via-get', 'cancelled-direct']) {
      const key = createHash('sha256').update(requestId).digest('hex');
      assert.equal(await current.fixture.session.snapshot(RequestLedgerDocFamily, key, BACKGROUND_CONTEXT), undefined);
    }
  } finally { await current.fixture.close(); }
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
