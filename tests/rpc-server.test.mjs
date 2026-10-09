import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { makeEventBus, makeFakeTimers, makeRpcFixture, observeRpc, rpcRequest, flushRpc } from './helpers/rpc.mjs';
import { requestChannel, replyChannel } from '../src/public/rpc-contracts.ts';
import { registerRpcServer, serializeResultReply } from '../src/adapters/pi/rpc.ts';
import { registerPiAgents } from '../src/adapters/pi/register.ts';

const reply = async (fixture, operation, request) => observeRpc(fixture, operation, request).response;

test('ping descubre capacidades sin exigir sessionId y review siempre está prohibido', async t => {
  const fixture = await makeRpcFixture(); t.after(() => fixture.close());
  const discovery = await reply(fixture, 'ping', rpcRequest('ping', {}));
  assert.equal(discovery.success, true);
  assert.equal(discovery.data.sessionId, 'rpc-session');
  assert.equal(discovery.data.implementationVersion, '0.1.0');
  assert.equal(discovery.data.capabilities.rpcReview, false);
  assert.deepEqual(discovery.data.capabilities.activeCancel, { requiresHumanConfirmation: true, available: true });
  assert.equal(discovery.data.limits.maxResultBytes, 65536);
  const forbidden = await reply(fixture, 'review', rpcRequest('review', {}));
  assert.equal(forbidden.error.code, 'RPC_REVIEW_FORBIDDEN');
});

test('rechaza sesión distinta antes de resolver spawn y descarta IDs sobredimensionados', async t => {
  let resolves = 0;
  const fixture = await makeRpcFixture({ resolver: async intent => { resolves++; return { task: intent.task, cwd: intent.cwd, agent: { name: intent.agent, description: '', systemPrompt: '', source: 'personal', filePath: '/tmp/a', tools: [] }, model: { provider: 'faux', modelId: 'faux-1' }, thinkingLevel: 'off' }; } });
  t.after(() => fixture.close());
  const mismatch = await reply(fixture, 'spawn', rpcRequest('spawn', { agent: 'agent-a', task: 'task' }, { sessionId: 'another-session' }));
  assert.equal(mismatch.error.code, 'SESSION_MISMATCH');
  assert.equal(resolves, 0);
  for (const field of ['requestId', 'callerId', 'sessionId']) {
    const oversized = observeRpc(fixture, 'ping', rpcRequest('ping', {}, { [field]: 'x'.repeat(257), correlationId: `oversized-${field}` }));
    await flushRpc();
    assert.equal(oversized.replies.length, 0);
  }
  const unsafeCorrelation = observeRpc(fixture, 'ping', rpcRequest('ping', {}, { correlationId: 'x'.repeat(129) }));
  await flushRpc();
  assert.equal(unsafeCorrelation.replies.length, 0);
  assert.equal(resolves, 0);
});

test('no ejecuta accessors en los encabezados de una solicitud', async t => {
  const fixture = await makeRpcFixture(); t.after(() => fixture.close());
  const listeners = new Map();
  const emitted = [];
  const bus = {
    on(channel, listener) { listeners.set(channel, listener); return () => listeners.delete(channel); },
    emit(channel, value) { emitted.push({ channel, value }); listeners.get(channel)?.(value); },
  };
  const server = registerRpcServer({ bus, state: fixture.state, resolve: fixture.resolve, confirmActiveCancellation: async () => true });
  t.after(() => server.close());
  let getterCalls = 0;
  const request = rpcRequest('status', { id: 'private' });
  Object.defineProperty(request, 'correlationId', { enumerable: true, get() { getterCalls++; return 'getter-correlation'; } });
  bus.emit(requestChannel('status'), request);
  assert.equal(getterCalls, 0);
  assert.equal(emitted.some(item => item.channel === replyChannel('status', 'getter-correlation')), false);
});

test('descarta versión incorrecta de protocolo sin ejecutar operación', async t => {
  const fixture = await makeRpcFixture(); t.after(() => fixture.close());
  const response = await reply(fixture, 'status', rpcRequest('status', { id: 'missing' }, { protocolVersion: 2 }));
  assert.equal(response.success, false);
  assert.equal(response.error.code, 'PROTOCOL_UNSUPPORTED');
});

test('una correlación concurrente duplicada produce como máximo una respuesta', async t => {
  let release;
  let calls = 0;
  const blocked = new Promise(resolve => { release = resolve; });
  const fixture = await makeRpcFixture({ resolver: async intent => { calls++; await blocked; return { task: intent.task, cwd: intent.cwd, agent: { name: intent.agent, description: '', systemPrompt: '', source: 'personal', filePath: '/tmp/a', tools: [] }, model: { provider: 'faux', modelId: 'faux-1' }, thinkingLevel: 'off' }; } });
  t.after(() => fixture.close());
  const request = rpcRequest('spawn', { agent: 'agent-a', task: 'private task' });
  observeRpc(fixture, 'spawn', request);
  observeRpc(fixture, 'spawn', request);
  await flushRpc();
  assert.equal(calls, 1);
  release();
  await flushRpc(); await flushRpc();
  assert.equal(fixture.bus.emitted.filter(item => item.channel === replyChannel('spawn', request.correlationId)).length, 1);
});

test('status y list proyectan DTO públicos y no leen cuerpos de resultado', async t => {
  const fixture = await makeRpcFixture(); t.after(() => fixture.close());
  await fixture.seedJob('job-one');
  await fixture.seedJob('job-two');
  const status = await reply(fixture, 'status', rpcRequest('status', { id: 'job-one' }));
  assert.equal(status.success, true);
  assert.equal(status.data.status, 'queued');
  assert.equal(Object.hasOwn(status.data, 'task'), false);
  assert.equal(Object.hasOwn(status.data, 'cwd'), false);
  const listed = await reply(fixture, 'list', rpcRequest('list', { limit: 1 }));
  assert.equal(listed.success, true);
  assert.equal(listed.data.items.length, 1);
  assert.equal(Object.hasOwn(listed.data.items[0], 'task'), false);
  assert.equal(Object.hasOwn(listed.data.items[0], 'cwd'), false);
  assert.equal(fixture.store.readKinds.includes('job-result'), false);
});

test('wait timeout termina solo la espera y no cancela el trabajo', async t => {
  const fixture = await makeRpcFixture(); t.after(() => fixture.close());
  await fixture.seedJob('job-wait');
  const response = await reply(fixture, 'wait', rpcRequest('wait', { id: 'job-wait', timeoutSeconds: 0 }));
  assert.equal(response.success, false);
  assert.equal(response.error.code, 'WAIT_TIMEOUT');
  assert.equal((await fixture.store.repository.get('job-wait')).status, 'queued');
});

test('wait satisface el predicado cancelled con el DTO público', async t => {
  const fixture = await makeRpcFixture(); t.after(() => fixture.close());
  await fixture.seedJob('cancelled-wait', { status: 'cancelled', finishedAt: 1010 });
  const response = await reply(fixture, 'wait', rpcRequest('wait', { id: 'cancelled-wait', until: 'cancelled' }));
  assert.equal(response.success, true);
  assert.equal(response.data.status, 'cancelled');
});

test('wait de 300 s recibe timeout acotado y no cancela la espera', async t => {
  const timers = makeFakeTimers();
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const fixture = await makeRpcFixture({ runtime: { jobs: { waitForJob: () => pending } }, timers: timers.api }); t.after(() => fixture.close());
  const attempt = observeRpc(fixture, 'wait', rpcRequest('wait', { id: 'long-wait', timeoutSeconds: 300 }));
  timers.advance(300099);
  assert.equal(attempt.replies.length, 0);
  timers.advance(1);
  assert.equal((await attempt.response).error.code, 'RPC_TIMEOUT');
  release({ success: false, error: { code: 'WAIT_ABORTED' } });
  await flushRpc();
  assert.equal(attempt.replies.length, 1);
});

test('spawn admite intención con actor extension y no devuelve tarea ni cwd', async t => {
  const fixture = await makeRpcFixture(); t.after(() => fixture.close());
  const response = await reply(fixture, 'spawn', rpcRequest('spawn', { agent: 'agent-a', task: 'private task' }));
  assert.equal(response.success, true);
  assert.deepEqual(response.data, { jobId: 'rpc-job-1', status: 'queued', agent: 'agent-a' });
  const stored = await fixture.store.repository.get(response.data.jobId);
  assert.deepEqual(stored.createdBy, { kind: 'extension', id: 'trusted-extension' });
  assert.equal(stored.task, 'private task');
  assert.equal(response.error, undefined);
});

test('spawn que excede deadline durante resolución no admite trabajo tardío', async t => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const { makeFakeTimers } = await import('./helpers/rpc.mjs');
  const timers = makeFakeTimers();
  const fixture = await makeRpcFixture({ timers: timers.api, resolver: async intent => { await blocked; return { task: intent.task, cwd: intent.cwd, agent: { name: intent.agent, description: '', systemPrompt: '', source: 'personal', filePath: '/tmp/a', tools: [] }, model: { provider: 'faux', modelId: 'faux-1' }, thinkingLevel: 'off' }; } }); t.after(() => fixture.close());
  const request = rpcRequest('spawn', { agent: 'agent-a', task: 'too slow' }, { correlationId: 'slow-spawn' });
  const attempt = observeRpc(fixture, 'spawn', request);
  await flushRpc();
  timers.advance(30000);
  assert.equal((await attempt.response).error.code, 'RPC_TIMEOUT');
  release();
  await flushRpc(); await flushRpc();
  assert.equal(await fixture.store.repository.get('rpc-job-1'), undefined);
  assert.equal(attempt.replies.length, 1);
});

test('rechaza campos de autoridad y cwd aportados por el caller', async t => {
  let confirmations = 0;
  const fixture = await makeRpcFixture({ confirm: async () => { confirmations++; return true; } }); t.after(() => fixture.close());
  const forged = rpcRequest('spawn', { agent: 'agent-a', task: 'task', cwd: '/attacker', actor: { kind: 'human' } });
  const response = await reply(fixture, 'spawn', forged);
  assert.equal(response.success, false);
  assert.equal(response.error.code, 'INVALID_REQUEST');
  await fixture.seedJob('forged-confirmation', { status: 'running', startedAt: 1000, submissionId: 12 });
  const forgedConfirmation = await reply(fixture, 'control', rpcRequest('control', { id: 'forged-confirmation', action: 'cancel', confirmed: true }));
  assert.equal(forgedConfirmation.error.code, 'INVALID_REQUEST');
  assert.equal(confirmations, 0);
  assert.equal((await fixture.store.outbox.pending(100)).filter(event => event.type === 'job.cancel-requested').length, 0);
  assert.equal(await fixture.store.repository.get('rpc-job-1'), undefined);
});

test('el texto de result se trunca en frontera Unicode y conserva hash del texto completo', async t => {
  const fixture = await makeRpcFixture(); t.after(() => fixture.close());
  const text = ('🙂 "quote" \\\\ \n').repeat(5000) + 'fin';
  await fixture.seedJob('job-result', { status: 'completed', finishedAt: 1010, resultMeta: { durationMs: 10, model: { provider: 'faux', modelId: 'faux-1' }, status: 'completed' } }, true);
  await fixture.seedReview('job-result', 'approved');
  const { JobResultDocFamily } = await import('../src/infrastructure/durable/documents.ts');
  const body = await fixture.store.session.commit(async tx => { const doc = await tx.doc(JobResultDocFamily, 'job-result', { finalResponse: text, durationMs: 10, model: { provider: 'faux', modelId: 'faux-1' }, status: 'completed' }); doc.finalResponse = text; }, (await import('@earendil-works/chord/context')).BACKGROUND_CONTEXT);
  void body;
  const response = await reply(fixture, 'result', rpcRequest('result', { id: 'job-result', operation: 'peek' }));
  assert.equal(response.success, true);
  assert.equal(response.data.result.totalBytes, Buffer.byteLength(text));
  assert.equal(response.data.result.sha256, createHash('sha256').update(text).digest('hex'));
  assert.equal(response.data.result.truncated, true);
  const lastUnit = response.data.result.text.charCodeAt(response.data.result.text.length - 1);
  assert.equal(lastUnit >= 0xd800 && lastUnit <= 0xdbff, false);
  assert.ok(Buffer.byteLength(JSON.stringify(response)) <= 65536);
});

test('seal responde RPC_SHUTTING_DOWN y close retira los ocho listeners', async t => {
  const fixture = await makeRpcFixture(); t.after(() => fixture.close());
  fixture.server.seal();
  const sealed = await reply(fixture, 'ping', rpcRequest('ping', {}));
  assert.equal(sealed.error.code, 'RPC_SHUTTING_DOWN');
  const malformedWhileSealed = await reply(fixture, 'status', rpcRequest('status', { id: 42 }));
  assert.equal(malformedWhileSealed.error.code, 'RPC_SHUTTING_DOWN');
  await fixture.server.close();
  for (const operation of ['ping', 'status', 'list', 'wait', 'result', 'spawn', 'control', 'review']) assert.equal(fixture.bus.listenerCount(requestChannel(operation)), 0);
  assert.equal(fixture.server.discovery().sessionId, 'rpc-session');
});

test('timeout de consulta responde una vez y descarta finalización tardía', async t => {
  const timers = makeFakeTimers();
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const jobs = { getJob: () => pending };
  const fixture = await makeRpcFixture({ runtime: { jobs }, timers: timers.api }); t.after(() => fixture.close());
  const request = rpcRequest('status', { id: 'job-slow' });
  const attempt = observeRpc(fixture, 'status', request);
  timers.advance(5000);
  await flushRpc();
  assert.equal((await attempt.response).error.code, 'RPC_TIMEOUT');
  release({ success: false, error: { code: 'JOB_NOT_FOUND' } });
  await flushRpc();
  assert.equal(attempt.replies.length, 1);
});

test('serializer rechaza metadatos que no caben y errores inesperados no filtran mensajes', async t => {
  const request = rpcRequest('result', { id: 'job', operation: 'peek' });
  const tooLarge = serializeResultReply(request, 'rpc-session', { job: { id: 'j'.repeat(70000) }, result: { text: '', totalBytes: 0, sha256: 'hash', truncated: false, durationMs: 1, model: { provider: 'faux', modelId: 'faux-1' }, status: 'completed' } });
  assert.equal(tooLarge.success, false);
  assert.equal(tooLarge.error.code, 'INVALID_REQUEST');
  const fixture = await makeRpcFixture({ runtime: { jobs: { getJob: async () => { throw new Error('SECRET_SENTINEL'); } } } }); t.after(() => fixture.close());
  const response = await reply(fixture, 'status', rpcRequest('status', { id: 'private' }));
  assert.equal(response.error.code, 'STORAGE_ERROR');
  assert.equal(JSON.stringify(response).includes('SECRET_SENTINEL'), false);
});

test('invalidar la generación suprime una respuesta tardía', async t => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const fixture = await makeRpcFixture({ runtime: { jobs: { getJob: () => pending } } }); t.after(() => fixture.close());
  const request = rpcRequest('status', { id: 'job-late' });
  const attempt = observeRpc(fixture, 'status', request);
  fixture.generation.seal();
  release({ success: false, error: { code: 'JOB_NOT_FOUND' } });
  await flushRpc();
  assert.equal(attempt.replies.length, 0);
});

test('Pi registra RPC, anuncia ready y arranca el outbox en orden; limpia antes del runtime', async () => {
  const bus = makeEventBus();
  const order = [];
  bus.on('pi-durable-subagents:ready', () => order.push(`ready:${bus.listenerCount(requestChannel('ping'))}`));
  const jobs = { unnotified: async () => ({ success: true, value: [] }) };
  const runtime = {
    jobs, outbox: { pending: async () => { order.push('pending'); return []; }, markEmitted: async () => {} },
    subscribeOutboxWake: () => { order.push('wake-subscribe'); return () => order.push('wake-unsubscribe'); },
    seal() { order.push('runtime-seal'); },
    async close() { order.push(`runtime-close:${bus.listenerCount(requestChannel('ping'))}`); },
    retire() { return this.close(); },
  };
  const handlers = [];
  const pi = {
    events: bus, on(name, handler) { handlers.push({ name, handler }); }, registerTool() {}, registerCommand() {}, registerEntryRenderer() {}, appendEntry() {},
  };
  const ctx = {
    cwd: '/tmp/project', mode: 'tui', hasUI: true,
    sessionManager: { getSessionId: () => 'rpc-session' },
    modelRegistry: { getAll: () => [], getProvider: () => undefined }, isProjectTrusted: () => true,
    ui: { notify() {}, confirm: async () => true },
  };
  registerPiAgents(pi, { getAgentDir: () => '/tmp', createModels: async () => ({ registerNativeProvider() {} }), resolveModel: () => ({}), text: value => value, Type: { Object: fields => ({ fields }), String: () => ({ type: 'string' }) }, version: 'test', openRuntime: async () => runtime });
  await handlers.find(item => item.name === 'session_start').handler({}, ctx);
  await flushRpc();
  assert.equal(order[0], 'ready:1');
  assert.ok(order.indexOf('wake-subscribe') > order.indexOf('ready:1'));
  assert.ok(order.indexOf('pending') > order.indexOf('wake-subscribe'));
  await handlers.find(item => item.name === 'session_shutdown').handler({}, ctx);
  assert.ok(order.indexOf('wake-unsubscribe') < order.findIndex(value => value.startsWith('runtime-close:')));
  assert.equal(order.find(value => value.startsWith('runtime-close:')), 'runtime-close:0');
});

test('close invalida una espera pendiente sin cancelar el trabajo ni publicar tarde', async t => {
  const timers = makeFakeTimers();
  const fixture = await makeRpcFixture({ timers: timers.api });
  await fixture.seedJob('job-close');
  const request = rpcRequest('wait', { id: 'job-close', timeoutSeconds: 300 });
  const attempt = observeRpc(fixture, 'wait', request);
  await flushRpc();
  await fixture.server.close();
  await flushRpc();
  assert.equal(attempt.replies.length, 0);
  assert.equal((await fixture.store.repository.get('job-close')).status, 'queued');
  assert.equal(timers.pending, 0);
});
