import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createSession } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { defineDoc } from '@earendil-works/pi-durable';
import { acquireLease } from '../src/infrastructure/storage/lease.ts';
import { inspectStorage } from '../src/infrastructure/storage/inspect.ts';
import { createBackup, verifyBackup } from '../src/infrastructure/storage/backup.ts';
import { createLegacyFixture } from './helpers/legacy.mjs';
import { StorageMetaDoc } from '../src/infrastructure/durable/documents.ts';

const hasCode = code => error => error?.error?.code === code;
const FutureDoc = defineDoc({ kind: 'pi-agents.future', version: 1, scope: 'session', initial: () => ({ value: true }) });

async function currentDatabase(database) {
  const session = createSession(await openNodeSqliteStorage(database));
  try { await session.commit(async tx => { await tx.doc(StorageMetaDoc); }, context); }
  finally { await session.close(context); }
}

test('lease exclusivo rechaza alias y no borra lock ajeno', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-agents-lease-')); const database = join(directory, 'jobs.sqlite'); const alias = join(directory, 'nested', '..', 'jobs.sqlite');
  try {
    const first = await acquireLease(database);
    await assert.rejects(acquireLease(alias), hasCode('STORAGE_BUSY'));
    await first.release(); await first.release();
    const second = await acquireLease(alias); await writeFile(`${second.dbPath}.lock`, JSON.stringify({ token: 'other' }));
    await second.release();
    assert.equal(JSON.parse(await readFile(`${second.dbPath}.lock`, 'utf8')).token, 'other');
    await rm(`${second.dbPath}.lock`, { force: true }); await second.release();
    const symlinkPath = join(directory, 'link.sqlite'); await symlink(database, symlinkPath);
    await assert.rejects(acquireLease(symlinkPath), hasCode('STORAGE_INCONSISTENT'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('inspecciona base vacía, v1, actual y rechaza esquema desconocido', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-agents-inspect-'));
  try {
    const empty = join(directory, 'empty.sqlite'); const lease = await acquireLease(empty);
    assert.deepEqual(await inspectStorage(lease, context), { kind: 'empty' }); await lease.release();
    const legacy = await createLegacyFixture({ directory: join(directory, 'legacy'), scenario: 'terminal-mix' });
    const legacyLease = await acquireLease(legacy.database); const found = await inspectStorage(legacyLease, context);
    assert.equal(found.kind, 'legacy-v1'); assert.equal(found.jobs, 3); await legacyLease.release();
    const current = join(directory, 'current.sqlite'); await currentDatabase(current); const currentLease = await acquireLease(current);
    assert.deepEqual(await inspectStorage(currentLease, context), { kind: 'current', schemaVersion: 2 }); await currentLease.release();
    const future = join(directory, 'future.sqlite'); const session = createSession(await openNodeSqliteStorage(future));
    try { await session.commit(async tx => { await tx.doc(FutureDoc); }, context); } finally { await session.close(context); }
    const futureLease = await acquireLease(future); await assert.rejects(inspectStorage(futureLease, context), hasCode('STORAGE_VERSION_UNSUPPORTED')); await futureLease.release();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('backup verificado conserva la base legacy y rechaza hash alterado', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-agents-backup-'));
  try {
    const legacy = await createLegacyFixture({ directory, scenario: 'large-result' }); const lease = await acquireLease(legacy.database);
    const receipt = await createBackup(lease, () => 1234); await verifyBackup(receipt);
    assert.match(receipt.path, /\.backups\/1234-[^/]+\/backup\.sqlite$/);
    assert.notEqual(await readFile(receipt.path), undefined);
    await assert.rejects(verifyBackup({ ...receipt, sha256: 'bad' }), hasCode('BACKUP_FAILED'));
    await lease.release();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
