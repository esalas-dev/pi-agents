import test from 'node:test';
import assert from 'node:assert/strict';
import { makeStoreFixture } from './helpers/store.mjs';
import { appendEvent } from '../src/infrastructure/durable/outbox.ts';
import { OutboxMetaDoc } from '../src/infrastructure/durable/outbox-documents.ts';
import { eventChannel } from '../src/public/job-events.ts';
import { createOutboxEmitter } from '../src/runtime/outbox-emitter.ts';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';

const input = (sequence = 0) => ({
  sessionId: 'emitter-session', jobId: 'job-1', type: 'job.queued', occurredAt: 1000 + sequence,
  data: { status: 'queued', agent: 'agent', hasResult: false },
});

async function append(f, count) {
  for (let index = 0; index < count; index++) await f.session.commit(tx => appendEvent(tx, input(index)), context);
}

async function eventually(predicate, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail('condition did not become true');
}

function controlledBus({ onEmit, onSubscribe } = {}) {
  const deliveries = [];
  const handlers = [];
  return {
    deliveries,
    emit(channel, envelope) {
      const result = onEmit?.(channel, envelope);
      if (result && typeof result.then === 'function') result.catch(() => {});
      deliveries.push({ channel, envelope });
      for (const handler of handlers.filter(item => item.channel === channel)) {
        const listenerResult = handler.handler(envelope);
        if (listenerResult && typeof listenerResult.then === 'function') listenerResult.catch(() => {});
      }
    },
    on(channel, handler) {
      const item = { channel, handler };
      handlers.push(item);
      onSubscribe?.(channel, handler);
      return () => { const index = handlers.indexOf(item); if (index >= 0) handlers.splice(index, 1); };
    },
  };
}

function options(f, bus, overrides = {}) {
  return {
    outbox: f.outbox,
    bus,
    isActive: () => true,
    clock: () => 2000,
    subscribeWake: () => () => {},
    report: () => {},
    ...overrides,
  };
}

test('emits before confirming and preserves ordered delivery across confirmation failure and reopen', async () => {
  const f = await makeStoreFixture({ sessionId: 'emitter-session' });
  try {
    await append(f, 2);
    const firstBus = controlledBus();
    const reports = [];
    let failConfirmation = true;
    const firstEmitter = createOutboxEmitter(options(f, firstBus, {
      outbox: {
        pending: limit => f.outbox.pending(limit),
        markEmitted: async (...args) => {
          if (failConfirmation) { failConfirmation = false; throw new Error('confirmation failed'); }
          return f.outbox.markEmitted(...args);
        },
      },
      report: error => reports.push(error),
    }));
    firstEmitter.start();
    await eventually(() => firstBus.deliveries.length === 1 && reports.length === 1);
    await firstEmitter.stop();
    await new Promise(resolve => setTimeout(resolve, 1050));
    assert.equal(firstBus.deliveries.length, 1);
    assert.deepEqual((await f.outbox.pending(10)).map(event => event.sequence), [1, 2]);

    const firstDelivery = firstBus.deliveries[0].envelope;
    await f.reopen();
    const secondBus = controlledBus();
    const secondEmitter = createOutboxEmitter(options(f, secondBus));
    secondEmitter.start();
    await eventually(() => secondBus.deliveries.length === 2);
    await secondEmitter.stop();
    assert.equal(firstDelivery.eventId, secondBus.deliveries[0].envelope.eventId);
    assert.equal(firstDelivery.sequence, secondBus.deliveries[0].envelope.sequence);
    assert.deepEqual(secondBus.deliveries.map(({ envelope }) => envelope.sequence), [1, 2]);
    assert.equal(reports[0].eventId, undefined);
  } finally { await f.close(); }
});

test('retries a failed batch locally after 1000 ms', async () => {
  const f = await makeStoreFixture({ sessionId: 'emitter-session' });
  try {
    await append(f, 1);
    let attempts = 0;
    const bus = controlledBus();
    const emitter = createOutboxEmitter(options(f, bus, {
      outbox: {
        pending: limit => f.outbox.pending(limit),
        markEmitted: async (...args) => {
          attempts++;
          if (attempts === 1) throw new Error('retry me');
          return f.outbox.markEmitted(...args);
        },
      },
    }));
    emitter.start();
    await eventually(() => bus.deliveries.length === 2, 3000);
    await emitter.stop();
    assert.equal(attempts, 2);
    assert.deepEqual(await f.outbox.pending(10), []);
  } finally { await f.close(); }
});

test('does not confirm a synchronous emit failure', async () => {
  const f = await makeStoreFixture({ sessionId: 'emitter-session' });
  try {
    await append(f, 2);
    const reports = [];
    const bus = controlledBus({ onEmit: () => { throw new Error('emit failed'); } });
    const emitter = createOutboxEmitter(options(f, bus, { report: error => reports.push(error) }));
    emitter.start();
    await eventually(() => reports.length === 1);
    await emitter.stop();
    assert.deepEqual((await f.outbox.pending(10)).map(event => event.sequence), [1, 2]);
    assert.equal(reports[0].message, 'emit failed');
    assert.equal(reports[0].eventId, undefined);
  } finally { await f.close(); }
});

test('does not interpret asynchronously rejecting listeners as nack', async () => {
  const f = await makeStoreFixture({ sessionId: 'emitter-session' });
  try {
    await append(f, 1);
    const bus = controlledBus();
    bus.on(eventChannel('job.queued'), () => Promise.reject(new Error('listener rejected')));
    const emitter = createOutboxEmitter(options(f, bus));
    emitter.start();
    await eventually(async () => (await f.outbox.pending(10)).length === 0);
    await emitter.stop();
    assert.equal(bus.deliveries.length, 1);
  } finally { await f.close(); }
});

test('drains more than one outbox page in ordered batches', async () => {
  const f = await makeStoreFixture({ sessionId: 'emitter-session' });
  try {
    await append(f, 257);
    const bus = controlledBus();
    const emitter = createOutboxEmitter(options(f, bus));
    emitter.start();
    await eventually(async () => (await f.outbox.pending(1)).length === 0, 15000);
    await emitter.stop();
    const observedSequences = bus.deliveries.map(({ envelope }) => envelope.sequence);
    assert.equal(observedSequences.length, 257);
    assert.deepEqual(observedSequences, [...observedSequences].sort((a, b) => a - b));
  } finally { await f.close(); }
});

test('retains a recent window of 1000 after emitting more than 1000 events', async () => {
  const f = await makeStoreFixture({ sessionId: 'emitter-session' });
  try {
    await append(f, 1001);
    const emitter = createOutboxEmitter(options(f, controlledBus()));
    emitter.start();
    await eventually(async () => (await f.outbox.pending(1)).length === 0, 30000);
    await emitter.stop();
    const meta = await f.session.snapshot(OutboxMetaDoc, context);
    assert.equal(meta.recent.length, 1000);
  } finally { await f.close(); }
});

test('does not emit while the generation is inactive', async () => {
  const f = await makeStoreFixture({ sessionId: 'emitter-session' });
  try {
    await append(f, 1);
    const bus = controlledBus();
    const emitter = createOutboxEmitter(options(f, bus, { isActive: () => false }));
    emitter.start();
    emitter.wake();
    await new Promise(resolve => setImmediate(resolve));
    await emitter.stop();
    assert.equal(bus.deliveries.length, 0);
    assert.equal((await f.outbox.pending(10)).length, 1);
  } finally { await f.close(); }
});

test('start and stop are idempotent and unsubscribe once', async () => {
  const f = await makeStoreFixture({ sessionId: 'emitter-session' });
  try {
    let unsubscribeCount = 0;
    const emitter = createOutboxEmitter(options(f, controlledBus(), {
      subscribeWake: () => () => { unsubscribeCount++; },
    }));
    emitter.start();
    emitter.start();
    await emitter.stop();
    await emitter.stop();
    assert.equal(unsubscribeCount, 1);
  } finally { await f.close(); }
});

test('stop waits for an admitted confirmation but not for consumers', async () => {
  const f = await makeStoreFixture({ sessionId: 'emitter-session' });
  try {
    await append(f, 1);
    let resolveConfirmation;
    const confirmation = new Promise(resolve => { resolveConfirmation = resolve; });
    let emitted = false;
    const emitter = createOutboxEmitter(options(f, controlledBus({ onEmit: () => { emitted = true; } }), {
      outbox: {
        pending: limit => f.outbox.pending(limit),
        markEmitted: async (...args) => { await confirmation; return f.outbox.markEmitted(...args); },
      },
    }));
    emitter.start();
    await eventually(() => emitted);
    const stopping = emitter.stop();
    let settled = false;
    void stopping.then(() => { settled = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false);
    resolveConfirmation();
    await stopping;
    assert.deepEqual(await f.outbox.pending(10), []);
  } finally { await f.close(); }
});

assert.equal(eventChannel('job.queued'), 'pi-durable-subagents:job:queued');
