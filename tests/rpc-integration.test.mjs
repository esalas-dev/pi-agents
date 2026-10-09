import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRpcFixture } from './helpers/rpc.mjs';
import { createRpcCaller } from './fixtures/rpc-caller-extension.ts';
import { createOutboxEmitter } from '../src/runtime/outbox-emitter.ts';
import { eventChannel, replyChannel } from '../rpc.ts';

async function eventually(predicate, timeout = 3000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail('condition did not become true');
}

test('caller público descubre, opera sobre SQLite, reconcilia eventos y limpia recursos', async t => {
  const fixture = await makeRpcFixture();
  const correlations = [];
  const caller = createRpcCaller({ bus: fixture.bus, callerId: 'trusted-extension', createCorrelationId: () => { const id = `caller-${correlations.length + 1}`; correlations.push(id); return id; } });
  const upstreamDeliveries = [];
  fixture.bus.on('subagents:jobs:done', event => upstreamDeliveries.push(event));
  const emitter = createOutboxEmitter({
    outbox: fixture.store.outbox, bus: fixture.bus, isActive: () => true, clock: () => 3000,
    subscribeWake: () => () => {}, report: error => { throw error; },
  });
  t.after(async () => { caller.shutdown(); await emitter.stop(); await fixture.close(); });
  emitter.start();

  const discovery = await caller.client.call('ping', {}, { requestId: 'caller:ping' });
  assert.equal(discovery.success, true);
  assert.equal(discovery.data.sessionId, 'rpc-session');
  const spawned = await caller.client.call('spawn', { agent: 'agent-a', task: 'integration task' }, { requestId: 'caller:spawn' });
  assert.equal(spawned.success, true);
  assert.equal(spawned.data.status, 'queued');
  emitter.wake();
  await eventually(() => caller.events.length === 1);
  const queuedEvent = caller.events[0];
  fixture.bus.emit(eventChannel(queuedEvent.type), queuedEvent);
  assert.equal(caller.events.length, 1);
  fixture.bus.emit(eventChannel(queuedEvent.type), { ...queuedEvent, sessionId: 'other-session' });
  assert.equal(caller.events.length, 2);
  fixture.bus.emit(eventChannel(queuedEvent.type), { ...queuedEvent, sessionId: 'a\u0000evt_shadow', eventId: 'evt_primary' });
  fixture.bus.emit(eventChannel(queuedEvent.type), { ...queuedEvent, sessionId: 'a', eventId: 'evt_shadow\u0000evt_primary' });
  assert.equal(caller.events.length, 4);
  assert.equal(new Set(caller.seenEventIds).size, caller.events.length);

  const reconciled = await caller.reconcile(spawned.data.jobId, 'caller:reconcile');
  assert.equal(reconciled.status.success, true);
  assert.equal(reconciled.status.data.status, 'queued');
  assert.equal(reconciled.list.success, true);
  assert.ok(reconciled.list.data.items.some(job => job.id === spawned.data.jobId));

  await fixture.seedJob('consume-job', { status: 'completed', finishedAt: 1010, resultMeta: { durationMs: 10, model: { provider: 'faux', modelId: 'faux-1' }, status: 'completed' } }, true);
  await fixture.seedReview('consume-job', 'approved');
  const first = await caller.client.call('result', { id: 'consume-job', operation: 'consume' }, { requestId: 'caller:consume:stable' });
  const replay = await caller.client.call('result', { id: 'consume-job', operation: 'consume' }, { requestId: 'caller:consume:stable' });
  assert.equal(first.success, true);
  assert.equal(replay.success, true);
  const statusAfterConsume = await caller.client.call('status', { id: 'consume-job' }, { requestId: 'caller:consume:status' });
  assert.equal(statusAfterConsume.data.consumption.count, 1);

  for (const correlation of correlations) {
    const operation = correlation === 'caller-1' ? 'ping' : correlation === 'caller-2' ? 'spawn'
      : correlation === 'caller-3' ? 'status' : correlation === 'caller-4' ? 'list'
      : correlation === 'caller-5' || correlation === 'caller-6' ? 'result' : 'status';
    assert.equal(fixture.bus.listenerCount(replyChannel(operation, correlation)), 0);
  }
  assert.equal(upstreamDeliveries.length, 0);
  assert.equal(fixture.bus.emitted.some(({ channel }) => channel.startsWith('subagents:')), false);
  caller.shutdown();
  assert.equal(fixture.bus.listenerCount(eventChannel('job.queued')), 0);
});
