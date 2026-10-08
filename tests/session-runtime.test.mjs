import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxAssistantMessage, fauxProvider, fauxText } from '@earendil-works/pi-ai/providers/faux';
import { openSessionRuntime } from '../src/runtime/session.ts';
import { acquireLease } from '../src/infrastructure/storage/lease.ts';
import { createLegacyFixture } from './helpers/legacy.mjs';
import { legacyInput } from './helpers/legacy.mjs';

const hasCode = code => error => error?.error?.code === code;
const options = (storagePath, models = createModels()) => ({ storagePath, models, context, defaultCwd: process.cwd(), sessionId: `test-${storagePath}`, maxConcurrency: 1, now: () => 10, createId: () => 'psa_runtime' });
const request = { requestId: 'runtime:1', actor: { kind: 'model' }, intent: { agent: 'test-agent', task: 'hazlo', cwd: process.cwd() } };

 test('base legacy exige mantenimiento antes de abrir Harness', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-agents-runtime-legacy-'));
  try { const fixture = await createLegacyFixture({ directory, scenario: 'queued' }); await assert.rejects(openSessionRuntime(options(fixture.database)), hasCode('MIGRATION_REQUIRED')); }
  finally { await rm(directory, { recursive: true, force: true }); }
});

test('base vacía inicializa meta e índice y close es idempotente', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-agents-runtime-empty-')); const database = join(directory, 'jobs.sqlite');
  try { const runtime = await openSessionRuntime(options(database)); await runtime.close(); await runtime.close(); const lease = await acquireLease(database); await lease.release(); }
  finally { await rm(directory, { recursive: true, force: true }); }
});

test('runtime ejecuta jobs y un fallo de notificación no cambia completed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-agents-runtime-run-')); const database = join(directory, 'jobs.sqlite'); const models = createModels(); const faux = fauxProvider(); faux.setResponses([fauxAssistantMessage([fauxText('ok')])]); models.setProvider(faux.provider); let runtime;
  try {
    runtime = await openSessionRuntime({ ...options(database, models), onSettled: async () => { throw new Error('notify'); } }); const admitted = await runtime.jobs.start(request, async task => legacyInput(task.task)); assert.equal(admitted.success, true);
    await new Promise(resolve => setTimeout(resolve, 30)); const status = await runtime.jobs.status(admitted.value.jobId); assert.equal(status.value.job.status, 'completed');
    await runtime.close();
  } finally { await runtime?.close(); await rm(directory, { recursive: true, force: true }); }
});

test('cierre sella admisión sin dejar job admitido sin persistir', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-agents-runtime-close-')); const database = join(directory, 'jobs.sqlite');
  try { const runtime = await openSessionRuntime(options(database)); const closing = runtime.close(); const rejected = await runtime.jobs.start(request, async task => legacyInput(task.task)); await closing; assert.equal(rejected.success, false); assert.equal(rejected.error.code, 'RUNTIME_CLOSING'); }
  finally { await rm(directory, { recursive: true, force: true }); }
});
