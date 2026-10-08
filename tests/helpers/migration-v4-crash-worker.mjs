import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createBackup } from '../../src/infrastructure/storage/backup.ts';
import { acquireLease } from '../../src/infrastructure/storage/lease.ts';
import { inspectStorage } from '../../src/infrastructure/storage/inspect.ts';
import { migrateV4ToV5 } from '../../src/infrastructure/storage/migrate.ts';

const [database, mode, barrierPath] = process.argv.slice(2);

function installBeginBarrier() {
  if (!barrierPath) throw new Error('before crash requires a barrier path');
  const descriptor = Object.getOwnPropertyDescriptor(DatabaseSync.prototype, 'exec');
  if (!descriptor?.writable || !descriptor.configurable) throw new Error('DatabaseSync.prototype.exec is not patchable');
  const originalExec = DatabaseSync.prototype.exec;
  let triggered = false;
  const blocker = new Int32Array(new SharedArrayBuffer(4));
  DatabaseSync.prototype.exec = function (sql, ...args) {
    if (!triggered && sql === 'BEGIN IMMEDIATE') {
      triggered = true;
      writeFileSync(barrierPath, 'BEGIN IMMEDIATE');
      Atomics.wait(blocker, 0, 0);
    }
    return originalExec.call(this, sql, ...args);
  };
  return () => { DatabaseSync.prototype.exec = originalExec; };
}

function waitFor(point) {
  return new Promise(resolve => {
    const handler = message => {
      if (message?.point === point) {
        process.off('message', handler);
        resolve(message);
      }
    };
    process.on('message', handler);
  });
}

let lease;
let restoreExec;
try {
  lease = await acquireLease(database);
  const inspection = await inspectStorage(lease, context);
  if (inspection.kind !== 'current' || inspection.schemaVersion !== 4) throw new Error('worker requires schema4');
  process.send?.({ point: 'approval-requested', info: { dbPath: lease.dbPath, jobs: inspection.jobs, sourceHash: inspection.sourceHash } });
  await waitFor('approve');
  const approval = { requestId: `crash:${mode}`, actor: { kind: 'human', id: 'crash-test' }, dbPath: lease.dbPath, sourceHash: inspection.sourceHash, approvedAt: 3001 };
  const backup = await createBackup(lease, () => 3000);
  if (mode === 'before') {
    process.send?.({ point: 'backup-created', path: backup.path });
    await waitFor('start-migrator');
    restoreExec = installBeginBarrier();
  }
  const result = await migrateV4ToV5(lease, approval, backup, context);
  if (mode === 'post') {
    process.send?.({ point: 'postcommit', ...result });
    await waitFor('terminate');
  }
  restoreExec?.();
  restoreExec = undefined;
} catch (error) {
  process.send?.({ point: 'error', message: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
} finally {
  restoreExec?.();
  await lease?.release();
}
