import { join } from 'node:path';
import { createSession } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { JobConsumptionDocFamily, JobControlDocFamily, JobDocFamily, JobReviewDocFamily, JobResultDocFamily, JobsIndexDoc, StorageMetaDoc } from '../../src/infrastructure/durable/documents.ts';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';

const base = (id, status, actor = { kind: 'human', id: 'h' }) => ({ id, status, task: `task-${id}`, cwd: '/tmp/project', createdAt: 1000, updatedAt: 1000, ...(status === 'provisioning' || status === 'running' || status === 'cancelling' ? { conversationId: 1 } : {}), ...(status === 'running' ? { submissionId: 2 } : {}), ...(status === 'completed' || status === 'interrupted' || status === 'cancelled' ? { finishedAt: 1010, resultMeta: { durationMs: 10, model: { provider: 'faux', modelId: 'faux-1' }, status: status === 'completed' ? 'completed' : 'interrupted' } } : {}), agent: { name: 'agent-a', description: 'A', systemPrompt: 'p', source: 'personal', filePath: '/tmp/a', tools: [] }, model: { provider: 'faux', modelId: 'faux-1' }, thinkingLevel: 'off', createdBy: actor, notified: false });

export async function createV3Database(directory) {
  const database = join(directory, 'jobs.sqlite');
  const session = createSession(await openNodeSqliteStorage(database));
  const jobs = ['queued', 'paused', 'provisioning', 'running', 'completed', 'interrupted', 'cancelled'].map(status => base(`job-${status}`, status));
  await session.commit(async tx => {
    const meta = await tx.doc(StorageMetaDoc); meta.storageSchemaVersion = 3;
    const index = await tx.doc(JobsIndexDoc); index.storageSchemaVersion = 3;
    for (const job of jobs) {
      const stored = await tx.doc(JobDocFamily, job.id, job); Object.assign(stored, job);
      const result = job.status === 'completed' ? { status: 'completed', finalResponse: 'preserve', durationMs: 10, model: job.model } : ['interrupted', 'cancelled'].includes(job.status) ? { status: 'interrupted', finalResponse: '', durationMs: 10, model: job.model, error: 'previous' } : undefined;
      if (result) { const body = await tx.doc(JobResultDocFamily, job.id, result); Object.assign(body, result); }
      const review = await tx.doc(JobReviewDocFamily, job.id, { status: 'not_required' }); review.status = 'not_required';
      const consumption = await tx.doc(JobConsumptionDocFamily, job.id, { count: 1, requestIds: [`consume:${job.id}`] }); consumption.count = 1; consumption.requestIds = [`consume:${job.id}`];
      const control = await tx.doc(JobControlDocFamily, job.id, { events: [] }); control.events = [];
      index.summaries[job.id] = { id: job.id, status: job.status, agent: job.agent.name, createdAt: job.createdAt, updatedAt: job.updatedAt, hasResult: Boolean(result), notified: job.notified, reviewStatus: review.status };
      if (job.status === 'queued') index.order.push(job.id);
    }
  }, context);
  await session.close(context);
  return database;
}

export async function snapshotV3(database) {
  const session = createSession(await openNodeSqliteStorage(database));
  try {
    const index = await session.snapshot(JobsIndexDoc, context);
    const jobs = {};
    for (const id of Object.keys(index.summaries)) jobs[id] = { job: await session.snapshot(JobDocFamily, id, context), result: await session.snapshot(JobResultDocFamily, id, context), review: await session.snapshot(JobReviewDocFamily, id, context), consumption: await session.snapshot(JobConsumptionDocFamily, id, context), control: await session.snapshot(JobControlDocFamily, id, context) };
    return { meta: await session.snapshot(StorageMetaDoc, context), index, jobs };
  } finally { await session.close(context); }
}
