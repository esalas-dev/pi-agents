import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxAssistantMessage, fauxProvider, fauxText } from '@earendil-works/pi-ai/providers/faux';
import { openSessionRuntime } from '../src/runtime/session.ts';

const waitFor = async check => { const deadline = Date.now() + 10_000; while (Date.now() < deadline) { const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 10)); } throw new Error('timeout'); };
const input = { task: 'continúa después de reabrir', cwd: process.cwd(), agent: { name: 'recovery-agent', description: 'test', systemPrompt: 'Answer.', source: 'personal', filePath: '/tmp/recovery-agent.md', tools: [] }, model: { provider: 'faux', modelId: 'faux-1' }, thinkingLevel: 'off' };

test('reanuda una generación durable tras cerrar y reabrir el runtime', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-agents-recovery-')); const database = join(directory, 'jobs.sqlite'); const models = createModels(); const faux = fauxProvider({ tokensPerSecond: 100 }); faux.setResponses([fauxAssistantMessage([fauxText('respuesta recuperada')])]); models.setProvider(faux.provider); let runtime;
  try { runtime = await openSessionRuntime({ storagePath: database, models, context: BACKGROUND_CONTEXT, defaultCwd: process.cwd(), sessionId: `test-${database}`, maxConcurrency: 1, createId: () => 'psa_recovery' }); const started = await runtime.jobs.start({ requestId: 'recovery:1', actor: { kind: 'model' }, intent: { agent: 'recovery-agent', task: input.task, cwd: process.cwd() } }, async () => input); await waitFor(async () => (await runtime.jobs.status(started.value.jobId)).value.job.status === 'completed'); await runtime.close(); runtime = await openSessionRuntime({ storagePath: database, models, context: BACKGROUND_CONTEXT, defaultCwd: process.cwd(), sessionId: `test-${database}`, maxConcurrency: 1 }); const recovered = await runtime.jobs.result('psa_recovery'); assert.equal(recovered.value.result.status, 'completed'); assert.equal(recovered.value.result.finalResponse, 'respuesta recuperada'); }
  finally { await runtime?.close(); await rm(directory, { recursive: true, force: true }); }
});
