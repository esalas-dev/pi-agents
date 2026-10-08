import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { makeStoreFixture } from './helpers/store.mjs';
import { OutboxMetaDoc } from '../src/infrastructure/durable/outbox-documents.ts';
import { JobReviewDocFamily, RequestLedgerDocFamily } from '../src/infrastructure/durable/documents.ts';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';

function input() {
  return {
    task: 'tarea privada SECRET_SENTINEL', cwd: '/private/path',
    agent: { name: 'agent', description: 'private', systemPrompt: 'secret', source: 'personal', filePath: '/private/agent.md', tools: [] },
    model: { provider: 'faux', modelId: 'faux-1' }, thinkingLevel: 'off',
  };
}

const requestKey = requestId => createHash('sha256').update(requestId).digest('hex');
const ledger = (f, requestId) => f.session.snapshot(RequestLedgerDocFamily, requestKey(requestId), context);
const storedJob = (id, status = 'queued', extra = {}) => ({ id, status, createdAt: 1, updatedAt: 1, notified: false, ...input(), ...extra });
const storedResult = (status = 'completed') => ({ finalResponse: 'ok', durationMs: 1, model: { provider: 'faux', modelId: 'faux-1' }, status });
const control = (requestId, action) => ({ requestId, action, actor: { kind: 'extension', id: 'caller' } });

test('event write failure rolls back job and event atomically', async () => {
  const f = await makeStoreFixture({ createId: () => 'job-fail', failCommit: writes => JSON.stringify(writes).includes('pi-durable-subagents.outbox-event') });
  try {
    const req = { requestId: 'start-fail', actor: { kind: 'extension', id: 'caller' }, payloadHash: 'hash-fail' };
    await assert.rejects(f.repository.admit(req, input()), /failpoint: outbox-event/);
    await f.reopen();
    assert.equal(await f.repository.get('job-fail'), undefined);
    assert.equal(await f.repository.receipt(req.requestId), undefined);
    assert.deepEqual(await f.outbox.pending(10), []);
    assert.equal(await f.session.snapshot(OutboxMetaDoc, context), undefined);
  } finally { await f.close(); }
});

test('create appends one exact queued event and rejects duplicate without append', async () => {
  const f = await makeStoreFixture();
  const original = { id: 'same-id', status: 'queued', createdAt: 1, updatedAt: 1, notified: false, ...input() };
  try {
    await f.repository.create(original);
    assert.deepEqual(await f.outbox.pending(10), [{
      protocolVersion: 1,
      eventId: 'evt_' + createHash('sha256').update(JSON.stringify(['test-session', 1])).digest('hex'),
      sequence: 1, sessionId: 'test-session', jobId: 'same-id', type: 'job.queued', occurredAt: 1,
      data: { status: 'queued', agent: 'agent', hasResult: false },
    }]);
    await assert.rejects(f.repository.create({ ...original, task: 'replacement' }), error => error?.error?.code === 'STORAGE_INCONSISTENT');
    assert.deepEqual(await f.repository.get('same-id'), original);
    assert.equal((await f.outbox.pending(10)).length, 1);
  } finally { await f.close(); }
});

test('finishCancelled persists one exact cancelled event and ignores repeat', async () => {
  const f = await makeStoreFixture();
  const job = { id: 'cancel-me', status: 'cancelling', createdAt: 1, updatedAt: 1, notified: false, control: { pending: 'cancel', requestedAt: 2, requestedBy: { kind: 'extension', id: 'caller' }, requestId: 'cancel-1' }, ...input() };
  try {
    await f.seedJob(job);
    await f.repository.finishCancelled(job.id, 'aborted', 3);
    const stored = await f.repository.get(job.id);
    assert.equal(stored.status, 'cancelled');
    assert.equal((await f.repository.result(job.id)).error, 'aborted');
    const expected = { status: 'cancelled', agent: 'agent', hasResult: true };
    const pendingAfterFirst = await f.outbox.pending(10);
    assert.equal(pendingAfterFirst.length, 1);
    assert.deepEqual(pendingAfterFirst.map(event => event.sequence), [1]);
    assert.deepEqual(pendingAfterFirst.map(event => event.type), ['job.cancelled']);
    assert.deepEqual(pendingAfterFirst.map(event => event.data), [expected]);
    await f.repository.finishCancelled(job.id, 'again', 4);
    assert.deepEqual(await f.outbox.pending(10), pendingAfterFirst);
  } finally { await f.close(); }
});

test('cancel queued appends exact event, records ledger, replays, and rejects repeat without append', async () => {
  const f = await makeStoreFixture();
  try {
    await f.seedJob(storedJob('queued-cancel'));
    const request = control('queued-cancel-1', 'cancel');
    await f.repository.applyControl('queued-cancel', request, 2);
    const expected = { status: 'cancelled', agent: 'agent', hasResult: true };
    const pendingBeforeReplay = await f.outbox.pending(10);
    assert.equal(pendingBeforeReplay.length, 1);
    assert.deepEqual(pendingBeforeReplay.map(event => event.sequence), [1]);
    assert.deepEqual(pendingBeforeReplay.map(event => event.type), ['job.cancelled']);
    assert.deepEqual(pendingBeforeReplay.map(event => event.data), [expected]);
    const firstLedger = await ledger(f, request.requestId);
    assert.equal(firstLedger.record.operation, 'control');
    assert.equal((await f.repository.applyControl('queued-cancel', request, 3)).replayed, true);
    assert.deepEqual(await f.outbox.pending(10), pendingBeforeReplay);
    assert.deepEqual(await ledger(f, request.requestId), firstLedger);
    const rejected = control('queued-cancel-2', 'cancel');
    await assert.rejects(f.repository.applyControl('queued-cancel', rejected, 4));
    assert.equal(await ledger(f, rejected.requestId), undefined);
    assert.deepEqual(await f.outbox.pending(10), pendingBeforeReplay);
  } finally { await f.close(); }
});

test('cancel paused appends exact event, records ledger, replays, and rejects repeat without append', async () => {
  const f = await makeStoreFixture();
  try {
    await f.seedJob(storedJob('paused-cancel'));
    await f.repository.applyControl('paused-cancel', control('pause-1', 'pause'), 2);
    const request = control('paused-cancel-1', 'cancel');
    await f.repository.applyControl('paused-cancel', request, 3);
    const pendingBeforeReplay = await f.outbox.pending(10);
    assert.equal(pendingBeforeReplay.length, 2);
    assert.deepEqual(pendingBeforeReplay.map(event => event.sequence), [1, 2]);
    assert.deepEqual(pendingBeforeReplay.map(event => event.type), ['job.paused', 'job.cancelled']);
    assert.deepEqual(pendingBeforeReplay.map(event => event.data), [
      { status: 'paused', agent: 'agent', hasResult: false },
      { status: 'cancelled', agent: 'agent', hasResult: true },
    ]);
    const firstLedger = await ledger(f, request.requestId);
    assert.equal(firstLedger.record.operation, 'control');
    assert.equal((await f.repository.applyControl('paused-cancel', request, 4)).replayed, true);
    assert.deepEqual(await f.outbox.pending(10), pendingBeforeReplay);
    assert.deepEqual(await ledger(f, request.requestId), firstLedger);
    const rejected = control('paused-cancel-2', 'cancel');
    await assert.rejects(f.repository.applyControl('paused-cancel', rejected, 5));
    assert.equal(await ledger(f, rejected.requestId), undefined);
    assert.deepEqual(await f.outbox.pending(10), pendingBeforeReplay);
  } finally { await f.close(); }
});

test('cancel active appends only the baseline request event and replays without append', async () => {
  const f = await makeStoreFixture();
  try {
    await f.seedJob(storedJob('active-cancel', 'running', { conversationId: 9, submissionId: 10 }));
    const request = control('active-cancel-1', 'cancel');
    await f.repository.applyControl('active-cancel', request, 2);
    const event = (await f.outbox.pending(10))[0];
    assert.equal(event.type, 'job.cancel-requested');
    assert.deepEqual(event.data, { status: 'cancelling', agent: 'agent', hasResult: false });
    const pendingBeforeReplay = await f.outbox.pending(10);
    assert.equal(pendingBeforeReplay.length, 1);
    assert.deepEqual(pendingBeforeReplay.map(event => event.sequence), [1]);
    assert.deepEqual(pendingBeforeReplay.map(event => event.type), ['job.cancel-requested']);
    const firstLedger = await ledger(f, request.requestId);
    assert.equal(firstLedger.record.operation, 'control');
    assert.equal((await f.repository.applyControl('active-cancel', request, 3)).replayed, true);
    assert.deepEqual(await f.outbox.pending(10), pendingBeforeReplay);
    assert.deepEqual(await ledger(f, request.requestId), firstLedger);
  } finally { await f.close(); }
});

test('failed and interrupted finishes append exact events once and markNotified is a no-op for outbox', async () => {
  const f = await makeStoreFixture();
  try {
    await f.seedJob(storedJob('failed-job', 'running', { conversationId: 11, submissionId: 12 }));
    await f.repository.finish('failed-job', storedResult('failed'), 2);
    const pendingAfterFailed = await f.outbox.pending(10);
    assert.equal(pendingAfterFailed.length, 1);
    assert.deepEqual(pendingAfterFailed.map(event => event.sequence), [1]);
    assert.deepEqual(pendingAfterFailed.map(event => event.type), ['job.failed']);
    assert.deepEqual(pendingAfterFailed.map(event => event.data), [{ status: 'failed', agent: 'agent', hasResult: true }]);
    await f.repository.finish('failed-job', storedResult('failed'), 3);
    await f.repository.markNotified('failed-job');
    assert.deepEqual(await f.outbox.pending(10), pendingAfterFailed);

    await f.seedJob(storedJob('interrupted-job', 'running', { conversationId: 13, submissionId: 14 }));
    await f.repository.finish('interrupted-job', storedResult('interrupted'), 4);
    const pendingAfterInterrupted = await f.outbox.pending(10);
    assert.equal(pendingAfterInterrupted.length, 2);
    assert.deepEqual(pendingAfterInterrupted.map(event => event.sequence), [1, 2]);
    assert.deepEqual(pendingAfterInterrupted.map(event => event.type), ['job.failed', 'job.interrupted']);
    assert.deepEqual(pendingAfterInterrupted.map(event => event.data), [
      { status: 'failed', agent: 'agent', hasResult: true },
      { status: 'interrupted', agent: 'agent', hasResult: true },
    ]);
    await f.repository.finish('interrupted-job', storedResult('interrupted'), 5);
    assert.deepEqual(await f.outbox.pending(10), pendingAfterInterrupted);
  } finally { await f.close(); }
});

test('lifecycle producers append exact provisioning, started, and completed events', async () => {
  const f = await makeStoreFixture();
  try {
    await f.seedJob(storedJob('run-job'));
    await f.repository.claimNext(1, async () => 7);
    await f.repository.markRunning('run-job', 8, 3);
    await f.repository.finish('run-job', storedResult('completed'), 4);
    assert.deepEqual((await f.outbox.pending(10)).map(event => event.type), ['job.provisioning', 'job.started', 'job.completed']);
    assert.deepEqual((await f.outbox.pending(10)).map(event => event.data), [
      { status: 'running', agent: 'agent', hasResult: false },
      { status: 'running', agent: 'agent', hasResult: false },
      { status: 'completed', agent: 'agent', hasResult: true },
    ]);
  } finally { await f.close(); }
});

test('retry appends one exact queued event and review/consume replay without append', async () => {
  const f = await makeStoreFixture({ createId: () => 'retry-job' });
  try {
    await f.seedJob(storedJob('terminal-job', 'completed', { finishedAt: 2 }), storedResult());
    const retry = await f.repository.retry('terminal-job', { requestId: 'retry-1', action: 'retry', actor: { kind: 'extension', id: 'caller' } }, 10);
    assert.equal(retry.retryOf, 'terminal-job');
    assert.deepEqual((await f.outbox.pending(10)).at(-1).data, { status: 'queued', agent: 'agent', hasResult: false, retryOf: 'terminal-job' });

    await f.seedJob(storedJob('review-job', 'completed', { finishedAt: 2 }), storedResult());
    await f.session.commit(async tx => { const review = await tx.doc(JobReviewDocFamily, 'review-job', { status: 'pending' }); review.status = 'pending'; }, context);
    const decision = { requestId: 'review-1', status: 'approved', actor: { kind: 'human', id: 'tui' } };
    const firstReview = await f.repository.decideReview('review-job', decision, 11);
    const reviewLedger = await ledger(f, decision.requestId);
    const pendingBeforeReviewReplay = await f.outbox.pending(10);
    assert.equal(pendingBeforeReviewReplay.length, 2);
    assert.deepEqual(pendingBeforeReviewReplay.map(event => event.sequence), [1, 2]);
    assert.deepEqual(pendingBeforeReviewReplay.map(event => event.type), ['job.queued', 'job.reviewed']);
    assert.deepEqual(pendingBeforeReviewReplay.at(-1).data, { status: 'completed', agent: 'agent', hasResult: true, reviewStatus: 'approved' });
    assert.deepEqual(await f.repository.decideReview('review-job', decision, 12), firstReview);
    assert.deepEqual(await f.outbox.pending(10), pendingBeforeReviewReplay);
    assert.deepEqual(await ledger(f, decision.requestId), reviewLedger);

    const consume = { requestId: 'consume-1', actor: { kind: 'extension', id: 'caller' }, consumer: 'caller' };
    const firstConsume = await f.repository.consume('review-job', consume, 13);
    const consumeLedger = await ledger(f, consume.requestId);
    assert.equal(firstConsume.count, 1);
    const pendingBeforeConsumeReplay = await f.outbox.pending(10);
    assert.equal(pendingBeforeConsumeReplay.length, 3);
    assert.deepEqual(pendingBeforeConsumeReplay.map(event => event.sequence), [1, 2, 3]);
    assert.deepEqual(pendingBeforeConsumeReplay.map(event => event.type), ['job.queued', 'job.reviewed', 'job.consumed']);
    assert.deepEqual(pendingBeforeConsumeReplay.at(-1).data, { status: 'completed', agent: 'agent', hasResult: true, consumptionCount: 1 });
    assert.deepEqual(await f.repository.consume('review-job', consume, 14), firstConsume);
    assert.deepEqual(await f.outbox.pending(10), pendingBeforeConsumeReplay);
    assert.deepEqual(await ledger(f, consume.requestId), consumeLedger);
  } finally { await f.close(); }
});

test('admit atomically appends one exact queued event and races fresh duplicate requests', async () => {
  const f = await makeStoreFixture({ createId: () => 'job-1' });
  try {
    const req = { requestId: 'start-1', actor: { kind: 'extension', id: 'caller' }, payloadHash: 'hash-1' };
    const firstAdmission = f.repository.admit(req, input());
    const secondAdmission = f.repository.admit(req, input());
    const [first, second] = await Promise.all([firstAdmission, secondAdmission]);
    assert.deepEqual(first, second);
    const firstLedger = await ledger(f, req.requestId);
    const pendingAfterRace = await f.outbox.pending(10);
    assert.equal(pendingAfterRace.length, 1);
    assert.deepEqual(pendingAfterRace, [{
      protocolVersion: 1,
      eventId: 'evt_' + createHash('sha256').update(JSON.stringify(['test-session', 1])).digest('hex'),
      sequence: 1, sessionId: 'test-session', jobId: 'job-1', type: 'job.queued', occurredAt: 2000,
      data: { status: 'queued', agent: 'agent', hasResult: false },
    }]);
    assert.equal(JSON.stringify(pendingAfterRace).includes('SECRET_SENTINEL'), false);
    const replay = await f.repository.admit(req, input());
    assert.deepEqual(replay, first);
    assert.deepEqual(await ledger(f, req.requestId), firstLedger);
    assert.deepEqual(await f.outbox.pending(10), pendingAfterRace);
  } finally { await f.close(); }
});
