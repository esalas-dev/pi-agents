import test from 'node:test';
import assert from 'node:assert/strict';
import { createRpcClient, replyChannel, requestChannel } from '../rpc.ts';

function makeBus(onEmit = () => {}) {
  const listeners = new Map();
  const emitted = [];
  return {
    emitted,
    emit(channel, data) {
      emitted.push({ channel, data });
      onEmit(channel, data, this);
      for (const handler of [...(listeners.get(channel) ?? [])]) handler(data);
    },
    on(channel, handler) {
      let set = listeners.get(channel);
      if (!set) listeners.set(channel, set = new Set());
      set.add(handler);
      return () => { set.delete(handler); if (!set.size) listeners.delete(channel); };
    },
    listenerCount(channel) { return listeners.get(channel)?.size ?? 0; },
  };
}

function makeTimers() {
  let id = 0;
  const tasks = new Map();
  return {
    api: {
      setTimeout(handler, ms) { const key = ++id; tasks.set(key, { handler, ms }); return key; },
      clearTimeout(key) { tasks.delete(key); },
    },
    fire(key = tasks.keys().next().value) { const task = tasks.get(key); if (task) { tasks.delete(key); task.handler(); } },
    get pending() { return tasks.size; },
    get delays() { return [...tasks.values()].map(task => task.ms); },
  };
}

function job(id = 'job-1') {
  return { id, status: 'queued', agent: 'agent-a', model: { provider: 'faux', modelId: 'faux-1' }, createdAt: 1, updatedAt: 1, hasResult: false, reviewStatus: 'not_required', consumption: { count: 0 } };
}
function ok(request, sessionId, data = job()) {
  return { protocolVersion: 1, requestId: request.requestId, correlationId: request.correlationId, sessionId, success: true, data };
}

const requestId = 'retry-stable';

test('captura respuesta síncrona, descubre sesión y limpia listener antes de retornar', async () => {
  let client;
  const bus = makeBus((channel, request, currentBus) => {
    if (channel === requestChannel('ping')) currentBus.emit(replyChannel('ping', request.correlationId), ok(request, 'session-a', {
      protocolVersion: 1, sessionId: 'session-a', implementationVersion: '1.0.0', operations: ['ping', 'status', 'list', 'wait', 'result', 'spawn', 'control', 'review'],
      capabilities: { query: true, wait: true, result: true, spawn: true, control: true, rpcReview: false, activePause: false, activeCancel: { requiresHumanConfirmation: true, available: false } },
      limits: { maxListPage: 100, maxWaitSeconds: 300, maxResultBytes: 65536, recentEventWindow: 1000, queryTimeoutMs: 5000, mutationTimeoutMs: 30000, maxIdBytes: 256, maxCorrelationLength: 128 },
    }));
    if (channel === requestChannel('status')) currentBus.emit(replyChannel('status', request.correlationId), ok(request, 'session-a'));
  });
  client = createRpcClient({ bus, callerId: 'test-extension', createCorrelationId: (() => { let n = 0; return () => `corr-${++n}`; })() });
  const ping = await client.call('ping', {}, { requestId: 'discover' });
  assert.equal(ping.success, true);
  const status = await client.call('status', { id: 'job-1' }, { requestId: 'status-1' });
  assert.equal(status.success, true);
  assert.equal(status.data.id, 'job-1');
  assert.equal(bus.emitted[1].data.sessionId, 'session-a');
  assert.equal(bus.listenerCount(replyChannel('ping', 'corr-1')), 0);
  assert.equal(bus.listenerCount(replyChannel('status', 'corr-2')), 0);
  client.close();
});

test('ignora respuestas con operación, correlación, requestId o sesión incorrectos', async () => {
  let bus;
  bus = makeBus((channel, request, currentBus) => {
    if (channel !== requestChannel('status')) return;
    currentBus.emit(replyChannel('list', request.correlationId), ok(request, 'session-a'));
    currentBus.emit(replyChannel('status', request.correlationId), { ...ok(request, 'session-a', job('wrong-correlation')), correlationId: 'wrong-correlation' });
    currentBus.emit(replyChannel('status', request.correlationId), { ...ok(request, 'session-a', job('wrong-request')), requestId: 'wrong-request' });
    currentBus.emit(replyChannel('status', request.correlationId), { ...ok(request, 'session-a'), data: { id: 'job-1', status: 'unknown' } });
    currentBus.emit(replyChannel('status', request.correlationId), ok(request, 'session-b'));
    currentBus.emit(replyChannel('status', request.correlationId), ok(request, 'session-a'));
  });
  const client = createRpcClient({ bus, callerId: 'test-extension', sessionId: 'session-a', createCorrelationId: () => 'status-correlation' });
  const response = await client.call('status', { id: 'job-1' }, { requestId });
  assert.equal(response.success, true);
  assert.equal(response.data.id, 'job-1');
  assert.equal(bus.listenerCount(replyChannel('status', 'status-correlation')), 0);
  client.close();
});

test('la excepción SESSION_MISMATCH conserva las guardas de respuesta', async t => {
  const timers = makeTimers();
  const bus = makeBus();
  const client = createRpcClient({ bus, callerId: 'test-extension', sessionId: 'session-a', timers: timers.api, createCorrelationId: () => 'mismatch-guard' });
  t.after(() => client.close());
  const pending = client.call('status', { id: 'job-1' }, { requestId: 'mismatch-guard-request' });
  const request = bus.emitted[0].data;
  const channel = replyChannel('status', request.correlationId);
  const mismatch = {
    protocolVersion: 1, requestId: request.requestId, correlationId: request.correlationId, sessionId: 'session-b', success: false,
    error: { code: 'SESSION_MISMATCH', message: 'La operación RPC no pudo completarse.', retryable: false, details: {} },
  };
  bus.emit(channel, { ...mismatch, protocolVersion: 2 });
  bus.emit(channel, { ...mismatch, correlationId: 'other-correlation' });
  bus.emit(channel, { ...mismatch, requestId: 'other-request' });
  bus.emit(replyChannel('list', request.correlationId), mismatch);
  bus.emit(channel, ok(request, 'session-b', job('wrong-session')));
  bus.emit(channel, { ...mismatch, error: { ...mismatch.error, code: 'JOB_NOT_FOUND' } });
  assert.equal(bus.listenerCount(channel), 1);
  assert.equal(timers.pending, 1);
  bus.emit(channel, ok(request, 'session-a'));
  const response = await pending;
  assert.equal(response.success, true);
  assert.equal(response.data.id, 'job-1');
  assert.equal(bus.listenerCount(channel), 0);
  assert.equal(timers.pending, 0);
});

test('captura requestId al reutilizar opciones con respuestas invertidas', async t => {
  const bus = makeBus();
  const timers = makeTimers();
  let correlation = 0;
  const client = createRpcClient({ bus, callerId: 'test-extension', sessionId: 'session-a', timers: timers.api, createCorrelationId: () => `corr-${++correlation}` });
  t.after(() => client.close());
  const callOptions = { requestId: 'request-1' };
  const first = client.call('status', { id: 'job-1' }, callOptions).catch(error => ({ localError: error.code }));
  callOptions.requestId = 'request-2';
  const second = client.call('status', { id: 'job-2' }, callOptions).catch(error => ({ localError: error.code }));
  callOptions.requestId = 'request-3';
  const requests = bus.emitted.map(({ data }) => data);
  assert.deepEqual(requests.map(request => request.requestId), ['request-1', 'request-2']);

  bus.emit(replyChannel('status', 'corr-1'), { ...ok(requests[0], 'session-a', job('wrong-request')), requestId: 'request-2' });
  assert.equal(bus.listenerCount(replyChannel('status', 'corr-1')), 1);
  bus.emit(replyChannel('status', 'corr-2'), ok(requests[1], 'session-a', job('job-2')));
  bus.emit(replyChannel('status', 'corr-1'), ok(requests[0], 'session-a', job('job-1')));
  while (timers.pending) timers.fire();
  const responses = await Promise.all([first, second]);
  assert.deepEqual(responses.map(response => response.requestId), ['request-1', 'request-2']);
  assert.deepEqual(responses.map(response => response.data?.id), ['job-1', 'job-2']);
  assert.ok(responses.every(response => response.success === true));
  assert.equal(callOptions.requestId, 'request-3');
  assert.equal(timers.pending, 0);
  assert.equal(bus.listenerCount(replyChannel('status', 'corr-1')), 0);
  assert.equal(bus.listenerCount(replyChannel('status', 'corr-2')), 0);
});

test('caller timeout and close clear listeners and timers', async () => {
  const timers = makeTimers();
  const bus = makeBus();
  const client = createRpcClient({ bus, callerId: 'test-extension', sessionId: 'session-a', timers: timers.api, createCorrelationId: (() => { let n = 0; return () => `corr-${++n}`; })() });
  const timedOut = client.call('status', { id: 'job-1' }, { requestId: 'timeout' });
  assert.equal(timers.delays[0], 6000);
  timers.fire();
  await assert.rejects(timedOut, error => error.code === 'RPC_CLIENT_TIMEOUT');
  assert.equal(bus.listenerCount(replyChannel('status', 'corr-1')), 0);
  assert.equal(timers.pending, 0);

  const pending = client.call('status', { id: 'job-2' }, { requestId: 'close' });
  client.close();
  await assert.rejects(pending, error => error.code === 'RPC_CLIENT_CLOSED');
  assert.equal(bus.listenerCount(replyChannel('status', 'corr-2')), 0);
  assert.equal(timers.pending, 0);
});

test('wait timeout incluye margen de transporte', async () => {
  const timers = makeTimers();
  const client = createRpcClient({ bus: makeBus(), callerId: 'test-extension', sessionId: 'session-a', timers: timers.api, createCorrelationId: () => 'wait-correlation' });
  const pending = client.call('wait', { id: 'job-1', timeoutSeconds: 7 }, { requestId: 'wait-1' });
  assert.deepEqual(timers.delays, [8000]);
  client.close();
  await assert.rejects(pending, error => error.code === 'RPC_CLIENT_CLOSED');
});

test('usa los deadlines caller por defecto para query, mutación, result consume y wait', async () => {
  for (const [operation, params, timeout] of [
    ['status', { id: 'job-1' }, 6000],
    ['control', { id: 'job-1', action: 'cancel' }, 31000],
    ['result', { id: 'job-1', operation: 'consume' }, 31000],
    ['wait', { id: 'job-1' }, 301000],
  ]) {
    const timers = makeTimers();
    const client = createRpcClient({ bus: makeBus(), callerId: 'test-extension', sessionId: 'session-a', timers: timers.api, createCorrelationId: () => `deadline-${operation}` });
    const pending = client.call(operation, params, { requestId: `deadline:${operation}` });
    assert.deepEqual(timers.delays, [timeout]);
    client.close();
    await assert.rejects(pending, error => error.code === 'RPC_CLIENT_CLOSED');
  }
});

test('reintento manual conserva requestId y genera otra correlationId', async () => {
  const bus = makeBus((channel, request, currentBus) => {
    if (channel === requestChannel('control') && request.correlationId === 'corr-2') {
      currentBus.emit(replyChannel('control', request.correlationId), { protocolVersion: 1, requestId: request.requestId, correlationId: request.correlationId, sessionId: 'session-a', success: false, error: { code: 'CONTROL_INVALID_STATE', message: 'No se pudo.', retryable: false, details: {} } });
    }
  });
  const timers = makeTimers();
  let correlation = 0;
  const client = createRpcClient({ bus, callerId: 'test-extension', sessionId: 'session-a', timers: timers.api, createCorrelationId: () => `corr-${++correlation}` });
  const first = client.call('control', { id: 'job-1', action: 'cancel' }, { requestId });
  timers.fire();
  await assert.rejects(first, error => error.code === 'RPC_CLIENT_TIMEOUT');
  const retry = await client.call('control', { id: 'job-1', action: 'cancel' }, { requestId });
  assert.equal(retry.success, false);
  assert.equal(bus.emitted[0].data.requestId, requestId);
  assert.equal(bus.emitted[1].data.requestId, requestId);
  assert.notEqual(bus.emitted[0].data.correlationId, bus.emitted[1].data.correlationId);
  assert.equal(bus.listenerCount(replyChannel('control', 'corr-1')), 0);
  assert.equal(bus.listenerCount(replyChannel('control', 'corr-2')), 0);
  client.close();
});

test('errores locales de emit se rechazan como transporte y limpian el listener', async () => {
  const bus = makeBus(() => { throw new Error('bus unavailable'); });
  const client = createRpcClient({ bus, callerId: 'test-extension', sessionId: 'session-a', createCorrelationId: () => 'transport-correlation' });
  await assert.rejects(client.call('spawn', { agent: 'agent-a', task: 'task' }, { requestId: 'spawn-1' }), error => error.code === 'RPC_CLIENT_TRANSPORT');
  assert.equal(bus.listenerCount(replyChannel('spawn', 'transport-correlation')), 0);
  client.close();
});
