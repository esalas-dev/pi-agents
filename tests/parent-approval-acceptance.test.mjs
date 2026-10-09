import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxAssistantMessage, fauxProvider, fauxText } from '@earendil-works/pi-ai/providers/faux';
import { Harness } from '@earendil-works/pi-durable';
import { openSessionRuntime } from '../src/runtime/session.ts';
import { legacyInput } from './helpers/legacy.mjs';

const actor = { kind: 'model', id: 'acceptance-tool' };
const access = { mode: 'tool', operation: 'peek', actor };
const human = { kind: 'human', id: 'tui' };

// Only capture the real SDK for worker inspection; policy/storage are never mocked.
async function fixture(t, responses) {
  const directory = await mkdtemp(join(tmpdir(), 'pi-parent-acceptance-'));
  const models = createModels();
  const faux = fauxProvider();
  faux.setResponses(responses);
  models.setProvider(faux.provider);
  let sdk, sequence = 0, settled;
  const runtimes = [];
  const originalOpen = Harness.open;
  const mock = t.mock.method(Harness, 'open', async (...args) => sdk = await originalOpen(...args));
  return {
    get sdk() { return sdk; },
    async open(sessionId = 'acceptance-parent') {
      const runtime = await openSessionRuntime({ storagePath: join(directory, 'jobs.sqlite'), models, context, sessionId,
        defaultCwd: directory, maxConcurrency: 1, createId: () => `psa_accept_${++sequence}`,
        onSettled: async () => settled?.resolve() });
      runtimes.push(runtime);
      return runtime;
    },
    async start(runtime, requestId, parental = true) {
      settled = Promise.withResolvers();
      const request = { requestId, actor, intent: { agent: 'test-agent', task: requestId, cwd: directory } };
      const admitted = await (parental ? runtime.parent : runtime.jobs).start(request, async intent => {
        const input = legacyInput(intent.task);
        input.cwd = directory;
        input.agent.tools = ['read', 'bash'];
        return input;
      });
      assert.equal(admitted.success, true);
      await settled.promise;
      return admitted.value.jobId;
    },
    async close() {
      try { for (const runtime of runtimes) await runtime.close(); await rm(directory, { recursive: true, force: true }); }
      finally { mock.mock.restore(); }
    },
  };
}

function denied(outcome, code) {
  assert.equal(outcome.success, false);
  assert.equal(outcome.error.code, code);
  assert.equal(outcome.value, undefined);
}

test('aceptación: padre propio, consumo, reopen, precedencia humana y job sin binding', { timeout: 10000 }, async t => {
  const f = await fixture(t, [fauxAssistantMessage([fauxText('resultado propio')]), fauxAssistantMessage([fauxText('sin binding')])]);
  try {
    let runtime = await f.open();
    const id = await f.start(runtime, 'acceptance:start');
    const before = (await runtime.jobs.status(id)).value.job;
    assert.equal(before.status, 'completed');
    assert.equal(before.parentSessionId, 'acceptance-parent');
    assert.deepEqual(before.createdBy, actor);
    assert.equal((await runtime.jobs.getJob(id)).value.reviewStatus, 'pending');
    denied(await runtime.jobs.getResult(id, access), 'RESULT_REVIEW_REQUIRED');
    const worker = await (await f.sdk.conversation(before.conversationId, context)).agent(context);
    assert.deepEqual(worker.tools.map(tool => tool.name), ['read', 'bash']);
    assert.equal(worker.tools.some(tool => tool.name === 'pi_agents_review'), false);
    const decision = { requestId: 'acceptance:approve', status: 'approved' };
    const approved = await runtime.parent.decideReview(id, decision);
    assert.equal(approved.success, true);
    assert.deepEqual(approved.value.decidedByActor, { kind: 'model', id: 'parent:acceptance-parent' });
    assert.equal((await runtime.jobs.getResult(id, access)).value.result.finalResponse, 'resultado propio');
    const consume = { requestId: 'acceptance:consume', actor, consumer: actor.id };
    assert.equal((await runtime.jobs.consumeResult(id, consume)).success, true);
    await runtime.close();
    runtime = await f.open();
    const reopened = (await runtime.jobs.status(id)).value.job;
    assert.equal(reopened.conversationId, before.conversationId);
    assert.equal(reopened.submissionId, before.submissionId);
    assert.deepEqual(await runtime.parent.decideReview(id, decision), approved);
    assert.equal((await runtime.jobs.decideReview(id, { requestId: 'acceptance:human-reject', status: 'rejected', actor: human })).success, true);
    denied(await runtime.parent.decideReview(id, decision), 'INVALID_REQUEST');
    denied(await runtime.jobs.consumeResult(id, consume), 'RESULT_REJECTED');
    denied(await runtime.jobs.getResult(id, { ...access, operation: 'consume', requestId: consume.requestId }), 'RESULT_REJECTED');
    await runtime.close();
    runtime = await f.open('different-parent');
    denied(await runtime.parent.decideReview(id, { requestId: 'acceptance:foreign', status: 'approved' }), 'INVALID_REQUEST');
    const unbound = await f.start(runtime, 'acceptance:unbound', false);
    assert.equal((await runtime.jobs.status(unbound)).value.job.parentSessionId, undefined);
    denied(await runtime.parent.decideReview(unbound, { requestId: 'acceptance:adopt', status: 'approved' }), 'INVALID_REQUEST');
    denied(await runtime.jobs.getResult(unbound, access), 'RESULT_REVIEW_REQUIRED');
    assert.equal((await runtime.jobs.decideReview(unbound, { requestId: 'acceptance:human-approve', status: 'approved', actor: human })).success, true);
    assert.equal((await runtime.jobs.getResult(unbound, access)).value.result.finalResponse, 'sin binding');
  } finally { await f.close(); }
});

test('aceptación: aprobar reporte fallido autoriza lectura, no convierte ejecución en éxito', { timeout: 10000 }, async t => {
  const f = await fixture(t, [async () => { throw new Error('fallo faux de aceptación'); }]);
  try {
    const runtime = await f.open();
    const id = await f.start(runtime, 'acceptance:failed');
    assert.equal((await runtime.jobs.status(id)).value.job.status, 'failed');
    denied(await runtime.jobs.getResult(id, access), 'RESULT_REVIEW_REQUIRED');
    const approved = await runtime.parent.decideReview(id, { requestId: 'acceptance:failed-report', status: 'approved', reason: 'Leer diagnóstico, no aceptar implementación' });
    assert.equal(approved.success, true);
    const out = await runtime.jobs.getResult(id, access);
    assert.equal(out.success, true);
    assert.equal(out.value.result.status, 'failed');
    assert.equal((await runtime.jobs.status(id)).value.job.status, 'failed');
  } finally { await f.close(); }
});
