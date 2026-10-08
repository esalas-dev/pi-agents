import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import { registerPiAgents } from '../src/adapters/pi/register.ts';
import { openSessionRuntime } from '../src/runtime/session.ts';
import { createV3Database } from './helpers/v3.mjs';
import { createLegacyFixture } from './helpers/legacy.mjs';
import { inspectStorage } from '../src/infrastructure/storage/inspect.ts';
import { acquireLease } from '../src/infrastructure/storage/lease.ts';

function fakePi() {
  const tools = []; const commands = []; const handlers = []; const entries = [];
  return { tools, commands, handlers, entries, on(name, handler) { handlers.push({ name, handler }); }, registerTool(tool) { tools.push(tool); }, registerCommand(name, command) { commands.push({ name, ...command }); }, registerEntryRenderer() {}, appendEntry(type, data) { entries.push({ type, data }); } };
}

test('bloquea runtime en esquema 3 hasta migración explícita a esquema 5', async () => {
  const directory = await mkdtemp(join('/tmp', 'pi-agents-session-v3-'));
  try {
    const database = await createV3Database(directory);
    await assert.rejects(() => openSessionRuntime({ storagePath: database, models: {}, context, defaultCwd: process.cwd(), sessionId: `test-${database}`, maxConcurrency: 1 }), error => error?.error?.code === 'MIGRATION_REQUIRED');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('la negativa TUI detiene la cadena sin abrir runtime', async () => {
  const directory = await mkdtemp(join('/tmp', 'pi-agents-session-migration-decline-')); const fixture = await createLegacyFixture({ directory: join(directory, 'legacy'), scenario: 'queued' }); const database = join(directory, 'adapter-test.sqlite'); await copyFile(fixture.database, database);
  const previous = process.env.PI_AGENTS_STATE_DIR; process.env.PI_AGENTS_STATE_DIR = directory; const pi = fakePi(); let confirmations = 0;
  const ctx = { cwd: '/tmp/project', mode: 'tui', hasUI: true, modelRegistry: { getAll: () => [], getProvider: () => undefined }, isProjectTrusted: () => true, sessionManager: { getSessionId: () => 'adapter-test' }, ui: { notify() {}, confirm: async () => { confirmations++; return false; } } };
  try {
    registerPiAgents(pi, { getAgentDir: () => directory, createModels: async () => createModels(), resolveModel: () => ({}), text: value => value, Type: { Object: fields => ({ fields }), String: () => ({ type: 'string' }) }, version: 'test' });
    await pi.handlers.find(item => item.name === 'session_start').handler({}, ctx); const lease = await acquireLease(database); assert.equal((await inspectStorage(lease, context)).kind, 'legacy-v1'); await lease.release(); assert.equal(confirmations, 1);
  } finally { if (previous === undefined) delete process.env.PI_AGENTS_STATE_DIR; else process.env.PI_AGENTS_STATE_DIR = previous; await rm(directory, { recursive: true, force: true }); }
});

test('la TUI aprueba cada escalón 1→2→3→4→5 antes de abrir runtime', async () => {
  const directory = await mkdtemp(join('/tmp', 'pi-agents-session-migration-chain-')); const fixture = await createLegacyFixture({ directory: join(directory, 'legacy'), scenario: 'queued' }); const database = join(directory, 'adapter-test.sqlite'); await copyFile(fixture.database, database);
  const previous = process.env.PI_AGENTS_STATE_DIR; process.env.PI_AGENTS_STATE_DIR = directory; const pi = fakePi(); const confirmations = [];
  const ctx = { cwd: '/tmp/project', mode: 'tui', hasUI: true, modelRegistry: { getAll: () => [], getProvider: () => undefined }, isProjectTrusted: () => true, sessionManager: { getSessionId: () => 'adapter-test' }, ui: { notify() {}, confirm: async () => { confirmations.push(true); return true; } } };
  try {
    registerPiAgents(pi, { getAgentDir: () => directory, createModels: async () => createModels(), resolveModel: () => ({}), text: value => value, Type: { Object: fields => ({ fields }), String: () => ({ type: 'string' }) }, version: 'test' });
    await pi.handlers.find(item => item.name === 'session_start').handler({}, ctx); await pi.handlers.find(item => item.name === 'session_shutdown').handler({}, ctx);
    const lease = await acquireLease(database); assert.deepEqual(await inspectStorage(lease, context), { kind: 'current', schemaVersion: 5 }); await lease.release(); assert.equal(confirmations.length, 4);
  } finally { if (previous === undefined) delete process.env.PI_AGENTS_STATE_DIR; else process.env.PI_AGENTS_STATE_DIR = previous; await rm(directory, { recursive: true, force: true }); }
});
