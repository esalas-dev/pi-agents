import test from 'node:test';
import assert from 'node:assert/strict';
import { createStartService } from '../src/application/start.ts';
import { createControlService } from '../src/application/control.ts';
import { makeStoreFixture } from './helpers/store.mjs';
import { legacyInput } from './helpers/legacy.mjs';
import { JobDocFamily } from '../src/infrastructure/durable/documents.ts';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';

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

test('token no concede admisión a actor humano y conserva snapshots', async () => {
  const fixture = await makeStoreFixture({ parentAuthority: authority, createId: () => 'job-human' });
  try {
    const service = createStartService(fixture.repository, () => {}, () => {});
    const outcome = await service.start(request('start:human', { kind: 'human', id: 'tui' }), input, authority);
    assert.equal(outcome.success, false);
    assert.equal(outcome.error.code, 'INVALID_REQUEST');
    assert.equal(await fixture.repository.get('job-human'), undefined);
    assert.equal(await fixture.repository.index(), undefined);
    assert.equal(await fixture.repository.receipt('start:human'), undefined);
  } finally { await fixture.close(); }
});

test('token no concede admisión a extension ni system', async () => {
  for (const kind of ['extension', 'system']) {
    const fixture = await makeStoreFixture({ parentAuthority: authority, createId: () => `job-${kind}` });
    try {
      const service = createStartService(fixture.repository, () => {}, () => {});
      const outcome = await service.start(request(`start:${kind}`, { kind, id: kind }), input, authority);
      assert.equal(outcome.success, false);
      assert.equal(outcome.error.code, 'INVALID_REQUEST');
      assert.equal(await fixture.repository.get(`job-${kind}`), undefined);
      assert.equal(await fixture.repository.receipt(`start:${kind}`), undefined);
    } finally { await fixture.close(); }
  }
});

test('sellado durante resolve impide admisión y no escribe', async () => {
  const fixture = await makeStoreFixture({ parentAuthority: authority, createId: () => 'job-blocked' });
  try {
    const service = createStartService(fixture.repository, () => {}, () => {});
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const resolving = service.start(request('start:blocked'), async intent => {
      await gate;
      return legacyInput(intent.task);
    }, authority);
    service.seal();
    release();
    const outcome = await resolving;
    assert.equal(outcome.success, false);
    assert.equal(outcome.error.code, 'RUNTIME_CLOSING');
    assert.equal(await fixture.repository.get('job-blocked'), undefined);
    assert.equal(await fixture.repository.receipt('start:blocked'), undefined);
  } finally { await fixture.close(); }
});

test('replay revalida autoridad después de leer snapshot', async () => {
  const fixture = await makeStoreFixture({ parentAuthority: authority, createId: () => 'job-replay' });
  try {
    assert.equal((await start(fixture, 'start:replay', authority)).success, true);
    const original = fixture.session.snapshot.bind(fixture.session);
    const active = authority.isActive;
    fixture.session.snapshot = async (...args) => {
      const value = await original(...args);
      authority.isActive = () => false;
      return value;
    };
    const replay = await start(fixture, 'start:replay', authority);
    assert.equal(replay.success, false);
    assert.equal(replay.error.code, 'INVALID_REQUEST');
    assert.equal((await fixture.repository.get('job-replay')).parentSessionId, 's1');
    authority.isActive = active;
  } finally { authority.isActive = () => true; await fixture.close(); }
});

test('replay rechaza vínculo ledger/job discordante sin mutar ownership', async () => {
  const fixture = await makeStoreFixture({ parentAuthority: authority, createId: () => 'job-mismatch' });
  try {
    assert.equal((await start(fixture, 'start:mismatch', authority)).success, true);
    await fixture.session.commit(async tx => {
      const job = await tx.doc(JobDocFamily, 'job-mismatch', null);
      job.parentSessionId = 's2';
    }, BACKGROUND_CONTEXT);
    const replay = await start(fixture, 'start:mismatch', authority);
    assert.equal(replay.success, false);
    assert.equal(replay.error.code, 'INVALID_REQUEST');
    assert.equal((await fixture.repository.get('job-mismatch')).parentSessionId, 's2');
  } finally { await fixture.close(); }
});

test('todos los awaiters de drain observan el fin del storage', async () => {
  const fixture = await makeStoreFixture({ parentAuthority: authority });
  try {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const original = fixture.session.snapshot.bind(fixture.session);
    fixture.session.snapshot = async (...args) => { await gate; return original(...args); };
    const read = fixture.repository.receipt('absent', authority);
    let firstDone = false;
    let secondDone = false;
    const first = fixture.repository.drainParent().then(() => { firstDone = true; });
    const second = fixture.repository.drainParent().then(() => { secondDone = true; });
    release();
    await read;
    await Promise.all([first, second]);
    assert.equal(firstDone, true);
    assert.equal(secondDone, true);
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
