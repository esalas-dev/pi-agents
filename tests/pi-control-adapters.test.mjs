import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createSession } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { registerPiAgents, canConfirmMigration } from '../src/adapters/pi/register.ts';
import { makeEventBus } from './helpers/rpc.mjs';
import { formatControl } from '../src/adapters/pi/display.ts';
import { JobDocFamily, JobResultDocFamily, JobReviewDocFamily, JobsIndexDoc, StorageMetaDoc } from '../src/infrastructure/durable/documents.ts';

function fakePi() {
  const tools = []; const commands = []; const handlers = []; const entries = [];
  return { events: makeEventBus(), tools, commands, handlers, entries, on(name, handler) { handlers.push({ name, handler }); }, registerTool(tool) { tools.push(tool); }, registerCommand(name, command) { commands.push({ name, ...command }); }, registerEntryRenderer() {}, appendEntry(type, data) { entries.push({ type, data }); } };
}

test('el comando result rechaza un cancelled aunque tenga cuerpo durable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-agents-result-command-'));
  const database = join(directory, 'adapter-test.sqlite');
  const id = 'cancelled-command';
  const job = {
    id, status: 'cancelled', task: 'task', cwd: '/tmp/project', createdAt: 1000, updatedAt: 1010, finishedAt: 1010,
    agent: { name: 'agent-a', description: 'Agent A', systemPrompt: 'prompt', source: 'personal', filePath: '/tmp/a.md', tools: [] },
    model: { provider: 'faux', modelId: 'faux-1' }, thinkingLevel: 'off', notified: true,
    resultMeta: { durationMs: 10, model: { provider: 'faux', modelId: 'faux-1' }, status: 'interrupted' },
  };
  const result = { finalResponse: 'no debe revelarse', durationMs: 10, model: job.model, status: 'interrupted' };
  const storage = await openNodeSqliteStorage(database); const session = createSession(storage);
  await session.commit(async tx => {
    const meta = await tx.doc(StorageMetaDoc); meta.storageSchemaVersion = 4; meta.source = 'new';
    const index = await tx.doc(JobsIndexDoc); index.storageSchemaVersion = 4; index.summaries[id] = { id, status: job.status, agent: job.agent.name, createdAt: job.createdAt, updatedAt: job.updatedAt, hasResult: true, notified: true };
    const stored = await tx.doc(JobDocFamily, id, job); Object.assign(stored, job);
    const body = await tx.doc(JobResultDocFamily, id, result); Object.assign(body, result);
    const review = await tx.doc(JobReviewDocFamily, id, { status: 'approved' }); review.status = 'approved';
  }, BACKGROUND_CONTEXT);
  await session.close(BACKGROUND_CONTEXT);
  const previousStateDir = process.env.PI_AGENTS_STATE_DIR; process.env.PI_AGENTS_STATE_DIR = directory;
  const pi = fakePi(); const notifications = []; const ctx = { cwd: '/tmp/project', mode: 'tui', hasUI: true, modelRegistry: { getAll: () => [], getProvider: () => undefined }, isProjectTrusted: () => true, sessionManager: { getSessionId: () => 'adapter-test' }, ui: { notify: (message) => notifications.push(message), confirm: async () => true, setWidget() {} } };
  try {
    registerPiAgents(pi, { getAgentDir: () => directory, createModels: async () => createModels(), resolveModel: () => ({}), text: value => value, Type: { Object: fields => ({ fields }), String: () => ({ type: 'string' }) }, version: 'test' });
    await pi.handlers.find(item => item.name === 'session_start').handler({}, ctx);
    await pi.commands[0].handler(`result ${id}`, ctx);
    assert.equal(pi.entries.filter(entry => entry.data.title === `Resultado · ${id}`).length, 0);
    assert.deepEqual(notifications, ['El resultado todavía no está disponible.']);
    await pi.handlers.find(item => item.name === 'session_shutdown').handler({}, ctx);
  } finally {
    if (previousStateDir === undefined) delete process.env.PI_AGENTS_STATE_DIR; else process.env.PI_AGENTS_STATE_DIR = previousStateDir;
    await rm(directory, { recursive: true, force: true });
  }
});

test('registra la tool de control con request_id, acción y razón', () => {
  const pi = fakePi();
  registerPiAgents(pi, { getAgentDir: () => '/tmp', createModels: async () => ({}), resolveModel: () => ({}), text: value => value, Type: { Object: fields => ({ fields }), String: () => ({ type: 'string' }) }, version: 'test' });
  const tool = pi.tools.find(item => item.name === 'pi_agents_control');
  assert.ok(tool);
  assert.deepEqual(Object.keys(tool.parameters.fields), ['id', 'action', 'request_id', 'reason']);
  assert.equal(formatControl({ jobId: 'job-1', action: 'cancel', status: 'cancelled', replayed: false }), 'Trabajo job-1: cancel → cancelled');
  assert.equal(canConfirmMigration({ mode: 'tui', hasUI: true }), true);
  assert.equal(canConfirmMigration({ mode: 'rpc', hasUI: false }), false);
});
