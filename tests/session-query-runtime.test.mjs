import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createSession } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createModels } from '@earendil-works/pi-ai/models';
import { openSessionRuntime } from '../src/runtime/session.ts';
import { JobConsumptionDocFamily, JobDocFamily, JobReviewDocFamily, JobResultDocFamily, JobsIndexDoc, StorageMetaDoc } from '../src/infrastructure/durable/documents.ts';

const hasCode = code => error => error?.error?.code === code;
const options = storagePath => ({ storagePath, models: createModels(), context, defaultCwd: process.cwd(), maxConcurrency: 1 });
const job = { id: 'persisted', status: 'completed', task: 'done', cwd: '/tmp', createdAt: 1, updatedAt: 2, finishedAt: 2, agent: { name: 'a', description: 'A', systemPrompt: 'p', source: 'personal', filePath: '/tmp/a', tools: [] }, model: { provider: 'faux', modelId: 'faux-1' }, thinkingLevel: 'off', notified: false, resultMeta: { durationMs: 1, model: { provider: 'faux', modelId: 'faux-1' }, status: 'completed' } };
const result = { finalResponse: 'persisted result', durationMs: 1, model: { provider: 'faux', modelId: 'faux-1' }, status: 'completed' };

async function seed(database, version) {
  const session = createSession(await openNodeSqliteStorage(database));
  await session.commit(async tx => {
    const meta = await tx.doc(StorageMetaDoc); meta.storageSchemaVersion = version;
    const index = await tx.doc(JobsIndexDoc); index.storageSchemaVersion = version;
    if (version === 4) {
      const stored = await tx.doc(JobDocFamily, job.id, job); Object.assign(stored, job);
      const body = await tx.doc(JobResultDocFamily, job.id, result); Object.assign(body, result);
      const review = await tx.doc(JobReviewDocFamily, job.id, { status: 'approved' }); Object.assign(review, { status: 'approved', decidedBy: 'alice', decidedAt: 3 });
      const consumption = await tx.doc(JobConsumptionDocFamily, job.id, { count: 1, requestIds: ['consume-1'] }); Object.assign(consumption, { count: 1, requestIds: ['consume-1'] });
      index.summaries[job.id] = { id: job.id, status: job.status, agent: job.agent.name, createdAt: job.createdAt, updatedAt: job.updatedAt, hasResult: true, notified: false, reviewStatus: 'approved' };
    }
  }, context);
  await session.close(context);
}

test('base esquema 2 exige migración antes de abrir Harness y proveedor', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-agents-runtime-v2-')); const database = join(directory, 'jobs.sqlite');
  try { await seed(database, 2); await assert.rejects(openSessionRuntime(options(database)), hasCode('MIGRATION_REQUIRED')); }
  finally { await rm(directory, { recursive: true, force: true }); }
});

test('runtime schema 4 compone consulta, control, resultado y revisión tras reapertura', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-agents-runtime-v4-')); const database = join(directory, 'jobs.sqlite'); let runtime;
  try {
    await seed(database, 4); runtime = await openSessionRuntime(options(database));
    const view = await runtime.jobs.getJob('persisted'); assert.equal(view.success, true); assert.equal(view.value.reviewStatus, 'approved'); assert.equal((await runtime.jobs.listJobs({})).value.items[0].id, 'persisted');
    const resultView = await runtime.jobs.getResult('persisted', { mode: 'human', operation: 'peek', actor: { kind: 'human', id: 'alice' } }); assert.equal(resultView.success, true); assert.equal(resultView.value.result.finalResponse, 'persisted result');
    await runtime.close(); await runtime.close(); runtime = await openSessionRuntime(options(database)); assert.equal((await runtime.jobs.getJob('persisted')).value.consumption.count, 1);
  } finally { await runtime?.close(); await rm(directory, { recursive: true, force: true }); }
});
