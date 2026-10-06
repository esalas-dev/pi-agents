import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { configure, createRegistry, createSession, Harness } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { JobsDoc } from '../fixtures/v1/jobs-v1.ts';

export function legacyInput(task) {
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

function record(id, task, status = 'queued') {
  return {
    id, ...legacyInput(task), status,
    createdAt: 1000, updatedAt: 1000, notified: false,
  };
}

function terminal(id, status, text, notified = false) {
  return {
    ...record(id, 'tarea histórica', status),
    startedAt: 1001, finishedAt: 1010, updatedAt: 1010, notified,
    result: {
      finalResponse: text, durationMs: 9,
      model: { provider: 'faux', modelId: 'faux-1' }, status,
      ...(status === 'completed' ? {} : { error: 'error histórico' }),
    },
  };
}

export async function readLegacy(database) {
  const session = createSession(await openNodeSqliteStorage(database));
  try {
    const state = await session.snapshot(JobsDoc, context);
    if (!state) throw new Error('La fixture no contiene JobsDoc v1.');
    return structuredClone(state);
  } finally { await session.close(context); }
}

export async function createLegacyFixture({ directory, scenario }) {
  if (!['queued', 'provisioning', 'running', 'terminal-mix', 'large-result'].includes(scenario)) {
    throw new Error('Escenario v1 desconocido');
  }
  await mkdir(directory, { recursive: true });
  const database = join(directory, 'legacy.sqlite');
  const models = createModels();
  const faux = fauxProvider();
  models.setProvider(faux.provider);
  let enter;
  const entered = new Promise(resolve => { enter = resolve; });
  // Only the slow provider is controlled: admission/checkpoints remain real.
  faux.setResponses([(_request, options) => new Promise((_resolve, reject) => {
    enter();
    const stop = () => reject(new Error('Fixture cerrada durante el modelo'));
    if (options?.signal?.aborted) stop();
    else options?.signal?.addEventListener('abort', stop, { once: true });
  })]);
  const harness = await Harness.open(await openNodeSqliteStorage(database), {
    models, registry: createRegistry(), now: () => 1000,
  }, context);
  let expected;
  try {
    if (scenario === 'queued') {
      expected = {
        jobs: { psa_first: record('psa_first', 'primera tarea'), psa_second: record('psa_second', 'segunda tarea') },
        queue: ['psa_second', 'psa_first'],
      };
    } else if (scenario === 'terminal-mix') {
      expected = {
        jobs: {
          psa_done: terminal('psa_done', 'completed', 'respuesta histórica'),
          psa_failed: terminal('psa_failed', 'failed', '', true),
          psa_interrupted: terminal('psa_interrupted', 'interrupted', 'salida parcial'),
        },
        queue: [],
      };
    } else if (scenario === 'large-result') {
      expected = { jobs: { psa_large: terminal('psa_large', 'completed', 'x'.repeat(1024 * 1024)) }, queue: [] };
    } else {
      const job = record('psa_active', 'continuar tras reapertura', 'provisioning');
      job.conversationId = await harness.commit(async tx => {
        const conversation = await tx.createConversation({ ownership: { kind: 'ownerless' } });
        await configure(tx, conversation.id, {
          model: job.model, thinkingLevel: job.thinkingLevel, tools: [],
          extensions: [], instructions: job.agent.systemPrompt, cwd: job.cwd,
        });
        return conversation.id;
      }, context);
      if (scenario === 'running') {
        const conversation = await harness.conversation(job.conversationId, context);
        const submission = await conversation.submit({
          type: 'input', content: job.task, requestId: 'pi-agents:psa_active',
        }, context);
        job.status = 'running';
        job.submissionId = submission.id;
        job.startedAt = 1001;
        job.updatedAt = 1001;
        await entered;
      }
      expected = { jobs: { psa_active: job }, queue: [] };
    }
    const detached = structuredClone(expected);
    await harness.commit(async tx => {
      const state = await tx.doc(JobsDoc);
      state.jobs = structuredClone(detached.jobs);
      state.queue = [...detached.queue];
    }, context);
    return { database, expected: detached };
  } finally { await harness.close(context); }
}
