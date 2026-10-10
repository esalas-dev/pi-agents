import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import { basename, dirname } from 'node:path';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxAssistantMessage, fauxProvider, fauxText } from '@earendil-works/pi-ai/providers/faux';
import { createSession } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createMaintenanceService } from '../src/application/maintenance.ts';
import { openSessionRuntime } from '../src/runtime/session.ts';
import { createJobRepository } from '../src/infrastructure/durable/repository.ts';
import { canonicalStart } from '../src/domain/requests.ts';
import { inspectStorage } from '../src/infrastructure/storage/inspect.ts';
import { acquireLease } from '../src/infrastructure/storage/lease.ts';
import { createBackup } from '../src/infrastructure/storage/backup.ts';
import { migrateV4ToV5 } from '../src/infrastructure/storage/migrate.ts';
import { JobDocFamily, JobResultDocFamily, JobReviewDocFamily, JobsIndexDoc, RequestLedgerDocFamily, StorageMetaDoc } from '../src/infrastructure/durable/documents.ts';
import { OutboxEventDocFamily, OutboxMetaDoc, OutboxPageDocFamily } from '../src/infrastructure/durable/outbox-documents.ts';
import { createV4Database, createV4RecoveryDatabase, ledgerKey, snapshotDocuments } from './helpers/v4.mjs';

async function publicSnapshot(database) {
  const session = createSession(await openNodeSqliteStorage(database));
  try {
    const index = await session.snapshot(JobsIndexDoc, context);
    const jobs = {};
    for (const id of Object.keys(index.summaries)) jobs[id] = { job: await session.snapshot(JobDocFamily, id, context), result: await session.snapshot(JobResultDocFamily, id, context) };
    return {
      meta: await session.snapshot(StorageMetaDoc, context), index, jobs,
      queuedReceipt: await session.snapshot(RequestLedgerDocFamily, ledgerKey('request:queued'), context),
      orphanLedger: await session.snapshot(RequestLedgerDocFamily, ledgerKey('orphan-ledger'), context),
      outbox: await session.snapshot(OutboxMetaDoc, context),
      event: await session.snapshot(OutboxEventDocFamily, '1', context), page: await session.snapshot(OutboxPageDocFamily, '0', context),
    };
  } finally { await session.close(context); }
}

async function nextMessage(worker, timeoutMs = 5000) {
  let timer;
  try {
    return await Promise.race([
      once(worker, 'message').then(([message]) => message),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('migration worker message timeout')), timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function waitForBarrier(path, timeoutMs = 5000) {
  const name = basename(path);
  const directory = dirname(path);
  let watcher;
  let timer;
  let settled = false;
  return new Promise((resolve, reject) => {
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      watcher?.close();
      error ? reject(error) : resolve();
    };
    const check = () => readFile(path, 'utf8').then(value => {
      if (value === 'BEGIN IMMEDIATE') finish();
    }).catch(error => {
      if (error?.code !== 'ENOENT') finish(error);
    });
    try {
      watcher = watch(directory, (_, filename) => {
        if (String(filename) === name) check();
      });
    } catch (error) {
      finish(error);
      return;
    }
    timer = setTimeout(() => finish(new Error('migration BEGIN IMMEDIATE barrier timeout')), timeoutMs);
    access(path).then(check).catch(error => {
      if (error?.code !== 'ENOENT') finish(error);
    });
  });
}

async function stopWorker(worker, timeoutMs = 5000) {
  if (!worker) return [undefined, undefined];
  if (worker.exitCode === null && worker.signalCode === null) {
    const exited = once(worker, 'exit').then(([code, signal]) => [code, signal]);
    worker.kill('SIGKILL');
    let timer;
    try {
      return await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('migration worker cleanup timeout')), timeoutMs); })]);
    } finally { clearTimeout(timer); }
  }
  return [worker.exitCode, worker.signalCode];
}

async function runMigrationCrash(mode) {
  const directory = await mkdtemp(`/tmp/pi-agents-migration-v4-crash-${mode}-`);
  const fixture = await createV4Database(directory);
  const before = await snapshotDocuments(fixture.database);
  let worker;
  const barrier = `${directory}/begin-immediate.barrier`;
  try {
    worker = fork(new URL('./helpers/migration-v4-crash-worker.mjs', import.meta.url), [fixture.database, mode, barrier], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const request = await nextMessage(worker);
    assert.equal(request.point, 'approval-requested');
    assert.equal(request.info.jobs, 3);
    worker.send({ point: 'approve' });
    if (mode === 'before') {
      const backup = await nextMessage(worker);
      assert.equal(backup.point, 'backup-created');
      worker.send({ point: 'start-migrator' });
      await waitForBarrier(barrier);
      assert.equal(await readFile(barrier, 'utf8'), 'BEGIN IMMEDIATE');
      assert.equal(worker.exitCode, null);
    } else {
      const committed = await nextMessage(worker);
      assert.deepEqual(committed, { point: 'postcommit', schemaVersion: 5, migratedJobs: 3 });
    }
    const [code, signal] = await stopWorker(worker);
    assert.equal(code, null);
    assert.equal(signal, 'SIGKILL');
    const lockPath = `${fixture.database}.lock`;
    const lock = JSON.parse(await readFile(lockPath, 'utf8'));
    assert.equal(lock.pid, worker.pid);
    assert.equal(lock.dbPath, await realpath(fixture.database));
    await assert.rejects(acquireLease(fixture.database), error => error?.error?.code === 'STORAGE_BUSY');
    await rm(lockPath);
    await assert.rejects(access(lockPath), error => error?.code === 'ENOENT');
    const lease = await acquireLease(fixture.database);
    try {
      if (mode === 'before') assert.deepEqual(await inspectStorage(lease, context), { kind: 'current', schemaVersion: 4 });
      else assert.deepEqual(await inspectStorage(lease, context), { kind: 'current', schemaVersion: 5 });
    } finally {
      await lease.release();
    }
    const reopened = await publicSnapshot(fixture.database);
    const full = await snapshotDocuments(fixture.database);
    return { before, reopened, full };
  } catch (error) {
    await stopWorker(worker);
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function approved(service, database, clock = () => 2000) {
  let info;
  const outcome = await service.migrate({ dbPath: database, clock, confirm: async value => { info = value; return { requestId: 'human:migrate-v4', actor: { kind: 'human', id: 'alice' }, dbPath: value.dbPath, sourceHash: value.sourceHash, approvedAt: 2001 }; } });
  return { outcome, info };
}

test('fixture v4 válida recupera un running y repite un ledger canónico tras migrar y reabrir', { timeout: 15000 }, async () => {
  const directory = await mkdtemp('/tmp/pi-agents-migration-v4-recovery-');
  try {
    const fixture = await createV4RecoveryDatabase(directory); const service = createMaintenanceService(context);
    const { outcome } = await approved(service, fixture.database); assert.equal(outcome.success, true);
    const session = createSession(await openNodeSqliteStorage(fixture.database));
    try {
      const repository = createJobRepository(session, context, () => 2000, () => 'replay-id', 'v4-recovery');
      const replay = await repository.admit(fixture.queuedRequest, fixture.queuedInput);
      assert.deepEqual(replay, { jobId: 'queued-job', status: 'queued', agent: 'agent-queued-job' });
      assert.deepEqual(await repository.receipt('request:queued'), { requestId: 'request:queued', operation: 'start', actor: { kind: 'human', id: 'alice' }, canonicalVersion: 1, payloadHash: canonicalStart(fixture.queuedRequest).payloadHash, admittedAt: 1000, response: { jobId: 'queued-job', status: 'queued', agent: 'agent-queued-job' } });
    } finally { await session.close(context); }
    const models = createModels(); const faux = fauxProvider(); faux.setResponses([fauxAssistantMessage([fauxText('respuesta recuperada')])]); models.setProvider(faux.provider);
    const runtime = await openSessionRuntime({ storagePath: fixture.database, models, context, defaultCwd: '/tmp/project', maxConcurrency: 1, sessionId: 'v4-recovery', now: () => 3000 });
    try {
      const recovered = await runtime.jobs.waitForJob('running-job', { until: 'completed', timeoutSeconds: 5 });
      assert.equal(recovered.success, true); assert.equal(recovered.value.status, 'completed');
      const result = await runtime.jobs.result('running-job');
      assert.equal(result.success, true); assert.equal(result.value.result?.finalResponse, 'respuesta recuperada');
    } finally { await runtime.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('migra v4 a v5 una sola vez, conserva profundamente jobs y ledgers e inicializa outbox vacío', async () => {
  const directory = await mkdtemp('/tmp/pi-agents-migration-v4-');
  try {
    const fixture = await createV4Database(directory); const beforeDocs = await snapshotDocuments(fixture.database); const before = await publicSnapshot(fixture.database); const service = createMaintenanceService(context);
    const { outcome, info } = await approved(service, fixture.database);
    assert.equal(outcome.success, true); assert.deepEqual(outcome.value, { schemaVersion: 5, migratedJobs: 3 }); assert.equal(info.jobs, 3); assert.match(info.sourceHash, /^[a-f0-9]{64}$/);
    const after = await publicSnapshot(fixture.database);
    assert.equal(after.meta.storageSchemaVersion, 5); assert.equal(after.meta.source, 'migrated'); assert.equal(after.index.storageSchemaVersion, 5); assert.deepEqual(after.outbox, { nextSequence: 1, nextToEmit: 1, recent: [] }); assert.equal(after.event, undefined); assert.equal(after.page, undefined);
    assert.deepEqual(after.jobs, before.jobs); assert.deepEqual(after.index.order, before.index.order); assert.deepEqual(after.queuedReceipt, { record: fixture.ledgers[ledgerKey('request:queued')] }); assert.deepEqual(after.orphanLedger, { record: fixture.ledgers[ledgerKey('orphan-ledger')] });
    const lease = await acquireLease(fixture.database); assert.deepEqual(await inspectStorage(lease, context), { kind: 'current', schemaVersion: 5 }); await lease.release();
    const repeated = await service.migrate({ dbPath: fixture.database, clock: () => 2002, confirm: async () => { throw new Error('no authorization on schema 5'); } }); assert.deepEqual(repeated.value, { schemaVersion: 5, migratedJobs: 0 });
    const afterDocs = await snapshotDocuments(fixture.database); const unchanged = document => !['pi-agents.storage', 'pi-agents.jobs-index', 'pi-durable-subagents.outbox-meta'].includes(document.kind);
    assert.deepEqual(afterDocs.filter(unchanged), beforeDocs.filter(unchanged));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('v4→v5 conserva binding, autor de review y ledger parentales sin eventos históricos', async () => {
  const directory = await mkdtemp('/tmp/pi-agents-parent-migration-');
  try {
    const fixture = await createV4Database(directory);
    const service = createMaintenanceService(context);
    let oldHash;
    await service.migrate({ dbPath: fixture.database, clock: () => 2000, confirm: async info => { oldHash = info.sourceHash; return undefined; } });
    const session = createSession(await openNodeSqliteStorage(fixture.database));
    try {
      await session.commit(async tx => {
        const job = await tx.doc(JobDocFamily, 'completed-job', null);
        job.parentSessionId = 'migration-parent'; job.createdBy = { kind: 'model', id: 'native-call' };
        const review = await tx.doc(JobReviewDocFamily, 'completed-job', null);
        review.decidedBy = 'parent:migration-parent'; review.decidedByActor = { kind: 'model', id: 'parent:migration-parent' };
        const cell = await tx.doc(RequestLedgerDocFamily, ledgerKey('parent-review'), null);
        cell.record = { requestId: 'parent-review', operation: 'review', actor: { kind: 'model', id: 'parent:migration-parent' }, canonicalVersion: 1, payloadHash: 'historic-hash', admittedAt: 1200, parentSessionId: 'migration-parent', response: { jobId: 'completed-job', status: 'queued', agent: job.agent.name }, receipt: { jobId: 'completed-job', requestId: 'parent-review', status: 'approved', decidedAt: 1200, decidedBy: 'parent:migration-parent', decidedByActor: { kind: 'model', id: 'parent:migration-parent' } } };
      }, context);
    } finally { await session.close(context); }
    const before = await snapshotDocuments(fixture.database);
    const { outcome, info } = await approved(service, fixture.database);
    assert.equal(outcome.success, true);
    assert.notEqual(info.sourceHash, oldHash);
    const after = await snapshotDocuments(fixture.database);
    const unchanged = document => !['pi-agents.storage', 'pi-agents.jobs-index', 'pi-durable-subagents.outbox-meta'].includes(document.kind);
    assert.deepEqual(after.filter(unchanged), before.filter(unchanged));
    const snapshot = await publicSnapshot(fixture.database);
    assert.equal(snapshot.jobs['completed-job'].job.parentSessionId, 'migration-parent');
    assert.equal(snapshot.jobs['queued-job'].job.parentSessionId, undefined);
    assert.deepEqual(snapshot.outbox, { nextSequence: 1, nextToEmit: 1, recent: [] });
    assert.equal(snapshot.event, undefined);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('decline, backup corrupto, source alterado y actor no humano no modifican v4', async () => {
  const directory = await mkdtemp('/tmp/pi-agents-migration-v4-errors-');
  try {
    const fixture = await createV4Database(directory); const before = await snapshotDocuments(fixture.database); const service = createMaintenanceService(context);
    const declined = await service.migrate({ dbPath: fixture.database, clock: () => 2000, confirm: async () => undefined }); assert.equal(declined.error.code, 'MIGRATION_DECLINED'); assert.deepEqual(await snapshotDocuments(fixture.database), before);
    const foreign = await service.migrate({ dbPath: fixture.database, clock: () => 2000, confirm: async info => ({ requestId: 'foreign', actor: { kind: 'extension' }, dbPath: info.dbPath, sourceHash: info.sourceHash, approvedAt: 2001 }) }); assert.equal(foreign.error.code, 'INVALID_REQUEST'); assert.deepEqual(await snapshotDocuments(fixture.database), before);
    const altered = await service.migrate({ dbPath: fixture.database, clock: () => 2000, confirm: async info => ({ requestId: 'altered', actor: { kind: 'human' }, dbPath: info.dbPath, sourceHash: 'bad', approvedAt: 2001 }) }); assert.equal(altered.error.code, 'INVALID_REQUEST'); assert.deepEqual(await snapshotDocuments(fixture.database), before);
    const lease = await acquireLease(fixture.database); const info = await inspectStorage(lease, context); const backup = await createBackup(lease, () => 2001); await writeFile(backup.path, 'corrupted');
    await assert.rejects(migrateV4ToV5(lease, { requestId: 'corrupt-backup', actor: { kind: 'human' }, dbPath: lease.dbPath, sourceHash: info.sourceHash, approvedAt: 2002 }, backup, context), error => error?.error?.code === 'BACKUP_FAILED'); await lease.release(); assert.deepEqual(await snapshotDocuments(fixture.database), before);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('SIGKILL con barrera SQLite antes del commit reabre el snapshot v4 completo', async () => {
  const result = await runMigrationCrash('before');
  assert.deepEqual(result.full, result.before);
  assert.equal(result.reopened.meta.storageSchemaVersion, 4);
  assert.equal(result.reopened.index.storageSchemaVersion, 4);
  assert.equal(result.reopened.outbox, undefined);
  assert.deepEqual(Object.keys(result.reopened.jobs).sort(), ['completed-job', 'queued-job', 'running-job']);
});

test('SIGKILL posterior al commit real reabre el snapshot v5 completo y preserva ledgers', async () => {
  const result = await runMigrationCrash('post');
  const changed = new Set(['pi-agents.storage', 'pi-agents.jobs-index', 'pi-durable-subagents.outbox-meta']);
  assert.deepEqual(result.full.filter(document => !changed.has(document.kind)), result.before.filter(document => !changed.has(document.kind)));
  const beforeMeta = result.before.find(document => document.kind === 'pi-agents.storage').value;
  const afterMeta = result.full.find(document => document.kind === 'pi-agents.storage').value;
  assert.equal(afterMeta.storageSchemaVersion, 5);
  assert.equal(afterMeta.source, 'migrated');
  assert.equal(afterMeta.migrationRequestId, 'crash:post');
  assert.equal(afterMeta.migratedAt, 3001);
  assert.deepEqual(afterMeta.migrationActor, { kind: 'human', id: 'crash-test' });
  assert.match(afterMeta.sourceHash, /^[a-f0-9]{64}$/);
  assert.match(afterMeta.backupPath, /backup\.sqlite$/);
  assert.match(afterMeta.backupHash, /^[a-f0-9]{64}$/);
  for (const [key, value] of Object.entries(beforeMeta)) if (!['storageSchemaVersion', 'source'].includes(key)) assert.deepEqual(afterMeta[key], value);
  const beforeIndex = result.before.find(document => document.kind === 'pi-agents.jobs-index').value;
  const afterIndex = result.full.find(document => document.kind === 'pi-agents.jobs-index').value;
  assert.deepEqual(afterIndex, { ...beforeIndex, storageSchemaVersion: 5 });
  assert.deepEqual(result.full.find(document => document.kind === 'pi-durable-subagents.outbox-meta').value, { nextSequence: 1, nextToEmit: 1, recent: [] });
  assert.equal(result.full.some(document => document.kind === 'pi-durable-subagents.outbox-event'), false);
  assert.equal(result.full.some(document => document.kind === 'pi-durable-subagents.outbox-page'), false);
  assert.equal(result.reopened.meta.storageSchemaVersion, 5);
  assert.deepEqual(result.reopened.outbox, { nextSequence: 1, nextToEmit: 1, recent: [] });
  assert.deepEqual(result.reopened.queuedReceipt, { record: result.before.find(document => document.value?.record?.requestId === 'request:queued').value.record });
  assert.deepEqual(result.reopened.orphanLedger, { record: result.before.find(document => document.value?.record?.requestId === 'orphan-ledger').value.record });
});

test('future schema is rejected without opening migration', async () => {
  const directory = await mkdtemp('/tmp/pi-agents-migration-v4-future-');
  try {
    const fixture = await createV4Database(directory); const session = createSession(await openNodeSqliteStorage(fixture.database));
    await session.commit(async tx => { const meta = await tx.doc(StorageMetaDoc); meta.storageSchemaVersion = 6; const index = await tx.doc(JobsIndexDoc); index.storageSchemaVersion = 6; }, context); await session.close(context);
    const before = await snapshotDocuments(fixture.database); const service = createMaintenanceService(context); const outcome = await service.migrate({ dbPath: fixture.database, clock: () => 2000, confirm: async () => { throw new Error('future must not prompt'); } }); assert.equal(outcome.error.code, 'STORAGE_INCONSISTENT'); assert.deepEqual(await snapshotDocuments(fixture.database), before);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
