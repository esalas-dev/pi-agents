import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxAssistantMessage, fauxProvider, fauxText } from '@earendil-works/pi-ai/providers/faux';
import { JobManager, publicStatus } from '../src/jobs.ts';

const waitFor = async (check, timeout = 10_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('timeout');
};

function input(task) {
  return {
    task,
    cwd: process.cwd(),
    agent: {
      name: 'test-agent', description: 'test', systemPrompt: 'Answer briefly.',
      source: 'personal', filePath: '/tmp/test-agent.md', tools: [],
    },
    model: { provider: 'faux', modelId: 'faux-1' },
    thinkingLevel: 'off',
  };
}

test('ejecuta, persiste y recupera un resultado durable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-agents-jobs-'));
  const database = join(directory, 'jobs.sqlite');
  const models = createModels();
  const faux = fauxProvider();
  faux.setResponses([fauxAssistantMessage([fauxText('resultado durable')])]);
  models.setProvider(faux.provider);
  let manager;
  try {
    manager = await JobManager.open({
      storagePath: database, models, context: BACKGROUND_CONTEXT,
      defaultCwd: process.cwd(), maxConcurrency: 1, createId: () => 'psa_test',
    });
    const started = await manager.start(input('haz la tarea'));
    assert.equal(started.status, 'queued');
    const completed = await waitFor(async () => {
      const job = await manager.get(started.id);
      return job?.status === 'completed' ? job : undefined;
    });
    assert.equal(completed.result.finalResponse, 'resultado durable');
    assert.equal(completed.result.status, 'completed');
    assert.deepEqual(completed.result.model, { provider: 'faux', modelId: 'faux-1' });
    await manager.close();

    manager = await JobManager.open({
      storagePath: database, models, context: BACKGROUND_CONTEXT,
      defaultCwd: process.cwd(), maxConcurrency: 1,
    });
    const recovered = await manager.get('psa_test');
    assert.equal(recovered.status, 'completed');
    assert.equal(recovered.result.finalResponse, 'resultado durable');
  } finally {
    await manager?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('mantiene en cola el exceso sobre la concurrencia configurada', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-agents-queue-'));
  const models = createModels();
  const faux = fauxProvider({ tokensPerSecond: 20 });
  faux.setResponses([
    fauxAssistantMessage([fauxText('primera respuesta con suficientes palabras para mantener ocupado el turno')]),
    fauxAssistantMessage([fauxText('segunda respuesta')]),
  ]);
  models.setProvider(faux.provider);
  let next = 0;
  let manager;
  try {
    manager = await JobManager.open({
      storagePath: join(directory, 'jobs.sqlite'), models, context: BACKGROUND_CONTEXT,
      defaultCwd: process.cwd(), maxConcurrency: 1, createId: () => `psa_${++next}`,
    });
    const first = await manager.start(input('primera'));
    const second = await manager.start(input('segunda'));
    await waitFor(async () => {
      const one = await manager.get(first.id);
      return one && publicStatus(one) === 'running';
    });
    const queued = await manager.get(second.id);
    assert.equal(queued.status, 'queued');
    assert.equal(await manager.queuedPosition(second.id), 1);
    await waitFor(async () => (await manager.get(first.id))?.status === 'completed');
    await waitFor(async () => (await manager.get(second.id))?.status === 'completed');
  } finally {
    await manager?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
