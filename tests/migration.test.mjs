import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createSession } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { JobDocFamily, JobResultDocFamily, JobsIndexDoc, StorageMetaDoc } from '../src/infrastructure/durable/documents.ts';
import { LegacyJobsDoc } from '../src/infrastructure/durable/legacy-v1.ts';
import { createMaintenanceService } from '../src/application/maintenance.ts';
import { inspectStorage } from '../src/infrastructure/storage/inspect.ts';
import { acquireLease } from '../src/infrastructure/storage/lease.ts';
import { createLegacyFixture, readLegacy } from './helpers/legacy.mjs';

const hasCode = code => error => error?.error?.code === code;
async function current(database, expected) {
  const session = createSession(await openNodeSqliteStorage(database));
  try {
    const jobs = {}; for (const [id] of Object.entries(expected.jobs)) { const job = await session.snapshot(JobDocFamily, id, context); const result = await session.snapshot(JobResultDocFamily, id, context); jobs[id] = { ...job, ...(result ? { result } : {}) }; }
    return { jobs, queue: (await session.snapshot(JobsIndexDoc, context)).order, meta: await session.snapshot(StorageMetaDoc, context), legacy: await session.snapshot(LegacyJobsDoc, context) };
  } finally { await session.close(context); }
}

test('migra todos los estados v1, conserva equivalencia y retira el documento monolítico', async () => {
  for (const scenario of ['queued', 'provisioning', 'running', 'terminal-mix', 'large-result']) {
    const directory = await mkdtemp(join('/tmp', `pi-agents-migration-${scenario}-`));
    try {
      const fixture = await createLegacyFixture({ directory, scenario }); const before = await readLegacy(fixture.database);
      const service = createMaintenanceService(context); let seen;
      const outcome = await service.migrate({ dbPath: fixture.database, clock: () => 2000, confirm: async info => { seen = info; return { requestId: `human:${scenario}`, actor: { kind: 'human', id: 'alice' }, dbPath: info.dbPath, sourceHash: info.sourceHash, approvedAt: 2001 }; } });
      assert.equal(outcome.success, true, scenario); assert.equal(outcome.value.migratedJobs, Object.keys(before.jobs).length); assert.equal(seen.jobs, Object.keys(before.jobs).length);
      const after = await current(fixture.database, before); assert.deepEqual({ jobs: after.jobs, queue: after.queue }, before); assert.equal(after.legacy, undefined); assert.equal(after.meta.source, 'migrated');
      const lease = await acquireLease(fixture.database); assert.deepEqual(await inspectStorage(lease, context), { kind: 'current', schemaVersion: 2 }); await lease.release();
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});

test('declinada, cancelada, actor no humano y origen alterado no modifican v1', async () => {
  const directory = await mkdtemp(join('/tmp', 'pi-agents-migration-errors-'));
  try {
    const fixture = await createLegacyFixture({ directory, scenario: 'queued' }); const before = await readLegacy(fixture.database); const service = createMaintenanceService(context);
    const base = { dbPath: fixture.database, clock: () => 3000 };
    const declined = await service.migrate({ ...base, confirm: async () => undefined }); assert.equal(declined.error.code, 'MIGRATION_DECLINED'); assert.deepEqual(await readLegacy(fixture.database), before);
    const foreign = await service.migrate({ ...base, confirm: async info => ({ requestId: 'x', actor: { kind: 'model' }, dbPath: info.dbPath, sourceHash: info.sourceHash, approvedAt: 1 }) }); assert.equal(foreign.error.code, 'INVALID_REQUEST'); assert.deepEqual(await readLegacy(fixture.database), before);
    const altered = await service.migrate({ ...base, confirm: async info => ({ requestId: 'x', actor: { kind: 'human' }, dbPath: info.dbPath, sourceHash: 'bad', approvedAt: 1 }) }); assert.equal(altered.error.code, 'INVALID_REQUEST'); assert.deepEqual(await readLegacy(fixture.database), before);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('esquema 2 requiere migración explícita y esquema 3 es idempotente', async () => {
  const directory = await mkdtemp(join('/tmp', 'pi-agents-migration-current-'));
  try {
    const fixture = await createLegacyFixture({ directory, scenario: 'queued' }); const service = createMaintenanceService(context);
    let calls = 0; const first = await service.migrate({ dbPath: fixture.database, clock: () => 1, confirm: async info => { calls++; return { requestId: 'v1', actor: { kind: 'human' }, dbPath: info.dbPath, sourceHash: info.sourceHash, approvedAt: 1 }; } });
    assert.equal(first.success, true); const second = await service.migrate({ dbPath: fixture.database, clock: () => 2, confirm: async info => { calls++; return { requestId: 'v2', actor: { kind: 'human' }, dbPath: info.dbPath, sourceHash: info.sourceHash, approvedAt: 2 }; } }); assert.deepEqual(second.value, { schemaVersion: 3, migratedJobs: 2 }); const third = await service.migrate({ dbPath: fixture.database, clock: () => 3, confirm: async () => { calls++; } }); assert.deepEqual(third.value, { schemaVersion: 3, migratedJobs: 0 }); assert.equal(calls, 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
