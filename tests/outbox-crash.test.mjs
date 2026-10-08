import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { makeStoreFixture } from './helpers/store.mjs';
import { OutboxEventDocFamily, OutboxMetaDoc } from '../src/infrastructure/durable/outbox-documents.ts';

async function nextMessage(worker, timeoutMs = 5000) {
  let timer;
  try {
    return await Promise.race([
      once(worker, 'message').then(([message]) => message),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('worker message timeout')), timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function runCrash(mode) {
  const f = await makeStoreFixture({ sessionId: 'crash-session' });
  let worker;
  try {
    await f.session.close(context);
    worker = fork(new URL('./helpers/outbox-crash-worker.mjs', import.meta.url), [f.database, mode], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    assert.deepEqual(await nextMessage(worker), { point: mode === 'before' ? 'before-commit' : 'after-commit' });
    worker.kill('SIGKILL');
    const [code, signal] = await once(worker, 'exit');
    assert.equal(signal, 'SIGKILL');
    await f.reopen();
    const job = await f.repository.get('crash-job');
    const receipt = await f.repository.receipt('crash-request');
    const meta = await f.session.snapshot(OutboxMetaDoc, context);
    const events = await f.outbox.pending(10);
    return { f, job, receipt, meta, events };
  } catch (error) {
    await f.close();
    throw error;
  } finally {
    if (worker && worker.exitCode === null) worker.kill('SIGKILL');
  }
}

test('crash before commit leaves complete durable state untouched', async () => {
  const state = await runCrash('before');
  try {
    assert.equal(state.job, undefined);
    assert.equal(state.receipt, undefined);
    assert.equal(state.meta, undefined);
    assert.deepEqual(state.events, []);
  } finally { await state.f.close(); }
});

test('crash after commit preserves complete durable identity and sequence', async () => {
  const state = await runCrash('after');
  try {
    assert.equal(state.job.status, 'queued');
    assert.equal(state.receipt.requestId, 'crash-request');
    assert.equal(state.meta.nextSequence, 2);
    assert.equal(state.meta.nextToEmit, 1);
    assert.equal(state.events.length, 1);
    const event = state.events[0];
    assert.equal(event.sessionId, 'crash-session');
    assert.equal(event.sequence, 1);
    assert.equal(event.eventId, 'evt_' + (await import('node:crypto')).createHash('sha256').update(JSON.stringify(['crash-session', 1])).digest('hex'));
    assert.deepEqual(event.data, { status: 'queued', agent: 'agent', hasResult: false });
    const durableEvent = await state.f.session.snapshot(OutboxEventDocFamily, '1', context);
    assert.deepEqual(durableEvent.envelope, event);
  } finally { await state.f.close(); }
});
