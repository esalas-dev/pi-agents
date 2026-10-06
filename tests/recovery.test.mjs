import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxAssistantMessage, fauxProvider, fauxText } from '@earendil-works/pi-ai/providers/faux';
import { JobManager } from '../src/jobs.ts';

const waitFor = async (check, timeout = 15_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('timeout');
};

const jobInput = {
  task: 'continúa después de reabrir',
  cwd: process.cwd(),
  agent: {
    name: 'recovery-agent', description: 'test', systemPrompt: 'Answer.',
    source: 'personal', filePath: '/tmp/recovery-agent.md', tools: [],
  },
  model: { provider: 'faux', modelId: 'faux-1' },
  thinkingLevel: 'off',
};

test('reanuda una generación durable tras cerrar y reabrir el Harness', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-agents-recovery-'));
  const database = join(directory, 'jobs.sqlite');
  const models = createModels();
  const faux = fauxProvider({ tokensPerSecond: 100 });
  const long = Array.from({ length: 120 }, (_, index) => `parte-${index}`).join(' ');
  faux.setResponses([
    fauxAssistantMessage([fauxText(long)]),
    fauxAssistantMessage([fauxText('respuesta recuperada')]),
  ]);
  models.setProvider(faux.provider);
  let manager;
  try {
    manager = await JobManager.open({
      storagePath: database, models, context: BACKGROUND_CONTEXT,
      defaultCwd: process.cwd(), maxConcurrency: 1, createId: () => 'psa_recovery',
    });
    await manager.start(jobInput);
    await waitFor(async () => (await manager.get('psa_recovery'))?.status === 'running');
    await new Promise(resolve => setTimeout(resolve, 30));
    await manager.close();

    manager = await JobManager.open({
      storagePath: database, models, context: BACKGROUND_CONTEXT,
      defaultCwd: process.cwd(), maxConcurrency: 1,
    });
    const recovered = await waitFor(async () => {
      const job = await manager.get('psa_recovery');
      return job?.status === 'completed' ? job : undefined;
    });
    assert.equal(recovered.result.status, 'completed');
    assert.ok(recovered.result.finalResponse.length > 0);
  } finally {
    await manager?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
