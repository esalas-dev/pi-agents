import test from 'node:test';
import assert from 'node:assert/strict';
import { createParentJobsService } from '../src/application/parent.ts';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxAssistantMessage, fauxProvider, fauxText } from '@earendil-works/pi-ai/providers/faux';
import { Harness } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { JobDocFamily, JobsIndexDoc, JobReviewDocFamily } from '../src/infrastructure/durable/documents.ts';
import { registerPiAgents } from '../src/adapters/pi/register.ts';
import { makeEventBus } from './helpers/rpc.mjs';

async function nativeFixture(t, responses = []) {
  const directory = await mkdtemp(join(tmpdir(), 'pi-parent-native-'));
  await mkdir(join(directory, 'agents'));
  await writeFile(join(directory, 'agents', 'worker.md'), '---\nname: worker\ndescription: worker\nmodel: faux/faux-1\ntools: read,bash\n---\nAnswer briefly.');
  const models = createModels();
  const faux = fauxProvider();
  faux.setResponses(responses);
  models.setProvider(faux.provider);
  const ctx = { cwd: directory, mode: 'tui', hasUI: true, model: { provider: 'faux', id: 'faux-1' }, thinkingLevel: 'off', modelRegistry: { getAll: () => [], getProvider: () => undefined }, isProjectTrusted: () => true, sessionManager: { getSessionId: () => 'native-parent', getBranch: () => [] }, ui: { notify() {}, confirm: async () => true } };
  const tools = [], handlers = {}, entries = [], closures = [];
  let harness;
  const originalOpen = Harness.open;
  const mock = t.mock.method(Harness, 'open', async (...args) => {
    harness = await originalOpen(...args);
    const originalClose = harness.close.bind(harness);
    const closed = Promise.withResolvers();
    closures.push(closed.promise);
    harness.close = async (...closeArgs) => { try { await originalClose(...closeArgs); closed.resolve(); } catch (error) { closed.reject(error); throw error; } };
    return harness;
  });
  const previousDir = process.env.PI_AGENTS_STATE_DIR;
  process.env.PI_AGENTS_STATE_DIR = join(directory, 'pi-agents', 'sessions');
  registerPiAgents({ events: makeEventBus(), on: (name, fn) => { handlers[name] = fn; }, registerTool: tool => tools.push(tool), registerCommand: (_name, command) => { handlers.command = command.handler; }, registerEntryRenderer() {}, appendEntry: (type, data) => entries.push({ type, data }) }, {
    getAgentDir: () => directory, createModels: async () => models, resolveModel: () => ({ model: ctx.model }), text: value => value, Type: { Object: x => x, String: () => ({}) }, version: 'test',
  });
  const execute = (name, params, id = name) => tools.find(tool => tool.name === name).execute(id, params, undefined, undefined, ctx);
  return { directory, database: join(directory, 'pi-agents', 'sessions', 'native-parent.sqlite'), ctx, entries, handlers, execute, get harness() { return harness; }, async close() {
    try { await handlers.session_shutdown({}); await Promise.all(closures); await rm(directory, { recursive: true, force: true }); }
    finally { mock.mock.restore(); if (previousDir === undefined) delete process.env.PI_AGENTS_STATE_DIR; else process.env.PI_AGENTS_STATE_DIR = previousDir; }
  } };
}

function databaseSnapshot(db) {
  return {
    documents: db.prepare('SELECT * FROM documents ORDER BY id').all(),
    revisions: db.prepare('SELECT * FROM document_revisions ORDER BY document_id, seq').all(),
    metadata: db.prepare('SELECT * FROM durable_metadata').all(),
  };
}

test('parent facade delegates exact authority and derives model review actor', async () => {
  const authority = Object.freeze({ sessionId: 'adapter-test', isActive: () => true });
  const calls = [];
  const start = { start: async (...args) => { calls.push(['start', ...args]); return { success: true, value: 'started' }; } };
  const control = { retry: async (...args) => { calls.push(['retry', ...args]); return { success: true, value: 'retried' }; } };
  const review = { decideReview: async (...args) => { calls.push(['review', ...args]); return { success: true, value: 'reviewed' }; } };
  const service = createParentJobsService(authority, start, control, review);
  const startRequest = { requestId: 'start:1', actor: { kind: 'model', id: 'tool:1' }, intent: { agent: 'worker', task: 'do it', cwd: '/tmp' } };
  assert.equal((await service.start(startRequest, async () => ({}))).success, true);
  assert.equal((await service.retry('job-1', { requestId: 'retry:1', action: 'retry', actor: { kind: 'model', id: 'tool:2' } })).success, true);
  assert.equal((await service.decideReview('job-1', { requestId: 'review:1', status: 'approved' })).success, true);
  assert.equal(calls[0][3], authority);
  assert.equal(calls[1][3], authority);
  assert.equal(calls[2][3], authority);
  assert.deepEqual(calls[2][2], { requestId: 'review:1', status: 'approved' });
});

test('parent facade rejects non-model start/retry and review actor injection', async () => {
  const authority = Object.freeze({ sessionId: 's', isActive: () => true });
  const never = async () => { throw new Error('must not delegate'); };
  const service = createParentJobsService(authority, { start: never }, { retry: never }, { decideReview: never });
  assert.equal((await service.start({ requestId: 's', actor: { kind: 'human' }, intent: { agent: 'a', task: 'x', cwd: '/tmp' } }, async () => ({}))).error.code, 'INVALID_REQUEST');
  assert.equal((await service.retry('j', { requestId: 'r', action: 'retry', actor: { kind: 'human' } })).error.code, 'INVALID_REQUEST');
  assert.equal((await service.decideReview('j', { requestId: 'r', status: 'approved', actor: { kind: 'human' } })).error.code, 'INVALID_REQUEST');
});

test('native spawn/review usa runtime real, conserva auditoría y no da review al worker', { timeout: 10000 }, async t => {
  const f = await nativeFixture(t, [fauxAssistantMessage([fauxText('reporte propio')])]);
  try {
    const admitted = await f.execute('pi_agents', { agent: 'worker', task: 'hazlo' }, 'spawn-call');
    assert.notEqual(admitted.isError, true);
    const id = admitted.details.jobId;
    const waited = await f.execute('pi_agents_wait', { id, until: 'terminal', timeout_seconds: '5' });
    assert.notEqual(waited.isError, true);
    const job = await f.harness.snapshot(JobDocFamily, id, context);
    assert.equal(job.parentSessionId, 'native-parent');
    assert.deepEqual(job.createdBy, { kind: 'model', id: 'spawn-call' });
    const agent = await (await f.harness.conversation(job.conversationId, context)).agent(context);
    assert.deepEqual(agent.tools.map(tool => tool.name), ['read', 'bash']);
    assert.equal(agent.tools.some(tool => tool.name === 'pi_agents_review'), false);
    const blocked = await f.execute('pi_agents_result', { id, consume: '', request_id: '' });
    assert.equal(blocked.details.code, 'RESULT_REVIEW_REQUIRED');
    const approved = await f.execute('pi_agents_review', { id, status: 'approved', request_id: 'native:approve' });
    assert.notEqual(approved.isError, true);
    const review = await f.harness.snapshot(JobReviewDocFamily, id, context);
    assert.deepEqual(review.decidedByActor, { kind: 'model', id: 'parent:native-parent' });
    const result = await f.execute('pi_agents_result', { id, consume: 'true', request_id: 'native:consume' }, 'reader');
    assert.notEqual(result.isError, true);
    assert.match(result.content[0].text, /reporte propio/);
    await f.handlers.command(`reject ${id}`, f.ctx);
    const denied = await f.execute('pi_agents_review', { id, status: 'approved', request_id: 'native:override' });
    assert.equal(denied.details.code, 'INVALID_REQUEST');
    const replay = await f.execute('pi_agents_result', { id, consume: 'true', request_id: 'native:consume' }, 'reader');
    assert.equal(replay.details.code, 'RESULT_REJECTED');
    assert.equal((await f.harness.snapshot(JobReviewDocFamily, id, context)).decidedByActor.kind, 'human');
  } finally { await f.close(); }
});

test('native review rechaza cada shape inválido sin modificar docs, índice o ledger', { timeout: 10000 }, async t => {
  const f = await nativeFixture(t);
  let db;
  try {
    await f.execute('pi_agents_list', {});
    db = new DatabaseSync(f.database, { readOnly: true });
    const before = databaseSnapshot(db);
    const base = { id: 'absent', status: 'approved', request_id: 'bad' };
    const cases = [null, [], {}, { ...base, id: '' }, { ...base, id: 1 }, { ...base, status: 'pending' }, { ...base, status: null }, { ...base, request_id: '' }, { ...base, request_id: 1 }, { ...base, reason: null }, { ...base, reason: 1 }, { ...base, reason: 'x'.repeat(2049) }, { ...base, actor: { kind: 'human' } }, { ...base, parentSessionId: 'native-parent' }, { ...base, callerRole: 'parent' }, { ...base, extra: true }];
    for (const params of cases) {
      assert.equal((await f.execute('pi_agents_review', params)).isError, true);
      assert.deepEqual(databaseSnapshot(db), before);
    }
  } finally { db?.close(); await f.close(); }
});

test('native wait interpreta segundos de texto y rechaza límites/formas inválidos', { timeout: 10000 }, async t => {
  const f = await nativeFixture(t, [fauxAssistantMessage([fauxText('wait')])]);
  try {
    const admitted = await f.execute('pi_agents', { agent: 'worker', task: 'wait' });
    const id = admitted.details.jobId;
    assert.notEqual((await f.execute('pi_agents_wait', { id, until: '', timeout_seconds: '5' })).isError, true);
    for (const timeout_seconds of ['abc', '301', '-1', '1e999', null, {}, []]) {
      assert.equal((await f.execute('pi_agents_wait', { id, until: 'terminal', timeout_seconds })).details.code, 'INVALID_FILTER');
    }
  } finally { await f.close(); }
});

test('native switch/reload no espera proveedor ni envenena lifecycle con same-base busy', { timeout: 10000 }, async t => {
  const started = Promise.withResolvers();
  const response = Promise.withResolvers();
  const cleanupResponse = () => response.resolve(fauxAssistantMessage([fauxText('cleanup')]));
  t.signal.addEventListener('abort', cleanupResponse, { once: true });
  const f = await nativeFixture(t, [async () => { started.resolve(); return response.promise; }, fauxAssistantMessage([fauxText('otra sesión')])]);
  let id = 'native-parent';
  f.ctx.sessionManager.getSessionId = () => id;
  try {
    const old = await f.execute('pi_agents', { agent: 'worker', task: 'pendiente' }, 'blocked');
    assert.notEqual(old.isError, true);
    await started.promise;
    id = 'other';
    await f.handlers.session_start({}, f.ctx);
    const other = await f.execute('pi_agents', { agent: 'worker', task: 'otra' }, 'other');
    assert.notEqual(other.isError, true);
    assert.notEqual((await f.execute('pi_agents_wait', { id: other.details.jobId, until: 'terminal', timeout_seconds: '5' })).isError, true);
    assert.equal(f.entries.some(entry => entry.type === 'pi-agents-notice' && entry.data.jobId === old.details.jobId), false);
    id = 'native-parent';
    await f.handlers.session_start({}, f.ctx);
    await assert.rejects(f.execute('pi_agents_list', {}), error => error?.error?.code === 'STORAGE_BUSY');
    // Un fallo no bloquea una apertura a una tercera base.
    id = 'third';
    assert.notEqual((await f.execute('pi_agents_list', {})).isError, true);
    cleanupResponse();
  } finally { cleanupResponse(); await f.close(); }
});

test('native retry con toolCallId nuevo mantiene ownership, revela su ID y ejecuta el nuevo job', { timeout: 10000 }, async t => {
  const f = await nativeFixture(t, [fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'fallo controlado' }), fauxAssistantMessage([fauxText('retry completado')])]);
  try {
    const admitted = await f.execute('pi_agents', { agent: 'worker', task: 'retry' }, 'original-call');
    assert.notEqual(admitted.isError, true);
    const id = admitted.details.jobId;
    assert.notEqual((await f.execute('pi_agents_wait', { id, until: 'terminal', timeout_seconds: '5' })).isError, true);
    assert.equal((await f.harness.snapshot(JobDocFamily, id, context)).status, 'failed');
    // Fence the previous completion notification before retry: it must wake on its own.
    const marked = Promise.withResolvers();
    const oldCommit = f.harness.commit.bind(f.harness);
    const commit = t.mock.method(f.harness, 'commit', async (...args) => {
      const result = await oldCommit(...args);
      if ((await f.harness.snapshot(JobDocFamily, id, context)).notified) marked.resolve();
      return result;
    });
    if ((await f.harness.snapshot(JobDocFamily, id, context)).notified) marked.resolve();
    await marked.promise;
    await new Promise(resolve => setImmediate(resolve));
    commit.mock.restore();
    const retried = await f.execute('pi_agents_control', { id, action: 'retry', request_id: 'native:retry' }, 'new-call');
    assert.notEqual(retried.isError, true);
    const index = await f.harness.snapshot(JobsIndexDoc, context);
    const retryId = Object.keys(index.summaries).find(key => key !== id);
    assert.ok(retryId);
    const retry = await f.harness.snapshot(JobDocFamily, retryId, context);
    assert.equal(retry.parentSessionId, 'native-parent');
    assert.deepEqual(retry.createdBy, { kind: 'model', id: 'new-call' });
    assert.match(retried.content[0].text, new RegExp(retryId));
    assert.notEqual((await f.execute('pi_agents_wait', { id: retryId, until: 'terminal', timeout_seconds: '2' })).isError, true);
    assert.equal((await f.harness.snapshot(JobDocFamily, retryId, context)).status, 'completed');
  } finally { await f.close(); }
});
