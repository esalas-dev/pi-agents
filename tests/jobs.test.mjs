import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxAssistantMessage, fauxProvider, fauxText } from '@earendil-works/pi-ai/providers/faux';
import { openSessionRuntime } from '../src/runtime/session.ts';

const waitFor = async (check, timeout = 10_000) => { const deadline = Date.now() + timeout; while (Date.now() < deadline) { const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 10)); } throw new Error('timeout'); };
const input = task => ({ task, cwd: process.cwd(), agent: { name: 'test-agent', description: 'test', systemPrompt: 'Answer briefly.', source: 'personal', filePath: '/tmp/test-agent.md', tools: [] }, model: { provider: 'faux', modelId: 'faux-1' }, thinkingLevel: 'off' });
const request = (id, task) => ({ requestId: id, actor: { kind: 'model', id }, intent: { agent: 'test-agent', task, cwd: process.cwd() } });
const options = (storagePath, models, createId, maxConcurrency = 1) => ({ storagePath, models, context: BACKGROUND_CONTEXT, defaultCwd: process.cwd(), sessionId: `test-${storagePath}`, maxConcurrency, createId });

 test('ejecuta, persiste y recupera un resultado durable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-agents-jobs-')); const database = join(directory, 'jobs.sqlite'); const models = createModels(); const faux = fauxProvider(); faux.setResponses([fauxAssistantMessage([fauxText('resultado durable')])]); models.setProvider(faux.provider); let runtime;
  try { runtime = await openSessionRuntime(options(database, models, () => 'psa_test')); const started = await runtime.jobs.start(request('tool:test', 'haz la tarea'), async intent => input(intent.task)); assert.equal(started.value.status, 'queued'); const completed = await waitFor(async () => { const view = await runtime.jobs.status(started.value.jobId); return view.success && view.value.job.status === 'completed' ? view.value.job : undefined; }); const completedResult = await runtime.jobs.result(completed.id); assert.equal(completedResult.value.result.finalResponse, 'resultado durable'); await runtime.jobs.markNotified(completed.id); assert.equal((await runtime.jobs.result(completed.id)).value.result.finalResponse, 'resultado durable'); await runtime.close(); runtime = await openSessionRuntime(options(database, models)); const recovered = await runtime.jobs.status('psa_test'); assert.equal(recovered.value.job.result, undefined); assert.equal((await runtime.jobs.result('psa_test')).value.result.finalResponse, 'resultado durable'); }
  finally { await runtime?.close(); await rm(directory, { recursive: true, force: true }); }
});

test('mantiene en cola el exceso sobre la concurrencia configurada', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-agents-queue-')); const models = createModels(); const faux = fauxProvider({ tokensPerSecond: 20 }); faux.setResponses([fauxAssistantMessage([fauxText('primera respuesta con suficientes palabras para mantener ocupado el turno')]), fauxAssistantMessage([fauxText('segunda respuesta')])]); models.setProvider(faux.provider); let next = 0; let runtime;
  try { runtime = await openSessionRuntime(options(join(directory, 'jobs.sqlite'), models, () => `psa_${++next}`)); const first = await runtime.jobs.start(request('tool:first', 'primera'), async intent => input(intent.task)); const second = await runtime.jobs.start(request('tool:second', 'segunda'), async intent => input(intent.task)); await waitFor(async () => (await runtime.jobs.status(first.value.jobId)).value.job.status === 'running'); assert.equal((await runtime.jobs.status(second.value.jobId)).value.queuePosition, 1); await waitFor(async () => (await runtime.jobs.status(first.value.jobId)).value.job.status === 'completed'); await waitFor(async () => (await runtime.jobs.status(second.value.jobId)).value.job.status === 'completed'); }
  finally { await runtime?.close(); await rm(directory, { recursive: true, force: true }); }
});
