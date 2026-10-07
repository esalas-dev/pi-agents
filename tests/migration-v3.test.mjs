import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createMaintenanceService } from '../src/application/maintenance.ts';
import { inspectStorage } from '../src/infrastructure/storage/inspect.ts';
import { acquireLease } from '../src/infrastructure/storage/lease.ts';
import { createV3Database, snapshotV3 } from './helpers/v3.mjs';

test('migra esquema 3 a 4 con backup, conserva resultados/revisión/consumo y crea semillas de control', async () => {
  const directory = await mkdtemp(join('/tmp', 'pi-agents-migration-v3-'));
  try {
    const database = await createV3Database(directory); const service = createMaintenanceService(context); let info;
    const outcome = await service.migrate({ dbPath: database, clock: () => 2000, confirm: async value => { info = value; return { requestId: 'human:migrate-v3', actor: { kind: 'human', id: 'alice' }, dbPath: value.dbPath, sourceHash: value.sourceHash, approvedAt: 2001 }; } });
    assert.equal(outcome.success, true); assert.deepEqual(outcome.value, { schemaVersion: 4, migratedJobs: 7 }); assert.match(info.sourceHash, /^[a-f0-9]{64}$/);
    const after = await snapshotV3(database);
    assert.equal(after.meta.storageSchemaVersion, 4); assert.equal(after.index.storageSchemaVersion, 4);
    assert.equal(after.jobs['job-queued'].job.queueOrdinal, 1); assert.deepEqual(after.jobs['job-queued'].control, { events: [] });
    assert.equal(after.jobs['job-completed'].result.finalResponse, 'preserve'); assert.deepEqual(after.jobs['job-completed'].consumption, { count: 1, requestIds: ['consume:job-completed'] });
    const lease = await acquireLease(database); assert.deepEqual(await inspectStorage(lease, context), { kind: 'current', schemaVersion: 4 }); await lease.release();
    const repeated = await service.migrate({ dbPath: database, clock: () => 2002, confirm: async () => { throw new Error('no authorization on current schema'); } });
    assert.deepEqual(repeated.value, { schemaVersion: 4, migratedJobs: 0 });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('declinar migración 3 a 4 deja la base intacta', async () => {
  const directory = await mkdtemp(join('/tmp', 'pi-agents-migration-v3-decline-'));
  try {
    const database = await createV3Database(directory); const service = createMaintenanceService(context);
    const outcome = await service.migrate({ dbPath: database, clock: () => 2000, confirm: async () => undefined });
    assert.equal(outcome.success, false); assert.equal(outcome.error.code, 'MIGRATION_DECLINED'); assert.equal((await snapshotV3(database)).meta.storageSchemaVersion, 3);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
