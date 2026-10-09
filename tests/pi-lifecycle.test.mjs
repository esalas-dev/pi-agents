import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeneration } from '../src/runtime/generation.ts';
import { createPiLifecycle } from '../src/adapters/pi/lifecycle.ts';

test('generation activa, sella y cierra una identidad sin reactivarla', () => {
  const generation = createGeneration('session-1');
  assert.equal(generation.sessionId, 'session-1');
  assert.equal(generation.phase, 'opening');
  assert.equal(generation.isActive(), false);
  generation.activate();
  assert.equal(generation.isActive(), true);
  generation.seal();
  assert.equal(generation.signal.aborted, true);
  assert.equal(generation.phase, 'closing');
  assert.equal(generation.isActive(), false);
  generation.close();
  generation.close();
  assert.equal(generation.phase, 'closed');
  assert.throws(() => generation.activate());
});

function fixture({ createModels = async () => ({ registerNativeProvider() {} }), openRuntime } = {}) {
  const handlers = new Map(); const reports = []; const opened = [];
  const pi = {
    on(name, handler) { handlers.set(name, handler); },
    appendEntry(type, data) { reports.push({ type, data }); },
  };
  const bindings = {
    getAgentDir: () => '/tmp/pi-agents', createModels,
    resolveModel() { return {}; }, text: value => value, Type: {}, version: 'test',
    openRuntime: openRuntime ?? (async options => {
      const runtime = fakeRuntime(options);
      opened.push({ options, runtime });
      return runtime;
    }),
  };
  const lifecycle = createPiLifecycle(pi, bindings, { onOpen: async state => {
    const cleanup = { calls: 0 };
    state.cleanupProbe = cleanup;
    return async () => { cleanup.calls++; };
  } });
  const context = sessionId => ({
    cwd: '/tmp/project', mode: 'tui', hasUI: true,
    sessionManager: { getSessionId: () => sessionId },
    modelRegistry: { getAll: () => [], getProvider: () => undefined },
    ui: { confirm: async () => false, notify() {} },
  });
  return { handlers, lifecycle, context, opened, reports };
}

function fakeRuntime(options) {
  const calls = { seal: 0, close: 0 };
  return {
    options, calls,
    jobs: { unnotified: async () => ({ success: true, value: [] }) },
    seal() { calls.seal++; },
    async close() { calls.close++; },
    retire() { return this.close(); },
  };
}

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

test('ensure reutiliza una generación activa y session_start del mismo id la reemplaza', async () => {
  const f = fixture(); const ctx = f.context('same');
  await f.handlers.get('session_start')({}, ctx);
  const first = await f.lifecycle.ensure(ctx);
  assert.equal(await f.lifecycle.ensure(ctx), first);
  await f.handlers.get('session_start')({}, ctx);
  const second = await f.lifecycle.ensure(ctx);
  assert.notEqual(second.generation, first.generation);
  assert.equal(first.generation.isActive(), false);
  assert.equal(first.cleanupProbe.calls, 1);
  assert.equal(f.opened[0].runtime.calls.seal, 1);
  assert.equal(f.opened[0].runtime.calls.close, 1);
  await f.lifecycle.close();
  assert.equal(second.cleanupProbe.calls, 1);
  assert.equal(f.opened[1].runtime.calls.close, 1);
});

test('el cambio de sesión sella antes de esperar el cierre anterior', async () => {
  const f = fixture(); const old = f.context('old');
  await f.handlers.get('session_start')({}, old);
  const first = await f.lifecycle.ensure(old);
  const closing = deferred();
  f.opened[0].runtime.close = () => closing.promise;
  const switching = f.handlers.get('session_start')({}, f.context('new'));
  assert.equal(first.generation.phase, 'closing');
  assert.equal(first.generation.signal.aborted, true);
  assert.equal(f.opened[0].runtime.calls.seal, 1);
  closing.resolve();
  await switching;
  const next = await f.lifecycle.ensure(f.context('new'));
  assert.equal(next.sessionId, 'new');
  await f.lifecycle.close();
});

test('switch retira recursos sin esperar close SDK y mantiene autoridad de la generación nueva', { timeout: 5000 }, async () => {
  const sdkClose = deferred();
  const f = fixture();
  const old = f.context('old');
  await f.handlers.get('session_start')({}, old);
  const first = await f.lifecycle.ensure(old);
  first.runtime.close = () => sdkClose.promise;
  first.runtime.retire = async () => {};
  let opened = false;
  const switching = f.handlers.get('session_start')({}, f.context('new')).then(() => { opened = true; });
  try {
    for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(opened, true, 'session switch must wait retire, not full SDK close');
    assert.equal(first.generation.isActive(), false);
    const next = await f.lifecycle.ensure(f.context('new'));
    assert.equal(next.sessionId, 'new');
    assert.equal(f.opened[0].options.isParentActive(), false);
    assert.equal(f.opened[1].options.isParentActive(), true);
  } finally { sdkClose.resolve(); await switching; await f.lifecycle.close(); }
});

test('informa un fallo SDK tardío sin reactivar la autoridad retirada', async () => {
  const f = fixture();
  await f.handlers.get('session_start')({}, f.context('old'));
  await f.handlers.get('session_start')({}, f.context('new'));
  f.opened[0].options.onReport(new Error('sdk-close-after-retire'));
  assert.equal(f.reports.some(report => report.data.text === 'sdk-close-after-retire'), true);
  assert.equal(f.opened[0].options.isParentActive(), false);
  assert.equal(f.opened[1].options.isParentActive(), true);
  await f.lifecycle.close();
});

test('serializa la apertura nueva detrás de una apertura anterior en curso', { timeout: 5000 }, async () => {
  const firstOpen = deferred(); const firstStarted = deferred(); let calls = 0;
  const f = fixture({ openRuntime: async options => {
    calls++;
    if (calls === 1) { firstStarted.resolve(); await firstOpen.promise; }
    return fakeRuntime(options);
  } });
  const first = f.handlers.get('session_start')({}, f.context('old'));
  await firstStarted.promise;
  const second = f.handlers.get('session_start')({}, f.context('new'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  firstOpen.resolve();
  await Promise.all([first, second]);
  assert.equal(calls, 2);
  await f.lifecycle.close();
});

test('shutdown no espera una apertura bloqueada y la siguiente apertura espera a que termine', { timeout: 5000 }, async () => {
  const creation = deferred(); let opening = 0; let onOpen = 0;
  const f = fixture({ createModels: () => creation.promise, openRuntime: async () => { opening++; return fakeRuntime({}); } });
  f.lifecycle = createPiLifecycle({ on: f.handlers.set.bind(f.handlers), appendEntry() {} }, {
    getAgentDir: () => '/tmp/pi-agents', createModels: () => creation.promise,
    openRuntime: async () => { opening++; return fakeRuntime({}); },
  }, { onOpen: async () => { onOpen++; return async () => {}; } });
  const startup = f.handlers.get('session_start')({}, f.context('pending'));
  await f.lifecycle.close();
  const restart = f.handlers.get('session_start')({}, f.context('next'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(opening, 0);
  assert.equal(onOpen, 0);
  creation.resolve({ registerNativeProvider() {} });
  await Promise.all([startup, restart]);
  assert.equal(opening, 1);
  assert.equal(onOpen, 1);
  await f.lifecycle.close();
});

test('close libera recursos sin esperar una ejecución activa ni perder su estado recuperable', async () => {
  const execution = deferred(); const f = fixture({ openRuntime: async options => {
    const runtime = fakeRuntime(options);
    runtime.jobs.status = async () => ({ success: true, value: { job: { id: 'running', status: 'running' } } });
    runtime.execution = execution.promise;
    return runtime;
  } });
  const ctx = f.context('active'); await f.handlers.get('session_start')({}, ctx);
  const state = await f.lifecycle.ensure(ctx);
  assert.equal((await state.runtime.jobs.status('running')).value.job.status, 'running');
  await f.lifecycle.close();
  assert.equal(state.generation.isActive(), false);
  assert.equal((await state.runtime.jobs.status('running')).value.job.status, 'running');
  execution.resolve();
});

test('un runtime que falla al abrir no activa la generación ni ejecuta onOpen', async () => {
  let onOpen = 0;
  const f = fixture({ openRuntime: async () => { throw new Error('open failed'); } });
  f.lifecycle = createPiLifecycle({ on: f.handlers.set.bind(f.handlers), appendEntry() {} }, {
    getAgentDir: () => '/tmp/pi-agents', createModels: async () => ({ registerNativeProvider() {} }),
    openRuntime: async () => { throw new Error('open failed'); },
  }, { onOpen: async () => { onOpen++; return async () => {}; } });
  await f.handlers.get('session_start')({}, f.context('broken'));
  await assert.rejects(f.lifecycle.ensure(f.context('broken')));
  assert.equal(onOpen, 0);
});
