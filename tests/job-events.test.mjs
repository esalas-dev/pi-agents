import test from 'node:test';
import assert from 'node:assert/strict';
import { makeStoreFixture } from './helpers/store.mjs';
import { OutboxMetaDoc } from '../src/infrastructure/durable/outbox-documents.ts';
import { JobReviewDocFamily } from '../src/infrastructure/durable/documents.ts';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';

function input() {
  return {
    task: 'tarea privada SECRET_SENTINEL', cwd: '/private/path',
    agent: { name: 'agent', description: 'private', systemPrompt: 'secret', source: 'personal', filePath: '/private/agent.md', tools: [] },
    model: { provider: 'faux', modelId: 'faux-1' }, thinkingLevel: 'off',
  };
}

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

test('create rejects an existing id without overwriting or appending', async () => {
  const f = await makeStoreFixture();
  const original = { id: 'same-id', status: 'queued', createdAt: 1, updatedAt: 1, notified: false, ...input() };
  try {
    await f.repository.create(original);
    await assert.rejects(f.repository.create({ ...original, task: 'replacement' }), error => error?.error?.code === 'STORAGE_INCONSISTENT');
    assert.equal((await f.repository.get('same-id')).task, original.task);
    assert.equal((await f.outbox.pending(10)).length, 1);
  } finally { await f.close(); }
});

test('finishCancelled persists a public cancelled result and one event', async () => {
  const f = await makeStoreFixture();
  const job = { id: 'cancel-me', status: 'cancelling', createdAt: 1, updatedAt: 1, notified: false, control: { pending: 'cancel', requestedAt: 2, requestedBy: { kind: 'extension', id: 'caller' }, requestId: 'cancel-1' }, ...input() };
  try {
    await f.seedJob(job);
    await f.repository.finishCancelled(job.id, 'aborted', 3);
    const stored = await f.repository.get(job.id);
    assert.equal(stored.status, 'cancelled');
    assert.equal((await f.repository.result(job.id)).error, 'aborted');
    const events = await f.outbox.pending(10);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'job.cancelled');
    assert.deepEqual(events[0].data, { status: 'cancelled', agent: 'agent', hasResult: true });
    await f.repository.finishCancelled(job.id, 'again', 4);
    assert.equal((await f.outbox.pending(10)).length, 1);
  } finally { await f.close(); }
});

const storedJob = (id, status = 'queued', extra = {}) => ({ id, status, createdAt: 1, updatedAt: 1, notified: false, ...input(), ...extra });
const storedResult = (status = 'completed') => ({ finalResponse: 'ok', durationMs: 1, model: { provider: 'faux', modelId: 'faux-1' }, status });

 test('lifecycle producers append one allowlisted event per effective transition', async () => {
  const f = await makeStoreFixture({ createId: () => 'retry-job' });
  try {
    await f.seedJob(storedJob('run-job'));
    await f.repository.claimNext(1, async () => 7);
    await f.repository.markRunning('run-job', 8, 3);
    await f.repository.finish('run-job', storedResult('completed'), 4);
    const lifecycle = await f.outbox.pending(10);
    assert.deepEqual(lifecycle.map(event => event.type), ['job.provisioning', 'job.started', 'job.completed']);
    assert.deepEqual(lifecycle.map(event => event.data), [
      { status: 'running', agent: 'agent', hasResult: false },
      { status: 'running', agent: 'agent', hasResult: false },
      { status: 'completed', agent: 'agent', hasResult: true },
    ]);
    await f.repository.finish('run-job', storedResult('failed'), 5);
    await f.repository.markNotified('run-job');
    assert.equal((await f.outbox.pending(10)).length, 3);

    await f.seedJob(storedJob('control-job'));
    await f.repository.applyControl('control-job', { requestId: 'pause-1', action: 'pause', actor: { kind: 'extension', id: 'caller' } }, 6);
    await f.repository.applyControl('control-job', { requestId: 'resume-1', action: 'resume', actor: { kind: 'extension', id: 'caller' } }, 7);
    await f.repository.applyControl('control-job', { requestId: 'cancel-1', action: 'cancel', actor: { kind: 'extension', id: 'caller' } }, 8);
    await assert.rejects(f.repository.applyControl('control-job', { requestId: 'cancel-2', action: 'cancel', actor: { kind: 'extension', id: 'caller' } }, 9));
    assert.deepEqual((await f.outbox.pending(10)).slice(3).map(event => event.type), ['job.paused', 'job.resumed', 'job.cancelled']);

    await f.seedJob(storedJob('terminal-job', 'completed', { finishedAt: 2 }), storedResult());
    const retry = await f.repository.retry('terminal-job', { requestId: 'retry-1', action: 'retry', actor: { kind: 'extension', id: 'caller' } }, 10);
    assert.equal((await f.outbox.pending(10)).at(-1).type, 'job.queued');
    assert.deepEqual((await f.outbox.pending(10)).at(-1).data, { status: 'queued', agent: 'agent', hasResult: false, retryOf: 'terminal-job' });
    assert.equal(retry.retryOf, 'terminal-job');

    await f.seedJob(storedJob('active-job', 'running', { conversationId: 9, submissionId: 10 }));
    await f.repository.applyControl('active-job', { requestId: 'active-cancel', action: 'cancel', actor: { kind: 'extension', id: 'caller' } }, 11);
    assert.equal((await f.outbox.pending(10)).at(-1).type, 'job.cancel-requested');
    await f.seedJob(storedJob('failed-job', 'running', { conversationId: 11, submissionId: 12 }));
    await f.repository.finish('failed-job', storedResult('failed'), 12);
    await f.seedJob(storedJob('interrupted-job', 'running', { conversationId: 13, submissionId: 14 }));
    await f.repository.finish('interrupted-job', storedResult('interrupted'), 13);
    assert.deepEqual((await f.outbox.pending(20)).slice(-3).map(event => event.type), ['job.cancel-requested', 'job.failed', 'job.interrupted']);
  } finally { await f.close(); }
});

test('review and consumption append once and replay without append', async () => {
  const f = await makeStoreFixture();
  try {
    await f.seedJob(storedJob('review-job', 'completed', { finishedAt: 2 }), storedResult());
    await f.session.commit(async tx => { const review = await tx.doc(JobReviewDocFamily, 'review-job', { status: 'pending' }); review.status = 'pending'; }, context);
    const decision = { requestId: 'review-1', status: 'approved', actor: { kind: 'human', id: 'tui' } };
    const firstReview = await f.repository.decideReview('review-job', decision, 3);
    const replayReview = await f.repository.decideReview('review-job', decision, 4);
    assert.deepEqual(replayReview, firstReview);
    assert.deepEqual((await f.outbox.pending(10)).map(event => event.type), ['job.reviewed']);
    assert.deepEqual((await f.outbox.pending(10))[0].data, { status: 'completed', agent: 'agent', hasResult: true, reviewStatus: 'approved' });
    const consume = { requestId: 'consume-1', actor: { kind: 'extension', id: 'caller' }, consumer: 'caller' };
    const firstConsume = await f.repository.consume('review-job', consume, 5);
    assert.equal(firstConsume.count, 1);
    assert.equal((await f.repository.consume('review-job', consume, 6)).count, 1);
    assert.deepEqual((await f.outbox.pending(10)).map(event => event.type), ['job.reviewed', 'job.consumed']);
    assert.deepEqual((await f.outbox.pending(10))[1].data, { status: 'completed', agent: 'agent', hasResult: true, consumptionCount: 1 });
  } finally { await f.close(); }
});

test('admit atomically appends one public queued event and deduplicates concurrent intent', async () => {
  const f = await makeStoreFixture({ createId: () => 'job-1' });
  try {
    const req = { requestId: 'start-1', actor: { kind: 'extension', id: 'caller' }, payloadHash: 'hash-1' };
    const [first, second] = await Promise.all([f.repository.admit(req, input()), f.repository.admit(req, input())]);
    assert.deepEqual(first, second);
    const pending = await f.outbox.pending(10);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].type, 'job.queued');
    assert.deepEqual(pending[0].data, { status: 'queued', agent: 'agent', hasResult: false });
    assert.equal(JSON.stringify(pending).includes('SECRET_SENTINEL'), false);
  } finally { await f.close(); }
});
