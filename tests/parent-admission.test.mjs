import test from 'node:test';
import assert from 'node:assert/strict';
import { createStartService } from '../src/application/start.ts';
import { createControlService } from '../src/application/control.ts';
import { makeStoreFixture } from './helpers/store.mjs';
import { legacyInput } from './helpers/legacy.mjs';

const authority = { sessionId: 's1', isActive: () => true };
const request = (requestId, actor = { kind: 'model', id: `call:${requestId}` }) => ({
  requestId, actor, intent: { agent: 'test-agent', task: 'haz la tarea', cwd: process.cwd() }, parentSessionId: 'forged',
});
const input = async intent => ({ ...legacyInput(intent.task), parentSessionId: 'forged' });

async function start(fixture, requestId, parent) {
  const service = createStartService(fixture.repository, () => {}, () => {});
  return service.start(request(requestId), input, parent);
}

 test('resolver no introduce ownership', async () => {
  const fixture = await makeStoreFixture({ parentAuthority: authority, createId: () => 'job-1' });
  try {
    const outcome = await start(fixture, 'start:1', authority);
    assert.equal(outcome.success, true);
    assert.equal((await fixture.repository.get('job-1')).parentSessionId, 's1');
    assert.deepEqual((await fixture.repository.get('job-1')).createdBy, { kind: 'model', id: 'call:start:1' });
    assert.equal((await fixture.repository.receipt('start:1')).parentSessionId, 's1');
  } finally { await fixture.close(); }
});

test('replay no reasigna vínculo ni altera hash', async () => {
  const fixture = await makeStoreFixture({ parentAuthority: authority, createId: () => 'job-1' });
  try {
    const first = await start(fixture, 'start:1', authority);
    const before = await fixture.repository.receipt('start:1');
    const replay = await start(fixture, 'start:1', authority);
    assert.deepEqual(replay, first);
    assert.equal((await fixture.repository.receipt('start:1')).payloadHash, before.payloadHash);
    assert.equal((await fixture.repository.get('job-1')).parentSessionId, 's1');
  } finally { await fixture.close(); }
});

test('retry parental con tool call distinto conserva ownership autorizado', async () => {
  const fixture = await makeStoreFixture({ parentAuthority: authority, createId: () => 'retry-1' });
  try {
    await fixture.seedJob({ id: 'job-1', ...legacyInput('tarea'), status: 'completed', createdAt: 1, updatedAt: 1, notified: true, createdBy: { kind: 'model', id: 'call:old' }, parentSessionId: 's1' }, { status: 'completed', finalResponse: 'ok', durationMs: 1, model: legacyInput('tarea').model });
    const service = createControlService(fixture.repository, () => 2);
    const outcome = await service.retry('job-1', { requestId: 'retry:1', action: 'retry', actor: { kind: 'model', id: 'call:new' } }, authority);
    assert.equal(outcome.success, true);
    assert.equal((await fixture.repository.get('retry-1')).parentSessionId, 's1');
  } finally { await fixture.close(); }
});

test('retry humano/extension no hereda vínculo', async () => {
  const fixture = await makeStoreFixture({ parentAuthority: authority, createId: () => 'retry-1' });
  try {
    await fixture.seedJob({ id: 'job-1', ...legacyInput('tarea'), status: 'completed', createdAt: 1, updatedAt: 1, notified: true, createdBy: { kind: 'model', id: 'call:old' }, parentSessionId: 's1' }, { status: 'completed', finalResponse: 'ok', durationMs: 1, model: legacyInput('tarea').model });
    const service = createControlService(fixture.repository, () => 2);
    const outcome = await service.retry('job-1', { requestId: 'retry:1', action: 'retry', actor: { kind: 'human', id: 'tui' } });
    assert.equal(outcome.success, true);
    assert.equal((await fixture.repository.get('retry-1')).parentSessionId, undefined);
  } finally { await fixture.close(); }
});

test('sesión sellada no admite después de resolver', async () => {
  const fixture = await makeStoreFixture({ parentAuthority: authority, createId: () => 'job-1' });
  try {
    const service = createStartService(fixture.repository, () => {}, () => {});
    fixture.repository.sealParent();
    const outcome = await service.start(request('start:1'), input, authority);
    assert.equal(outcome.error.code, 'RUNTIME_CLOSING');
    assert.equal(await fixture.repository.receipt('start:1'), undefined);
    assert.equal(await fixture.repository.get('job-1'), undefined);
  } finally { await fixture.close(); }
});

test('referencia copiada y contexto genérico no escriben ownership', async () => {
  const fixture = await makeStoreFixture({ parentAuthority: authority, createId: () => 'job-1' });
  try {
    const copied = { ...authority };
    const denied = await start(fixture, 'start:copied', copied);
    assert.equal(denied.error.code, 'INVALID_REQUEST');
    const generic = await start(fixture, 'start:generic');
    assert.equal(generic.success, true);
    assert.equal((await fixture.repository.get('job-1')).parentSessionId, undefined);
  } finally { await fixture.close(); }
});
