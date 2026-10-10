import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { configure, createRegistry, createSession, Harness } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { canonicalStart } from '../../src/domain/requests.ts';
import { JobConsumptionDocFamily, JobControlDocFamily, JobDocFamily, JobResultDocFamily, JobReviewDocFamily, JobsIndexDoc, RequestLedgerDocFamily, StorageMetaDoc } from '../../src/infrastructure/durable/documents.ts';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';

const job = (id, status, actor) => ({
  id, status, task: `private-${id}`, cwd: '/tmp/project', createdAt: 1000, updatedAt: 1100,
  ...(status === 'completed' ? { finishedAt: 1100, resultMeta: { durationMs: 100, model: { provider: 'faux', modelId: 'faux-1' }, status: 'completed' } } : {}),
  agent: { name: `agent-${id}`, description: 'private', systemPrompt: 'private', source: 'personal', filePath: `/tmp/${id}`, tools: [] },
  model: { provider: 'faux', modelId: 'faux-1' }, thinkingLevel: 'off', createdBy: actor, notified: false,
});

export const ledgerKey = requestId => createHash('sha256').update(requestId).digest('hex');

export async function createV4Database(directory) {
  const database = join(directory, 'jobs.sqlite');
  const session = createSession(await openNodeSqliteStorage(database));
  const jobs = [
    job('queued-job', 'queued', { kind: 'human', id: 'alice' }),
    job('running-job', 'running', { kind: 'model', id: 'model-1' }),
    job('completed-job', 'completed', { kind: 'extension', id: 'extension-1' }),
  ];
  const results = {
    'completed-job': { finalResponse: 'preserve exact result', durationMs: 100, model: jobs[2].model, status: 'completed' },
  };
  const ledgers = {
    [ledgerKey('request:queued')]: { requestId: 'request:queued', operation: 'start', actor: { kind: 'human', id: 'alice' }, canonicalVersion: 1, payloadHash: 'hash-queued', admittedAt: 1000, response: { jobId: 'queued-job', status: 'queued', agent: 'agent-queued-job' }, receipt: { jobId: 'queued-job', requestId: 'request:queued', marker: 'old-receipt' } },
    [ledgerKey('orphan-ledger')]: { requestId: 'orphan-ledger', operation: 'control', actor: { kind: 'model', id: 'model-1' }, canonicalVersion: 1, payloadHash: 'hash-orphan', admittedAt: 1001, response: { jobId: 'missing-job', status: 'cancelled', marker: 'orphan-receipt' }, receipt: { requestId: 'orphan-ledger', exact: ['a', { nested: true }] } },
  };
  await session.commit(async tx => {
    const meta = await tx.doc(StorageMetaDoc); meta.storageSchemaVersion = 4; meta.source = 'new';
    const index = await tx.doc(JobsIndexDoc); index.storageSchemaVersion = 4;
    for (const item of jobs) {
      const stored = await tx.doc(JobDocFamily, item.id, item); Object.assign(stored, item);
      const result = results[item.id]; if (result) { const body = await tx.doc(JobResultDocFamily, item.id, result); Object.assign(body, result); }
      const review = await tx.doc(JobReviewDocFamily, item.id, { status: item.status === 'running' ? 'pending' : 'approved' }); Object.assign(review, { status: item.status === 'running' ? 'pending' : 'approved', decidedAt: 1200, decidedBy: 'alice', reason: 'old-review' });
      const consumption = await tx.doc(JobConsumptionDocFamily, item.id, { count: 1, requestIds: [`consume:${item.id}`] }); Object.assign(consumption, { count: 1, requestIds: [`consume:${item.id}`] });
      const control = await tx.doc(JobControlDocFamily, item.id, { events: [{ action: 'pause', requestId: `control:${item.id}`, actor: { kind: 'human', id: 'alice' }, requestedAt: 1002, appliedAt: 1003, previousStatus: 'queued', nextStatus: 'paused', result: 'preserved' }] }); Object.assign(control, { events: [{ action: 'pause', requestId: `control:${item.id}`, actor: { kind: 'human', id: 'alice' }, requestedAt: 1002, appliedAt: 1003, previousStatus: 'queued', nextStatus: 'paused', result: 'preserved' }] });
      index.summaries[item.id] = { id: item.id, status: item.status, agent: item.agent.name, createdAt: item.createdAt, updatedAt: item.updatedAt, hasResult: Boolean(result), notified: item.notified, reviewStatus: review.status };
      if (item.status === 'queued') index.order.push(item.id);
    }
    for (const [key, record] of Object.entries(ledgers)) { const cell = await tx.doc(RequestLedgerDocFamily, key, { record }); cell.record = structuredClone(record); }
  }, context);
  await session.close(context);
  return { database, jobs, ledgers };
}

export async function createV4RecoveryDatabase(directory) {
  const fixture = await createV4Database(directory);
  const models = createModels(); const faux = fauxProvider();
  faux.setResponses([() => new Promise(() => {})]); models.setProvider(faux.provider);
  const harness = await Harness.open(await openNodeSqliteStorage(fixture.database), { models, registry: createRegistry() }, context);
  let conversationId; let submissionId;
  try {
    conversationId = await harness.commit(async tx => {
      const conversation = await tx.createConversation({ ownership: { kind: 'ownerless' } });
      await configure(tx, conversation.id, { model: { provider: 'faux', modelId: 'faux-1' }, thinkingLevel: 'off', tools: [], extensions: [], instructions: 'private', cwd: '/tmp/project' });
      return conversation.id;
    }, context);
    const conversation = await harness.conversation(conversationId, context);
    const submission = await conversation.submit({ type: 'input', content: 'private-running-job', requestId: 'pi-agents:running-job' }, context);
    submissionId = submission.id;
  } finally { await harness.close(context); }
  const queuedInput = { task: 'private-queued-job', cwd: '/tmp/project', agent: fixture.jobs[0].agent, model: fixture.jobs[0].model, thinkingLevel: fixture.jobs[0].thinkingLevel };
  const queued = canonicalStart({ requestId: 'request:queued', actor: { kind: 'human', id: 'alice' }, intent: { agent: queuedInput.agent.name, task: queuedInput.task, cwd: queuedInput.cwd } });
  const queuedRequest = { ...queued.normalized, payloadHash: queued.payloadHash };
  const queuedRecord = { ...fixture.ledgers[ledgerKey('request:queued')], payloadHash: queued.payloadHash };
  delete queuedRecord.receipt;
  const session = createSession(await openNodeSqliteStorage(fixture.database));
  try {
    await session.commit(async tx => {
      const job = await tx.doc(JobDocFamily, 'running-job', null); job.conversationId = conversationId; job.submissionId = submissionId; job.startedAt = 1050; job.updatedAt = 1050;
      const cell = await tx.doc(RequestLedgerDocFamily, ledgerKey('request:queued'), null); cell.record = queuedRecord;
    }, context);
  } finally { await session.close(context); }
  return { ...fixture, conversationId, submissionId, queuedRequest, queuedInput };
}

export async function snapshotDocuments(database) {
  const storage = await openNodeSqliteStorage(database);
  try {
    const documents = [];
    let cursor;
    do {
      const page = await storage.scanDocuments({ scope: { kind: 'session' }, at: 'current' }, 100, cursor, context);
      for (const record of page.items) {
        const stored = await storage.document(record.id, 'current', context);
        documents.push({ kind: record.kind, ...(record.key === undefined ? {} : { key: record.key }), value: stored?.value });
      }
      cursor = page.next;
    } while (cursor !== undefined);
    return documents.sort((a, b) => `${a.kind}/${a.key ?? ''}`.localeCompare(`${b.kind}/${b.key ?? ''}`));
  } finally { await storage.close(context); }
}
