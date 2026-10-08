import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { registerPiAgents, canConfirmMigration } from '../src/adapters/pi/register.ts';
import { resolveInput } from '../src/adapters/pi/resolve.ts';
import { formatStatus, formatResult, briefSummary } from '../src/adapters/pi/display.ts';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxAssistantMessage, fauxProvider, fauxText } from '@earendil-works/pi-ai/providers/faux';
import { BACKGROUND_CONTEXT as background } from '@earendil-works/chord/context';
import { Harness } from '@earendil-works/pi-durable';
import { acquireLease } from '../src/infrastructure/storage/lease.ts';
import { openSessionRuntime } from '../src/runtime/session.ts';
import { legacyInput } from './helpers/legacy.mjs';

function host(ctx, t) {
  const handlers = {}; const registered = { tools: [] }; const entries = []; const closures = [];
  if (t) {
    const originalOpen = Harness.open;
    t.mock.method(Harness, 'open', async (...args) => {
      const harness = await originalOpen(...args);
      const originalClose = harness.close.bind(harness);
      const closed = Promise.withResolvers();
      closures.push(closed.promise);
      harness.close = async (...closeArgs) => { await originalClose(...closeArgs); closed.resolve(); };
      return harness;
    });
  }
  const pi = { on: (name, fn) => { handlers[name] = fn; }, registerTool: tool => { registered.tools.push(tool); registered.tool = tool; }, registerCommand: (name, command) => { registered.command = { name, ...command }; }, registerEntryRenderer: () => {}, appendEntry: (type, data) => entries.push({ type, data }) };
  return { pi, handlers, registered, entries, dispatch: async (name, ...args) => handlers[name]?.(...args, ctx), async close() { await handlers.session_shutdown?.({}).catch(() => {}); await Promise.all(closures); } };
}
function modelRuntime(model) { return { registerNativeProvider() {}, getModel: () => model }; }
function context(cwd) { return { cwd, mode: 'tui', hasUI: true, model: { provider: 'faux', id: 'faux-1' }, thinkingLevel: 'off', modelRegistry: { getAll: () => [], getProvider: () => undefined }, isProjectTrusted: () => true, sessionManager: { getSessionId: () => 'adapter-test', getBranch: () => [] }, ui: { notify() {}, confirm: async () => true } }; }

 test('resolveInput conserva confianza, snapshot y modelo configurado', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-agents-adapter-')); const agentDir = join(directory, 'agents'); await (await import('node:fs/promises')).mkdir(agentDir, { recursive: true }); await writeFile(join(agentDir, 'a.md'), '---\nname: worker\ndescription: worker\ntools: read,write\n---\nSystem prompt'); const ctx = context(directory); const model = { provider: 'faux', id: 'faux-1' };
  try { const resolved = await resolveInput(ctx, modelRuntime(model), { agent: 'worker', task: ' tarea ', cwd: directory }, { getAgentDir: () => directory, createModels: async () => modelRuntime(model), resolveModel: () => ({ model }), text: () => {}, Type: {}, version: 'test' }); assert.equal(resolved.agent.source, 'personal'); assert.equal(resolved.task, ' tarea '); assert.deepEqual(resolved.model, { provider: model.provider, modelId: model.id }); }
  finally { await rm(directory, { recursive: true, force: true }); }
});

test('registro no abre runtime al construir y tool devuelve recibo inmediato con actor model', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-agents-adapter-register-')); const ctx = context(directory); const model = { provider: 'faux', id: 'faux-1' }; const h = host(ctx);
  try {
    registerPiAgents(h.pi, { getAgentDir: () => directory, createModels: async () => modelRuntime(model), resolveModel: () => ({ model }), text: content => content, Type: { Object: x => x, String: () => ({}) }, version: 'test' });
    assert.deepEqual(h.registered.tools.map(tool => tool.name), ['pi_agents', 'pi_agents_status', 'pi_agents_list', 'pi_agents_wait', 'pi_agents_result', 'pi_agents_control', 'pi_agents_review']); assert.equal(h.registered.command.name, 'subagents'); assert.deepEqual(Object.keys(h.registered.command), ['name', 'description', 'handler']); assert.equal(typeof h.handlers.session_start, 'function');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('ensure recupera lifecycle después de STORAGE_BUSY y permite otra base y reintento', { timeout: 10000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-parent-native-busy-'));
  const previousDir = process.env.PI_AGENTS_STATE_DIR;
  process.env.PI_AGENTS_STATE_DIR = join(directory, 'pi-agents', 'sessions');
  const ctx = context(directory);
  let sessionId = 'one';
  ctx.sessionManager.getSessionId = () => sessionId;
  const h = host(ctx, t);
  let lease;
  try {
    lease = await acquireLease(join(directory, 'pi-agents', 'sessions', 'one.sqlite'));
    registerPiAgents(h.pi, { getAgentDir: () => directory, createModels: async () => createModels(), resolveModel: () => ({}), text: value => value, Type: { Object: x => x, String: () => ({}) }, version: 'test' });
    const list = h.registered.tools.find(tool => tool.name === 'pi_agents_list');
    await assert.rejects(list.execute('first', {}, undefined, undefined, ctx), error => error?.error?.code === 'STORAGE_BUSY');
    sessionId = 'two';
    assert.notEqual((await list.execute('second', {}, undefined, undefined, ctx)).isError, true);
    await lease.release();
    sessionId = 'one';
    assert.notEqual((await list.execute('third', {}, undefined, undefined, ctx)).isError, true);
  } finally {
    try { await h.close(); await lease?.release(); await rm(directory, { recursive: true, force: true }); }
    finally { if (previousDir === undefined) delete process.env.PI_AGENTS_STATE_DIR; else process.env.PI_AGENTS_STATE_DIR = previousDir; }
  }
});

for (const phase of ['createModels', 'openRuntime']) {
  test(`cambio de sesión durante ${phase} no publica ni notifica el runtime obsoleto`, { timeout: 10000 }, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'pi-parent-native-opening-'));
    const previousDir = process.env.PI_AGENTS_STATE_DIR;
    process.env.PI_AGENTS_STATE_DIR = join(directory, 'pi-agents', 'sessions');
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    const models = createModels();
    const faux = fauxProvider();
    faux.setResponses([fauxAssistantMessage([fauxText('resultado anterior')])]);
    models.setProvider(faux.provider);
    const firstCtx = context(directory);
    firstCtx.sessionManager.getSessionId = () => 'one';
    const nextCtx = context(directory);
    nextCtx.sessionManager.getSessionId = () => 'two';
    const h = host(firstCtx, t);
    let fixture, mock, opening, next;
    try {
      const settled = Promise.withResolvers();
      fixture = await openSessionRuntime({ storagePath: join(directory, 'pi-agents', 'sessions', 'one.sqlite'), models, context: background, defaultCwd: directory, maxConcurrency: 1, createId: () => 'old-child', onSettled: async () => settled.resolve() });
      const admitted = await fixture.jobs.start({ requestId: 'seed', actor: { kind: 'model' }, intent: { agent: 'test-agent', task: 'seed', cwd: directory } }, async task => ({ ...legacyInput(task.task), cwd: directory }));
      assert.equal(admitted.success, true);
      await settled.promise;
      await fixture.close();
      if (phase === 'openRuntime') {
        const originalOpen = Harness.open;
        let first = true;
        mock = t.mock.method(Harness, 'open', async (...args) => {
          const harness = await originalOpen(...args);
          if (first) { first = false; entered.resolve(); await release.promise; }
          return harness;
        });
      }
      let first = true;
      registerPiAgents(h.pi, { getAgentDir: () => directory, createModels: async () => {
        if (phase === 'createModels' && first) { first = false; entered.resolve(); await release.promise; }
        return models;
      }, resolveModel: () => ({}), text: value => value, Type: { Object: x => x, String: () => ({}) }, version: 'test' });
      opening = h.handlers.session_start({}, firstCtx);
      await entered.promise;
      next = h.handlers.session_start({}, nextCtx);
      release.resolve();
      await Promise.all([opening, next]);
      assert.equal(h.entries.filter(entry => entry.type === 'pi-agents-notice' && entry.data.jobId === 'old-child').length, 0);
      assert.notEqual((await h.registered.tools.find(tool => tool.name === 'pi_agents_list').execute('current', {}, undefined, undefined, nextCtx)).isError, true);
    } finally {
      release.resolve();
      await opening;
      await next;
      try {
        await h.close();
        await fixture?.close();
        mock?.mock.restore();
        await rm(directory, { recursive: true, force: true });
      } finally { if (previousDir === undefined) delete process.env.PI_AGENTS_STATE_DIR; else process.env.PI_AGENTS_STATE_DIR = previousDir; }
    }
  });
}

test('migración solo puede confirmarse desde TUI con UI real', () => {
  assert.equal(canConfirmMigration({ mode: 'tui', hasUI: true }), true); assert.equal(canConfirmMigration({ mode: 'rpc', hasUI: true }), false); assert.equal(canConfirmMigration({ mode: 'tui', hasUI: false }), false);
});

test('presentación no lee respuesta completa para status y resume con límite', () => {
  const job = { id: 'psa_1', status: 'completed', task: 'x', cwd: '/tmp', createdAt: 1, updatedAt: 2, agent: { name: 'a', source: 'personal', tools: [] }, model: { provider: 'faux', modelId: 'one' }, thinkingLevel: 'off', notified: false, resultMeta: { durationMs: 12, model: { provider: 'faux', modelId: 'two' }, status: 'completed' } };
  const view = { job, queuePosition: undefined }; assert.match(formatStatus(view), /faux\/two/); assert.match(formatResult({ ...view, result: { finalResponse: 'ok', durationMs: 12, model: job.model, status: 'completed' } }), /Respuesta final/); assert.equal(briefSummary({ finalResponse: 'abcdefgh', durationMs: 1, model: job.model, status: 'completed' }, 'completed', 5), 'abcd…');
});
