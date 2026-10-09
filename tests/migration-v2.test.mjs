import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createSession } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createMaintenanceService } from '../src/application/maintenance.ts';
import { inspectStorage } from '../src/infrastructure/storage/inspect.ts';
import { acquireLease } from '../src/infrastructure/storage/lease.ts';
import { JobConsumptionDocFamily, JobDocFamily, JobReviewDocFamily, JobResultDocFamily, JobsIndexDoc, StorageMetaDoc } from '../src/infrastructure/durable/documents.ts';

const makeJob = (id, actor, status = 'queued') => ({ id, status, task: `task-${id}`, cwd: '/tmp/project', createdAt: 1000, updatedAt: 1000, ...(status === 'completed' ? { finishedAt: 1010, resultMeta: { durationMs: 10, model: { provider: 'faux', modelId: 'faux-1' }, status: 'completed' } } : {}), agent: { name: 'agent-a', description: 'A', systemPrompt: 'p', source: 'personal', filePath: '/tmp/a', tools: [] }, model: { provider: 'faux', modelId: 'faux-1' }, thinkingLevel: 'off', createdBy: actor, notified: false });
const completedResult = { finalResponse: 'result', durationMs: 10, model: { provider: 'faux', modelId: 'faux-1' }, status: 'completed' };

async function createV2Database(directory) {
  const database = join(directory, 'jobs.sqlite');
  const session = createSession(await openNodeSqliteStorage(database));
  await session.commit(async tx => {
    await tx.doc(StorageMetaDoc);
    const index = await tx.doc(JobsIndexDoc);
    for (const job of [makeJob('human-job', { kind: 'human', id: 'h' }), makeJob('model-job', { kind: 'model', id: 'm' }), makeJob('done-job', { kind: 'model', id: 'm' }, 'completed')]) {
      const stored = await tx.doc(JobDocFamily, job.id, job); Object.assign(stored, job);
      if (job.status === 'completed') { const result = await tx.doc(JobResultDocFamily, job.id, completedResult); Object.assign(result, completedResult); }
      index.summaries[job.id] = { id: job.id, status: job.status, agent: job.agent.name, createdAt: job.createdAt, updatedAt: job.updatedAt, hasResult: job.status === 'completed', notified: job.notified };
      if (job.status === 'queued') index.order.push(job.id);
    }
  }, context);
  await session.close(context);
  return database;
}

async function snapshots(database) {
  const session = createSession(await openNodeSqliteStorage(database));
  try {
    const index = await session.snapshot(JobsIndexDoc, context);
    const jobs = {};
    for (const id of Object.keys(index.summaries)) jobs[id] = { review: await session.snapshot(JobReviewDocFamily, id, context), consumption: await session.snapshot(JobConsumptionDocFamily, id, context), result: await session.snapshot(JobResultDocFamily, id, context) };
    return { meta: await session.snapshot(StorageMetaDoc, context), index, jobs };
  } finally { await session.close(context); }
}

test('migra esquema 2 a 3 con autorización, backup y documentos separados', async () => {
  const directory = await mkdtemp(join('/tmp', 'pi-agents-migration-v2-'));
  try {
    const database = await createV2Database(directory); const service = createMaintenanceService(context); let info;
    const outcome = await service.migrate({ dbPath: database, clock: () => 2000, confirm: async value => { info = value; return { requestId: 'human:migrate-v2', actor: { kind: 'human', id: 'alice' }, dbPath: value.dbPath, sourceHash: value.sourceHash, approvedAt: 2001 }; } });
    assert.equal(outcome.success, true); assert.deepEqual(outcome.value, { schemaVersion: 3, migratedJobs: 3 }); assert.equal(info.jobs, 3); assert.match(info.sourceHash, /^[a-f0-9]{64}$/);
    const after = await snapshots(database);
    assert.equal(after.meta.storageSchemaVersion, 3); assert.deepEqual(after.index.order, ['human-job', 'model-job']);
    assert.equal(after.jobs['human-job'].review.status, 'not_required');
    assert.equal(after.jobs['model-job'].review.status, 'pending');
    assert.deepEqual(after.jobs['done-job'].consumption, { count: 0, requestIds: [] });
    assert.equal(after.jobs['done-job'].result.finalResponse, 'result');
    const lease = await acquireLease(database); assert.deepEqual(await inspectStorage(lease, context), { kind: 'current', schemaVersion: 3 }); await lease.release();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('declinada no modifica esquema 2 y esquema 5 es idempotente', async () => {
  const directory = await mkdtemp(join('/tmp', 'pi-agents-migration-v2-errors-'));
  try {
    const database = await createV2Database(directory); const service = createMaintenanceService(context); let calls = 0;
    const declined = await service.migrate({ dbPath: database, clock: () => 2000, confirm: async () => { calls++; return undefined; } });
    assert.equal(declined.success, false); assert.equal(declined.error.code, 'MIGRATION_DECLINED'); assert.equal((await snapshots(database)).meta.storageSchemaVersion, 2);
    const approved = await service.migrate({ dbPath: database, clock: () => 2000, confirm: async value => ({ requestId: 'human:migrate-v2', actor: { kind: 'human' }, dbPath: value.dbPath, sourceHash: value.sourceHash, approvedAt: 2001 }) });
    assert.equal(approved.success, true);
    const upgraded = await service.migrate({ dbPath: database, clock: () => 2001, confirm: async value => ({ requestId: 'human:migrate-v3', actor: { kind: 'human' }, dbPath: value.dbPath, sourceHash: value.sourceHash, approvedAt: 2002 }) });
    assert.deepEqual(upgraded.value, { schemaVersion: 4, migratedJobs: 3 });
    const upgraded5 = await service.migrate({ dbPath: database, clock: () => 2003, confirm: async value => ({ requestId: 'human:migrate-v4', actor: { kind: 'human' }, dbPath: value.dbPath, sourceHash: value.sourceHash, approvedAt: 2004 }) });
    assert.deepEqual(upgraded5.value, { schemaVersion: 5, migratedJobs: 3 });
    const repeated = await service.migrate({ dbPath: database, clock: () => 2005, confirm: async () => { calls++; throw new Error('no authorization on current schema'); } });
    assert.deepEqual(repeated.value, { schemaVersion: 5, migratedJobs: 0 }); assert.equal(calls, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
