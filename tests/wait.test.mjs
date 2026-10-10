import test from 'node:test';
import assert from 'node:assert/strict';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { makeStoreFixture } from './helpers/store.mjs';
import { createQueryService } from '../src/application/query.ts';
import { createWaitService } from '../src/application/wait.ts';

const job = (id, overrides = {}) => ({
  id,
  status: 'queued',
  task: `task-${id}`,
  cwd: '/tmp/project',
  createdAt: 1000,
  updatedAt: 1000,
  agent: { name: 'agent-a', description: 'Agent A', systemPrompt: 'prompt', source: 'personal', filePath: '/tmp/a.md', tools: [] },
  model: { provider: 'faux', modelId: 'faux-1' },
  thinkingLevel: 'off',
  notified: false,
  ...overrides,
});
const result = { finalResponse: 'done', durationMs: 10, model: { provider: 'faux', modelId: 'faux-1' }, status: 'completed' };
const pause = () => new Promise(resolve => setImmediate(resolve));

async function service(fixture) {
  return createWaitService(createQueryService(fixture.repository), fixture.session, BACKGROUND_CONTEXT);
}

test('retorna inmediatamente un job terminal y respeta until completed', async () => {
  const fixture = await makeStoreFixture();
  try {
    await fixture.seedJob(job('done', { status: 'completed', finishedAt: 1010 }), result);
    const wait = await service(fixture);
    const returned = await wait.waitForJob('done', { until: 'completed', timeoutSeconds: 1 });
    assert.equal(returned.success, true);
    assert.equal(returned.value.status, 'completed');
  } finally { await fixture.close(); }
});

test('retorna inmediatamente un job cancelled cuando until es terminal', async () => {
  const fixture = await makeStoreFixture();
  try {
    await fixture.seedJob(job('cancelled', { status: 'cancelled', finishedAt: 1010 }), { ...result, status: 'interrupted' });
    const wait = await service(fixture);
    const returned = await wait.waitForJob('cancelled', { until: 'terminal', timeoutSeconds: 300 });
    assert.equal(returned.success, true);
    assert.equal(returned.value.status, 'cancelled');
  } finally { await fixture.close(); }
});

test('observa una transición durante watchDoc sin cancelar el job', async () => {
  const fixture = await makeStoreFixture();
  try {
    await fixture.seedJob(job('running'), undefined);
    const wait = await service(fixture);
    const pending = wait.waitForJob('running', { timeoutSeconds: 1 });
    await pause();
    await fixture.seedJob(job('running', { status: 'completed', updatedAt: 1010, finishedAt: 1010 }), result);
    const returned = await pending;
    assert.equal(returned.success, true);
    assert.equal(returned.value.status, 'completed');
    assert.equal((await fixture.repository.get('running')).status, 'completed');
  } finally { await fixture.close(); }
});

test('snapshot posterior a adquirir watch cierra la carrera de transición', async () => {
  const fixture = await makeStoreFixture();
  try {
    await fixture.seedJob(job('race'), undefined);
    let calls = 0;
    const query = createQueryService(fixture.repository);
    const raceQuery = { getJob: async id => { calls++; if (calls === 2) await fixture.seedJob(job(id, { status: 'completed', finishedAt: 1010 }), result); return query.getJob(id); } };
    const wait = createWaitService(raceQuery, fixture.session, BACKGROUND_CONTEXT);
    const returned = await wait.waitForJob('race', { timeoutSeconds: 1 });
    assert.equal(returned.success, true);
    assert.equal(returned.value.status, 'completed');
  } finally { await fixture.close(); }
});

test('timeout y aborto solo cancelan la espera', async () => {
  const fixture = await makeStoreFixture();
  try {
    await fixture.seedJob(job('waiting'), undefined);
    const wait = await service(fixture);
    const timed = await wait.waitForJob('waiting', { timeoutSeconds: 0.01 });
    assert.equal(timed.success, false);
    assert.equal(timed.error.code, 'WAIT_TIMEOUT');
    const controller = new AbortController();
    const abortedPromise = wait.waitForJob('waiting', { timeoutSeconds: 1, signal: controller.signal });
    controller.abort();
    const aborted = await abortedPromise;
    assert.equal(aborted.success, false);
    assert.equal(aborted.error.code, 'WAIT_ABORTED');
    assert.equal((await fixture.repository.get('waiting')).status, 'queued');
  } finally { await fixture.close(); }
});

test('rechaza job inexistente y timeout inmediato', async () => {
  const fixture = await makeStoreFixture();
  try {
    const wait = await service(fixture);
    const missing = await wait.waitForJob('missing', { timeoutSeconds: 0 });
    assert.equal(missing.success, false);
    assert.equal(missing.error.code, 'JOB_NOT_FOUND');
    await fixture.seedJob(job('immediate'), undefined);
    const immediate = await wait.waitForJob('immediate', { timeoutSeconds: 0 });
    assert.equal(immediate.success, false);
    assert.equal(immediate.error.code, 'WAIT_TIMEOUT');
  } finally { await fixture.close(); }
});
