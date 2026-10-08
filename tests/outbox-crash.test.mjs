import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { makeStoreFixture } from './helpers/store.mjs';
import { JobsIndexDoc, RequestLedgerDocFamily } from '../src/infrastructure/durable/documents.ts';
import { OutboxEventDocFamily, OutboxMetaDoc, OutboxPageDocFamily } from '../src/infrastructure/durable/outbox-documents.ts';

async function nextMessage(worker, timeoutMs = 5000) {
  let timer;
  try {
    return await Promise.race([
      once(worker, 'message').then(([message]) => message),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('worker message timeout')), timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function stopWorker(worker) {
  if (!worker) return [worker?.exitCode, worker?.signalCode];
  if (worker.exitCode === null && worker.signalCode === null) {
    const exited = once(worker, 'exit');
    worker.kill('SIGKILL');
    return exited;
  }
  return [worker.exitCode, worker.signalCode];
}

const ledgerKey = requestId => createHash('sha256').update(requestId).digest('hex');

async function durableSnapshot(f) {
  return {
    job: await f.repository.get('crash-job'),
    index: await f.session.snapshot(JobsIndexDoc, context),
    receipt: await f.repository.receipt('crash-request'),
    ledger: await f.session.snapshot(RequestLedgerDocFamily, ledgerKey('crash-request'), context),
    meta: await f.session.snapshot(OutboxMetaDoc, context),
    pending: await f.outbox.pending(10),
    event: await f.session.snapshot(OutboxEventDocFamily, '1', context),
    page: await f.session.snapshot(OutboxPageDocFamily, '0', context),
  };
}

async function runCrash(mode) {
  const f = await makeStoreFixture({ sessionId: 'crash-session' });
  let worker;
  try {
    await f.session.close(context);
    worker = fork(new URL('./helpers/outbox-crash-worker.mjs', import.meta.url), [f.database, mode], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    assert.deepEqual(await nextMessage(worker), { point: mode === 'before' ? 'before-commit' : 'after-commit' });
    const [code, signal] = await stopWorker(worker);
    assert.equal(code, null);
    assert.equal(signal, 'SIGKILL');
    await f.reopen();
    return { f, state: await durableSnapshot(f) };
  } catch (error) {
    await stopWorker(worker);
    await f.close();
    throw error;
  }
}

function expectedEvent() {
  return {
    protocolVersion: 1,
    eventId: 'evt_' + createHash('sha256').update(JSON.stringify(['crash-session', 1])).digest('hex'),
    sequence: 1,
    sessionId: 'crash-session',
    jobId: 'crash-job',
    type: 'job.queued',
    occurredAt: 2000,
    data: { status: 'queued', agent: 'agent', hasResult: false },
  };
}

function expectedJob() {
  return {
    task: 'private', cwd: process.cwd(),
    agent: { name: 'agent', description: 'd', systemPrompt: 's', source: 'personal', filePath: '/private/a', tools: [] },
    model: { provider: 'faux', modelId: 'faux-1' }, thinkingLevel: 'off',
    createdBy: { kind: 'extension', id: 'crash' },
    id: 'crash-job', status: 'queued', createdAt: 2000, updatedAt: 2000, notified: false,
  };
}

const expectedReceipt = {
  requestId: 'crash-request', operation: 'start', actor: { kind: 'extension', id: 'crash' },
  canonicalVersion: 1, payloadHash: 'crash-hash', admittedAt: 2000,
  response: { jobId: 'crash-job', status: 'queued', agent: 'agent' },
};

test('crash before commit leaves every public durable snapshot absent', async () => {
  const result = await runCrash('before');
  try {
    assert.deepEqual(result.state, {
      job: undefined, index: undefined, receipt: undefined, ledger: undefined,
      meta: undefined, pending: [], event: undefined, page: undefined,
    });
  } finally { await result.f.close(); }
});

test('crash after commit preserves complete public job, index, ledger, receipt, and outbox identity', async () => {
  const result = await runCrash('after');
  try {
    const event = expectedEvent();
    const receipt = structuredClone(expectedReceipt);
    assert.deepEqual(result.state.job, expectedJob());
    assert.deepEqual(result.state.index, {
      storageSchemaVersion: 2,
      order: ['crash-job'],
      summaries: { 'crash-job': { id: 'crash-job', status: 'queued', agent: 'agent', createdAt: 2000, updatedAt: 2000, hasResult: false, notified: false, reviewStatus: 'pending' } },
    });
    assert.deepEqual(result.state.receipt, receipt);
    assert.deepEqual(result.state.ledger, { record: receipt });
    assert.deepEqual(result.state.meta, { nextSequence: 2, nextToEmit: 1, recent: [] });
    assert.deepEqual(result.state.pending, [event]);
    assert.deepEqual(result.state.event, { envelope: event });
    assert.deepEqual(result.state.page, { sequences: [1] });
    assert.deepEqual(result.state.event.envelope.data, { status: 'queued', agent: 'agent', hasResult: false });
  } finally { await result.f.close(); }
});

test('crash helper timeout is bounded and leaves no child alive after cleanup', async () => {
  const f = await makeStoreFixture({ sessionId: 'crash-session' });
  let worker;
  let exit;
  try {
    await f.session.close(context);
    worker = fork(new URL('./helpers/outbox-crash-worker.mjs', import.meta.url), [f.database, 'before'], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    assert.deepEqual(await nextMessage(worker), { point: 'before-commit' });
    await assert.rejects(nextMessage(worker, 25), /worker message timeout/);
  } finally {
    exit = await stopWorker(worker);
    await f.close();
  }
  assert.deepEqual(exit, [null, 'SIGKILL']);
  assert.equal(worker.signalCode, 'SIGKILL');
});
