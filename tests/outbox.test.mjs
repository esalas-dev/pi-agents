import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createSession } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { JobEventTypes } from '../src/public/job-events.ts';
import { OutboxEventDocFamily, OutboxMetaDoc } from '../src/infrastructure/durable/outbox-documents.ts';
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

test('confirmation is ordered, idempotent, retains recent 1000 and does not delete events', async () => {
  const f = await fixture();
  try {
    const events = [];
    for (let i = 0; i < 1002; i++) events.push(await f.session.commit(tx => appendEvent(tx, input(i)), context));
    await assert.rejects(() => f.outbox.markEmitted(events[1].eventId, 2, 2000), error => error?.error?.code === 'STORAGE_ERROR');
    await assert.rejects(() => f.outbox.markEmitted('evt_wrong', 1, 2000), error => error?.error?.code === 'STORAGE_ERROR');
    await f.outbox.markEmitted(events[0].eventId, 1, 2000);
    await f.outbox.markEmitted(events[0].eventId, 1, 2001);
    for (let i = 1; i < events.length; i++) await f.outbox.markEmitted(events[i].eventId, i + 1, 2000 + i);
    const meta = await f.session.snapshot(OutboxMetaDoc, context);
    assert.equal(meta.nextToEmit, 1003);
    assert.equal(meta.recent.length, 1000);
    assert.equal((await f.outbox.pending(10)).length, 0);
    const reopened = await f.reopen();
    assert.equal((await reopened.pending(10)).length, 0);
    assert.equal((await f.session.snapshot(OutboxMetaDoc, context)).recent.length, 1000);
    const retained = await f.session.snapshot(OutboxEventDocFamily, '1', context);
    assert.equal(retained.envelope.eventId, events[0].eventId);
    assert.equal(retained.emittedAt, 2000);
  } finally { await f.close(); }
});

assert.ok(JobEventTypes.includes('job.queued'));
