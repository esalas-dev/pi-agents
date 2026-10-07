import test from 'node:test';
import assert from 'node:assert/strict';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createExecution } from '../src/infrastructure/durable/execution.ts';
import { createCoordinator } from '../src/runtime/coordinator.ts';

const job = (status, extra = {}) => ({ id: `job-${status}`, status, task: 'tarea', cwd: process.cwd(), createdAt: 1000, updatedAt: 1000, agent: { name: 'a', description: 'a', systemPrompt: '', source: 'personal', filePath: '/tmp/a', tools: [] }, model: { provider: 'faux', modelId: 'faux-1' }, thinkingLevel: 'off', notified: false, ...extra });

test('aborta una conversación activa mediante la API pública y no usa internals', async () => {
  const calls = [];
  const execution = createExecution({ conversation: async id => ({ abort: async () => { calls.push(['conversation.abort', id]); } }) }, BACKGROUND_CONTEXT, new Map(), () => 2000);
  assert.equal(await execution.abort(job('running', { conversationId: 7, submissionId: 8 })), 'aborted');
  assert.deepEqual(calls, [['conversation.abort', 7]]);
});

test('usa abortSubmission si la conversación no puede abortar y marca incertidumbre si no hay confirmación', async () => {
  const calls = [];
  const execution = createExecution({
    conversation: async () => ({ abort: async () => { throw new Error('tool still running'); } }),
    abortSubmission: async (...args) => { calls.push(args); return 'aborted'; },
  }, BACKGROUND_CONTEXT, new Map(), () => 2000);
  assert.equal(await execution.abort(job('running', { conversationId: 7, submissionId: 8 })), 'aborted');
  assert.equal(calls.length, 1);
  const uncertain = createExecution({ conversation: async () => undefined }, BACKGROUND_CONTEXT, new Map(), () => 2000);
  assert.equal(await uncertain.abort(job('provisioning', { conversationId: 7 })), 'uncertain');
});

test('reconcileControls finaliza cancelación confirmada y convierte incertidumbre en interrupted', async () => {
  const jobs = [job('cancelling', { conversationId: 1, control: { pending: 'cancel', requestedAt: 1001, requestedBy: { kind: 'human' }, requestId: 'cancel:1' } }), job('cancelling', { id: 'uncertain', conversationId: 2, control: { pending: 'cancel', requestedAt: 1001, requestedBy: { kind: 'human' }, requestId: 'cancel:2' } })];
  const finished = [];
  const repository = { active: async () => jobs, finishCancelled: async (...args) => finished.push(['cancelled', ...args]), finish: async (...args) => finished.push(['interrupted', ...args]) };
  const execution = { abort: async current => current.id === 'uncertain' ? 'uncertain' : 'aborted' };
  const coordinator = createCoordinator({ repository, execution, maxConcurrency: 1, clock: () => 2002, report: error => { throw error; } });
  await coordinator.reconcileControls();
  assert.equal(finished[0][0], 'cancelled');
  assert.equal(finished[1][0], 'interrupted');
  coordinator.stop();
});
