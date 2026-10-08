import test from 'node:test';
import assert from 'node:assert/strict';
import { makeStoreFixture } from './helpers/store.mjs';
import { createCoordinator } from '../src/runtime/coordinator.ts';
import { createExecution } from '../src/infrastructure/durable/execution.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxAssistantMessage, fauxProvider, fauxText } from '@earendil-works/pi-ai/providers/faux';
import { createRegistry, Harness } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { CodingTools } from '@earendil-works/pi-durable/tools';

const input = (id, status = 'queued') => ({ id, status, task: id, cwd: process.cwd(), createdAt: 1, updatedAt: 1, agent: { name: 'agent', description: '', systemPrompt: '', source: 'personal', filePath: '/tmp/a', tools: [] }, model: { provider: 'faux', modelId: 'faux-1' }, thinkingLevel: 'off', notified: false, ...(status === 'provisioning' ? { conversationId: 1 } : {}) });
const result = job => ({ finalResponse: `done:${job.id}`, durationMs: 1, model: job.model, status: 'completed' });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

 test('wake reentrante respeta slots y no duplica monitores', async () => {
  const f = await makeStoreFixture(); const gate = deferred(); let creates = 0; let waits = 0; const execution = { create: async () => ++creates, submit: async job => job.id === 'one' ? 1 : 2, wait: async job => { waits++; if (job.id === 'one') await gate.promise; return result(job); } };
  try {
    await f.repository.create(input('one')); await f.repository.create(input('two'));
    const settled = []; const c = createCoordinator({ repository: f.repository, execution, maxConcurrency: 1, clock: () => 2, onSettled: async job => settled.push(job.id), report: () => {} });
    c.wake(); c.wake(); await new Promise(r => setTimeout(r, 20));
    assert.equal(creates, 1); assert.equal((await f.repository.active()).length, 1); assert.equal(await f.repository.queuedPosition('two'), 1); assert.equal(waits, 1);
    gate.resolve(); await c.drain(); assert.deepEqual(settled, ['one']); c.stop();
  } finally { await f.close(); }
});

test('recover provisioning reenvía la solicitud durable y running espera resultado', async () => {
  const f = await makeStoreFixture(); let submissions = 0; const execution = { create: async () => 1, submit: async job => { submissions++; return job.id === 'prov' ? 55 : 56; }, wait: async job => result(job) };
  try {
    await f.seedJob(input('prov', 'provisioning')); await f.seedJob({ ...input('run', 'provisioning'), conversationId: 2 }); await f.repository.markRunning('run', 56, 1);
    const c = createCoordinator({ repository: f.repository, execution, maxConcurrency: 2, clock: () => 2, report: () => {} }); await c.recover(); await c.drain();
    assert.equal(submissions, 1); assert.equal((await f.repository.get('prov')).status, 'completed'); assert.equal((await f.repository.get('run')).status, 'completed'); c.stop();
  } finally { await f.close(); }
});

test('el driver durable crea, envía y extrae la respuesta del host real', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-agents-execution-')); const models = createModels(); const faux = fauxProvider(); faux.setResponses([fauxAssistantMessage([fauxText('respuesta real')])]); models.setProvider(faux.provider); let harness;
  try {
    harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'execution.sqlite')), { models, registry: createRegistry(), now: () => 1 }, context); const execution = createExecution(harness, context, new Map(), () => 2); const job = input('real');
    const conversationId = await harness.commit(tx => execution.create(tx, job), context); const admitted = { ...job, conversationId }; const submissionId = await execution.submit(admitted); const result = await execution.wait({ ...admitted, submissionId, status: 'running', startedAt: 1 });
    assert.equal(result.status, 'completed'); assert.equal(result.finalResponse, 'respuesta real');
  } finally { await harness?.close(context); await rm(directory, { recursive: true, force: true }); }
});

test('el driver habilita CodingTools y respeta la selección de herramientas del perfil', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-agents-tools-'));
  const registry = createRegistry(); registry.install(CodingTools);
  let harness;
  try {
    harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'tools.sqlite')), { models: createModels(), registry, settings: { extensions: [CodingTools] } }, context);
    const execution = createExecution(harness, context, new Map(CodingTools.tools.map(tool => [tool.name, tool])), () => 2);
    for (const selected of [['read', 'write', 'edit', 'bash'], ['read', 'bash'], []]) {
      const job = input('tools'); job.agent.tools = selected;
      const id = await harness.commit(tx => execution.create(tx, job), context);
      const conversation = await harness.conversation(id, context);
      const agent = await conversation.agent(context);
      assert.deepEqual(agent.extensions.map(extension => extension.name), [CodingTools.name]);
      assert.deepEqual(agent.tools.map(tool => tool.name), selected);
    }
  } finally { await harness?.close(context); await rm(directory, { recursive: true, force: true }); }
});

test('fallo de creación revierte claim sin perder el job', async () => {
  const f = await makeStoreFixture(); const errors = []; const execution = { create: async () => { throw new Error('config'); }, submit: async () => 1, wait: async job => result(job) };
  try {
    await f.repository.create(input('bad')); const c = createCoordinator({ repository: f.repository, execution, maxConcurrency: 1, clock: () => 2, report: error => errors.push(error) }); c.wake(); await c.drain();
    assert.equal((await f.repository.get('bad')).status, 'queued'); assert.equal((await f.repository.queuedPosition('bad')), 1); assert.equal(errors.length, 1); c.stop();
  } finally { await f.close(); }
});
