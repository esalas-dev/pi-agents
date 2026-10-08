import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createSession, defineDoc } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { JobEventTypes } from '../src/public/job-events.ts';
import { OutboxEventDocFamily, OutboxMetaDoc } from '../src/infrastructure/durable/outbox-documents.ts';

const CallerDoc = defineDoc({ kind: 'test.outbox-caller', version: 1, scope: 'session', initial: () => ({ count: 0 }) });
import { appendEvent, createOutboxRepository } from '../src/infrastructure/durable/outbox.ts';

const input = (sequence = undefined) => ({ sessionId: 'session-1', jobId: 'job-1', type: 'job.queued', occurredAt: 1000 + (sequence ?? 0), data: { status: 'queued', agent: 'agent', hasResult: false } });

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'pi-outbox-'));
  const database = join(directory, 'outbox.sqlite');
  let session = createSession(await openNodeSqliteStorage(database));
  let outbox = createOutboxRepository(session, context);
  const open = async () => { session = createSession(await openNodeSqliteStorage(database)); outbox = createOutboxRepository(session, context); return outbox; };
  return { database, get session() { return session; }, get outbox() { return outbox; }, reopen: async () => { await session.close(context); return open(); }, close: async () => { await session.close(context); await rm(directory, { recursive: true, force: true }); } };
}

test('append shares the caller transaction and rollback preserves sequence 1 with no event', async () => {
  const f = await fixture();
  try {
    await assert.rejects(() => f.session.commit(async tx => { await appendEvent(tx, input()); throw new Error('rollback'); }, context), /rollback/);
    const outbox = await f.reopen();
    assert.deepEqual(await outbox.pending(10), []);
    assert.equal((await f.session.snapshot(OutboxMetaDoc, context)), undefined);
    const event = await f.session.commit(tx => appendEvent(tx, input()), context);
    assert.equal(event.sequence, 1);
  } finally { await f.close(); }
});

test('append, close and reopen preserve events and pages beyond 256 pending entries', async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 257; i++) await f.session.commit(tx => appendEvent(tx, input(i)), context);
    assert.equal((await f.outbox.pending(300)).length, 257);
    assert.deepEqual((await f.outbox.pending(1))[0].sequence, 1);
    const reopened = await f.reopen();
    assert.equal((await reopened.pending(300)).length, 257);
    assert.equal((await reopened.pending(300))[256].sequence, 257);
  } finally { await f.close(); }
});

test('confirmation is ordered, idempotent beyond recent retention, retains pending and does not delete events', async () => {
  const f = await fixture();
  try {
    const events = [];
    for (let i = 0; i < 1002; i++) events.push(await f.session.commit(tx => appendEvent(tx, input(i)), context));
    await assert.rejects(() => f.outbox.markEmitted(events[1].eventId, 2, 2000), error => error?.error?.code === 'STORAGE_ERROR');
    await assert.rejects(() => f.outbox.markEmitted('evt_wrong', 1, 2000), error => error?.error?.code === 'STORAGE_ERROR');
    for (let i = 0; i < 1002; i++) await f.outbox.markEmitted(events[i].eventId, i + 1, 2000 + i);
    const meta = await f.session.snapshot(OutboxMetaDoc, context);
    assert.equal(meta.nextToEmit, 1003);
    assert.equal(meta.recent.length, 1000);
    assert.deepEqual((await f.outbox.pending(10)).map(event => event.sequence), []);
    await assert.rejects(() => f.outbox.markEmitted('evt_wrong', 1, 9998), error => error?.error?.code === 'STORAGE_ERROR');
    const beforeRepeat = structuredClone(await f.session.snapshot(OutboxMetaDoc, context));
    await f.outbox.markEmitted(events[0].eventId, 1, 9999);
    assert.deepEqual(await f.session.snapshot(OutboxMetaDoc, context), beforeRepeat);
    assert.equal((await f.session.snapshot(OutboxEventDocFamily, '1', context)).emittedAt, 2000);
    const reopened = await f.reopen();
    assert.deepEqual((await reopened.pending(10)).map(event => event.sequence), []);
    assert.equal((await f.session.snapshot(OutboxMetaDoc, context)).recent.length, 1000);
    const retained = await f.session.snapshot(OutboxEventDocFamily, '1', context);
    assert.equal(retained.envelope.eventId, events[0].eventId);
    assert.equal(retained.emittedAt, 2000);
  } finally { await f.close(); }
});

test('pending survives recent rotation and reopen while old event identity remains strict', async () => {
  const f = await fixture();
  try {
    const events = [];
    for (let i = 0; i < 1002; i++) events.push(await f.session.commit(tx => appendEvent(tx, input(i)), context));
    for (let i = 0; i < 1001; i++) await f.outbox.markEmitted(events[i].eventId, i + 1, 3000 + i);
    assert.deepEqual((await f.outbox.pending(10)).map(event => event.sequence), [1002]);
    await assert.rejects(() => f.outbox.markEmitted('evt_wrong', 1, 5000), error => error?.error?.code === 'STORAGE_ERROR');
    await f.outbox.markEmitted(events[0].eventId, 1, 5001);
    assert.equal((await f.session.snapshot(OutboxEventDocFamily, '1', context)).emittedAt, 3000);
    const reopened = await f.reopen();
    assert.deepEqual((await reopened.pending(10)).map(event => event.sequence), [1002]);
    assert.equal((await f.session.snapshot(OutboxEventDocFamily, '1', context)).envelope.eventId, events[0].eventId);
  } finally { await f.close(); }
});

test('append composes with caller document and rolls back both documents on failure', async () => {
  const f = await fixture();
  try {
    const event = await f.session.commit(async tx => {
      const caller = await tx.doc(CallerDoc);
      caller.count++;
      return appendEvent(tx, input());
    }, context);
    assert.equal(event.sequence, 1);
    assert.equal((await f.session.snapshot(CallerDoc, context)).count, 1);
    assert.equal((await f.outbox.pending(1))[0].eventId, event.eventId);
    await assert.rejects(() => f.session.commit(async tx => {
      const caller = await tx.doc(CallerDoc);
      caller.count++;
      await appendEvent(tx, input(1));
      throw new Error('rollback composition');
    }, context), /rollback composition/);
    assert.equal((await f.session.snapshot(CallerDoc, context)).count, 1);
    assert.deepEqual((await f.outbox.pending(10)).map(item => item.sequence), [1]);
    await f.reopen();
    assert.equal((await f.session.snapshot(CallerDoc, context)).count, 1);
    assert.deepEqual((await f.outbox.pending(10)).map(item => item.sequence), [1]);
  } finally { await f.close(); }
});

test('append rejects safe integer overflow without changing caller document or metadata', async () => {
  const f = await fixture();
  try {
    await assert.rejects(() => f.session.commit(async tx => {
      const caller = await tx.doc(CallerDoc);
      caller.count++;
      const meta = await tx.doc(OutboxMetaDoc);
      meta.nextSequence = Number.MAX_SAFE_INTEGER;
      return appendEvent(tx, input());
    }, context), error => error?.error?.code === 'STORAGE_ERROR');
    assert.equal((await f.session.snapshot(CallerDoc, context)), undefined);
    assert.equal((await f.session.snapshot(OutboxMetaDoc, context)), undefined);
    assert.deepEqual(await f.outbox.pending(10), []);
    await f.reopen();
    assert.equal((await f.session.snapshot(CallerDoc, context)), undefined);
    assert.equal((await f.session.snapshot(OutboxMetaDoc, context)), undefined);
    assert.deepEqual(await f.outbox.pending(10), []);
  } finally { await f.close(); }
});

assert.ok(JobEventTypes.includes('job.queued'));
