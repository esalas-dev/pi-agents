import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import { createRegistry, Harness, LiveDoc } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createJobRepository } from '../src/infrastructure/durable/repository.ts';
import { JobDocFamily } from '../src/infrastructure/durable/documents.ts';
import * as sessionRuntime from '../src/runtime/session.ts';
import { acquireLease } from '../src/infrastructure/storage/lease.ts';

const createJobActivityWatcher = options => {
  assert.equal(typeof sessionRuntime.createJobActivityWatcher, 'function', 'SessionRuntime must expose its internal LiveDoc watch boundary');
  return sessionRuntime.createJobActivityWatcher(options);
};
const pause = () => new Promise(resolve => setImmediate(resolve));
const job = (id, overrides = {}) => ({
  id, status: 'running', task: 'test task', cwd: '/tmp/project', createdAt: 1, updatedAt: 2, startedAt: 2,
  agent: { name: 'test-agent', description: 'Test', systemPrompt: 'private prompt', source: 'personal', filePath: '/tmp/agent.md', tools: [] },
  model: { provider: 'faux', modelId: 'faux-1' }, thinkingLevel: 'off', notified: false,
  conversationId: 1, submissionId: 1, ...overrides,
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'pi-agents-observation-'));
  const harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'session.sqlite')), { models: createModels(), registry: createRegistry() }, context);
  const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' } }, context);
  const repository = createJobRepository(harness, context, () => 10, () => 'unused', 'widget-observation-test');
  return {
    directory, harness, conversation, repository,
    async close() { await harness.close(context); await rm(directory, { recursive: true, force: true }); },
    async seedJob(record) { await harness.commit(async tx => { const stored = await tx.doc(JobDocFamily, record.id, structuredClone(record)); Object.assign(stored, structuredClone(record)); }, context); },
    async setLive(value) {
      await harness.commit(async tx => {
        const live = await tx.doc(LiveDoc, conversation.id);
        for (const key of Object.keys(live)) delete live[key];
        Object.assign(live, structuredClone(value));
      }, context);
    },
  };
}

async function runtimeFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'pi-widget-retirement-'));
  const database = join(directory, 'jobs.sqlite');
  const originalOpen = Harness.open;
  let harness, runtime;
  const mock = t.mock.method(Harness, 'open', async (...args) => {
    harness = await originalOpen(...args);
    return harness;
  });
  try {
    runtime = await sessionRuntime.openSessionRuntime({ storagePath: database, models: createModels(), context, defaultCwd: '/tmp', sessionId: 'widget-observation-test', maxConcurrency: 1 });
    const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' } }, context);
    await harness.commit(async tx => {
      const record = job('running', { conversationId: conversation.id });
      Object.assign(await tx.doc(JobDocFamily, record.id, structuredClone(record)), record);
    }, context);
    return { runtime, harness, database, conversation, async close() { await runtime.close(); mock.mock.restore(); await rm(directory, { recursive: true, force: true }); } };
  } catch (error) { await runtime?.close(); mock.mock.restore(); await rm(directory, { recursive: true, force: true }); throw error; }
}

const live = {
  generation: { attempt: 2, message: { secret: 'PRIVATE_GENERATION_SENTINEL' }, retry: { at: 1234, error: 'PRIVATE_RETRY_SENTINEL' }, deferred: { pollAt: 2345 } },
  tools: [
    { callId: 'call-read', name: 'read', status: 'running', output: 'PRIVATE_OUTPUT_SENTINEL', details: { secret: 'PRIVATE_DETAILS_SENTINEL' }, diagnostics: [{ message: 'PRIVATE_DIAGNOSTIC_SENTINEL' }] },
    { callId: 'call-pending', name: 'bash', status: 'pending', output: 'PRIVATE_PENDING_SENTINEL' },
    { callId: 'call-done', name: 'bash', status: 'done', output: 'PRIVATE_DONE_SENTINEL' },
  ],
  compactions: [{ blocking: true, attempt: 3, retry: { at: 3456, error: 'PRIVATE_COMPACTION_SENTINEL' } }],
};
const expected = {
  tools: [{ callId: 'call-read', name: 'read' }],
  generation: { attempt: 2, retryAt: 1234, pollAt: 2345 },
  compactions: [{ blocking: true, attempt: 3, retryAt: 3456 }],
};

test('snapshot inicial solo expone actividad allowlisted sin cuerpo sensible', async () => {
  const f = await fixture();
  try {
    await f.seedJob(job('running', { conversationId: f.conversation.id }));
    await f.setLive(live);
    const watcher = await createJobActivityWatcher({ jobId: 'running', repository: f.repository, harness: f.harness, context, onUpdate() {} });
    assert.deepEqual(watcher.initial, expected);
    assert.doesNotMatch(JSON.stringify(watcher.initial), /PRIVATE_/);
    await watcher.close();
  } finally { await f.close(); }
});

test('watch publica reemplazos de LiveDoc sin duplicar tools ni mensajes', async () => {
  const f = await fixture();
  try {
    await f.seedJob(job('running', { conversationId: f.conversation.id }));
    await f.setLive(live);
    const updates = [];
    const watcher = await createJobActivityWatcher({ jobId: 'running', repository: f.repository, harness: f.harness, context, onUpdate: activity => updates.push(activity) });
    await f.setLive({ tools: [{ callId: 'call-next', name: 'bash', status: 'pending' }] });
    await pause();
    assert.deepEqual(updates, [{ tools: [], compactions: [] }]);
    await f.setLive({ tools: [{ callId: 'call-next', name: 'bash', status: 'running' }] });
    await pause();
    assert.deepEqual(updates, [{ tools: [], compactions: [] }, { tools: [{ callId: 'call-next', name: 'bash' }], compactions: [] }]);
    await watcher.close();
  } finally { await f.close(); }
});

test('job no activo o sin conversación no adquiere observador', async () => {
  const f = await fixture();
  try {
    const noConversation = job('provisioning', { status: 'provisioning' });
    delete noConversation.conversationId;
    delete noConversation.submissionId;
    const watcher = await createJobActivityWatcher({ jobId: 'provisioning', repository: { get: async () => noConversation }, harness: f.harness, context, onUpdate() {} });
    assert.equal(watcher, undefined);
  } finally { await f.close(); }
});

test('SessionRuntime expone la observación y devuelve undefined para jobs inexistentes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-agents-observation-runtime-'));
  let runtime;
  try {
    runtime = await sessionRuntime.openSessionRuntime({ storagePath: join(directory, 'jobs.sqlite'), models: createModels(), context, defaultCwd: '/tmp', sessionId: 'widget-observation-test', maxConcurrency: 1 });
    assert.equal(await runtime.watchJobActivity('missing', () => {}), undefined);
    await runtime.close();
    assert.equal(await runtime.watchJobActivity('missing', () => {}), undefined);
  } finally { await runtime?.close(); await rm(directory, { recursive: true, force: true }); }
});

test('close es idempotente y no publica callbacks después de cerrar', async () => {
  const f = await fixture();
  try {
    await f.seedJob(job('running', { conversationId: f.conversation.id }));
    await f.setLive(live);
    const updates = [];
    const watcher = await createJobActivityWatcher({ jobId: 'running', repository: f.repository, harness: f.harness, context, onUpdate: activity => updates.push(activity) });
    await watcher.close();
    await watcher.close();
    await f.setLive({ tools: [{ callId: 'late', name: 'edit', status: 'running' }] });
    await pause();
    assert.deepEqual(updates, []);
  } finally { await f.close(); }
});

test('seal rechaza observaciones nuevas y suprime actividad de la generación retirada', async t => {
  const f = await runtimeFixture(t);
  try {
    assert.equal(typeof f.runtime.watchJobActivity, 'function');
    const updates = [];
    const watch = await f.runtime.watchJobActivity('running', value => updates.push(value));
    assert.ok(watch);
    f.runtime.seal();
    assert.equal(await f.runtime.watchJobActivity('running', () => {}), undefined);
    await f.harness.commit(async tx => {
      const value = await tx.doc(LiveDoc, f.conversation.id);
      value.tools = [{ callId: 'late', name: 'read', status: 'running' }];
    }, context);
    await pause();
    assert.deepEqual(updates, []);
    await f.runtime.retire();
    await watch.closed;
  } finally { await f.close(); }
});

test('un observador terminado no queda retenido para volver a cerrarlo en retire', async t => {
  const f = await runtimeFixture(t);
  const openWatch = f.harness.watchDoc.bind(f.harness);
  let nativeWatch, stops = 0;
  t.mock.method(f.harness, 'watchDoc', async (...args) => {
    nativeWatch = await openWatch(...args);
    const stop = nativeWatch.stop.bind(nativeWatch);
    t.mock.method(nativeWatch, 'stop', () => { stops++; return stop(); });
    return nativeWatch;
  });
  try {
    const watch = await f.runtime.watchJobActivity('running', () => {});
    await nativeWatch.stop();
    await watch.closed;
    await f.runtime.retire();
    await f.runtime.close();
    assert.equal(stops, 1);
  } finally { await f.close(); }
});

for (const phase of ['acquisition', 'stop']) {
  test(`retire drena actividad en ${phase} antes del cierre SDK sin esperar al proveedor`, { timeout: 10000 }, async t => {
    const f = await runtimeFixture(t);
    const entered = Promise.withResolvers(), release = Promise.withResolvers();
    let acquisition, retiring, retired = false, closeCalls = 0;
    const openWatch = f.harness.watchDoc.bind(f.harness);
    const closeSdk = f.harness.close.bind(f.harness);
    t.mock.method(f.harness, 'close', (...args) => { closeCalls++; return closeSdk(...args); });
    t.mock.method(f.harness, 'watchDoc', async (...args) => {
      if (phase === 'acquisition') { entered.resolve(); await release.promise; }
      const watch = await openWatch(...args);
      if (phase === 'stop') {
        const stop = watch.stop.bind(watch);
        t.mock.method(watch, 'stop', async () => { entered.resolve(); await release.promise; await stop(); });
      }
      return watch;
    });
    try {
      assert.equal(typeof f.runtime.watchJobActivity, 'function');
      acquisition = f.runtime.watchJobActivity('running', () => {});
      if (phase === 'acquisition') await entered.promise;
      else assert.ok(await acquisition);
      retiring = f.runtime.retire().then(() => { retired = true; });
      await pause();
      assert.equal(retired, false);
      assert.equal(closeCalls, 0);
      assert.equal(await f.runtime.watchJobActivity('running', () => {}), undefined);
      release.resolve();
      if (phase === 'acquisition') assert.equal(await acquisition, undefined);
      await retiring;
      await f.runtime.close();
      assert.equal(closeCalls, 1);
      const lease = await acquireLease(f.database);
      await lease.release();
    } finally {
      release.resolve();
      await acquisition?.catch(() => {});
      await retiring?.catch(() => {});
      await f.close();
    }
  });
}
