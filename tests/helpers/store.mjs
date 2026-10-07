import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createSession } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createJobRepository } from '../../src/infrastructure/durable/repository.ts';
import { JobsIndexDoc, JobDocFamily, JobResultDocFamily, RequestLedgerDocFamily, StorageMetaDoc } from '../../src/infrastructure/durable/documents.ts';

export async function makeStoreFixture({ createId = (() => `psa_${Math.random().toString(16).slice(2)}`), parentAuthority } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'pi-agents-store-'));
  const database = join(directory, 'jobs.sqlite');
  const readKinds = [];
  let storage;
  let session;
  let repository;
  let failNextCommit = false;
  const open = async () => {
    storage = await openNodeSqliteStorage(database);
    const observed = new Proxy(storage, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (property === 'document' || property === 'findDocument') return async (...args) => {
          const token = args[0];
          readKinds.push(token?.definition?.kind);
          return value.apply(target, args);
        };
        if (property === 'commit') return async (...args) => {
          if (failNextCommit) {
            failNextCommit = false;
            throw new Error('injected commit failure after transaction staging');
          }
          return value.apply(target, args);
        };
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    session = createSession(observed);
    repository = createJobRepository(session, context, () => 2000, createId, parentAuthority);
  };
  await open();
  const close = async () => { await session?.close(context); await rm(directory, { recursive: true, force: true }); };
  const reopen = async () => { await session.close(context); await open(); };
  const seedJob = async (job, result) => {
    await session.commit(async tx => {
      const meta = await tx.doc(StorageMetaDoc);
      meta.storageSchemaVersion = 2;
      const index = await tx.doc(JobsIndexDoc);
      const storedJob = structuredClone(job);
      delete storedJob.result;
      const stored = await tx.doc(JobDocFamily, job.id, storedJob);
      Object.assign(stored, storedJob);
      if (result) {
        const body = await tx.doc(JobResultDocFamily, job.id, structuredClone(result));
        Object.assign(body, structuredClone(result));
      }
      index.summaries[job.id] = { id: job.id, status: job.status, agent: job.agent.name, createdAt: job.createdAt, updatedAt: job.updatedAt, hasResult: Boolean(result), notified: job.notified };
      if (job.status === 'queued') index.order.push(job.id);
    }, context);
  };
  const seedRequest = async (key, record) => session.commit(async tx => { const cell = await tx.doc(RequestLedgerDocFamily, key, record); cell.record = structuredClone(record); }, context);
  return { database, session, get repository() { return repository; }, close, reopen, readKinds, seedJob, seedRequest,
    failNextCommitAfterStaging() { failNextCommit = true; } };
}
