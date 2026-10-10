import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalStart } from '../src/domain/requests.ts';
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

test('retry replay parental coteja destino y no muta snapshots', async () => {
  const fixture = await makeStoreFixture({ parentAuthority: authority, createId: (() => { let n = 0; return () => `retry-${++n}`; })() });
  try {
    await fixture.seedJob({ id: 'source', ...legacyInput('tarea'), status: 'completed', createdAt: 1, updatedAt: 1, notified: true, createdBy: { kind: 'model', id: 'call:source' }, parentSessionId: 's1' }, { status: 'completed', finalResponse: 'ok', durationMs: 1, model: legacyInput('tarea').model });
    const req = { requestId: 'retry:bound', action: 'retry', actor: { kind: 'model', id: 'call:source' } };
    const first = await fixture.repository.retry('source', req, 2, authority);
    const ledgerBefore = await fixture.repository.receipt(req.requestId);
    const indexBefore = await fixture.repository.index();
    await fixture.session.commit(async tx => { const job = await tx.doc(JobDocFamily, first.retryJobId, null); job.parentSessionId = 'other'; }, BACKGROUND_CONTEXT);
    const jobBefore = await fixture.repository.get(first.retryJobId);
    const replay = await fixture.repository.retry('source', req, 3, authority).catch(error => error);
    assert.equal(replay.error?.code ?? replay.code, 'INVALID_REQUEST');
    assert.deepEqual(await fixture.repository.get(first.retryJobId), jobBefore);
    assert.deepEqual(await fixture.repository.index(), indexBefore);
    assert.deepEqual(await fixture.repository.receipt(req.requestId), ledgerBefore);
  } finally { await fixture.close(); }
});

test('replay parental positivo conserva recibo y no muta snapshots', async () => {
  const authority = Object.freeze({ sessionId: 's1', isActive: () => true });
  const fixture = await makeStoreFixture({ parentAuthority: authority, createId: () => 'positive-retry' });
  try {
    const input = legacyInput('tarea');
    await fixture.seedJob({ id: 'source', ...input, status: 'completed', createdAt: 1, updatedAt: 1, notified: true, createdBy: { kind: 'model', id: 'call:source' }, parentSessionId: 's1' }, { status: 'completed', finalResponse: 'ok', durationMs: 1, model: input.model });
    let now = 2;
    const service = createControlService(fixture.repository, () => now);
    const request = { requestId: 'retry:positive', action: 'retry', actor: { kind: 'model', id: 'call:retry' } };
    const first = await service.retry('source', request, authority);
    assert.equal(first.success, true);
    assert.equal(first.value.replayed, false);
    assert.equal(first.value.jobId, 'positive-retry');
    assert.equal(first.value.retryJobId, 'positive-retry');
    const snapshot = async () => ({
      source: await fixture.repository.get('source'),
      target: await fixture.repository.get('positive-retry'),
      index: await fixture.repository.index(),
      ledger: await fixture.repository.receipt(request.requestId),
      review: await fixture.repository.review('positive-retry'),
    });
    const before = await snapshot();
    assert.equal(before.target.parentSessionId, 's1');
    assert.equal(before.ledger.parentSessionId, 's1');
    now = 3;
    const replay = await service.retry('source', request, authority);
    assert.equal(replay.success, true);
    assert.deepEqual(replay.value, { ...first.value, replayed: true });
    assert.deepEqual(await snapshot(), before);
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

test('retry extension real conserva actor y no hereda parentSessionId', async () => {
  const fixture = await makeStoreFixture({ parentAuthority: authority, createId: () => 'extension-retry' });
  try {
    await fixture.seedJob({ id: 'source-extension', ...legacyInput('tarea'), status: 'completed', createdAt: 1, updatedAt: 1, notified: true, createdBy: { kind: 'extension', id: 'ext-1' } }, { status: 'completed', finalResponse: 'ok', durationMs: 1, model: legacyInput('tarea').model });
    const outcome = await createControlService(fixture.repository, () => 2).retry('source-extension', { requestId: 'retry:extension', action: 'retry', actor: { kind: 'extension', id: 'ext-1' } });
    assert.equal(outcome.success, true);
    assert.equal((await fixture.repository.get('extension-retry')).createdBy.id, 'ext-1');
    assert.equal((await fixture.repository.get('extension-retry')).parentSessionId, undefined);
  } finally { await fixture.close(); }
});

test('legacy replay genérico conserva ledger sin binding y retry parental no adopta', async () => {
  const fixture = await makeStoreFixture({ parentAuthority: authority, createId: () => 'legacy-retry' });
  try {
    await fixture.seedJob({ id: 'legacy-source', ...legacyInput('tarea'), status: 'completed', createdAt: 1, updatedAt: 1, notified: true, createdBy: { kind: 'model', id: 'call:legacy' } }, { status: 'completed', finalResponse: 'ok', durationMs: 1, model: legacyInput('tarea').model });
    const req = { requestId: 'retry:legacy', action: 'retry', actor: { kind: 'model', id: 'call:legacy' } };
    const first = await fixture.repository.retry('legacy-source', req, 2);
    const record = await fixture.repository.receipt(req.requestId);
    assert.equal(record.parentSessionId, undefined);
    assert.equal((await fixture.repository.retry('legacy-source', req, 3)).replayed, true);
    const native = await fixture.repository.retry('legacy-source', req, 4, authority).catch(error => error);
    assert.equal(native.error?.code ?? native.code, 'INVALID_REQUEST');
    assert.deepEqual(await fixture.repository.receipt(req.requestId), record);
    assert.equal((await fixture.repository.get(first.retryJobId)).parentSessionId, undefined);
  } finally { await fixture.close(); }
});

test('canonicalStart hash es igual con y sin contexto parental', async () => {
  const generic = await makeStoreFixture({ createId: () => 'generic' });
  const parental = await makeStoreFixture({ parentAuthority: authority, createId: () => 'parental' });
  try {
    const req = request('start:hash');
    assert.equal((await start(generic, req.requestId)).success, true);
    assert.equal((await start(parental, req.requestId, authority)).success, true);
    const expected = canonicalStart(req).payloadHash;
    assert.equal((await generic.repository.receipt(req.requestId)).payloadHash, expected);
    assert.equal((await parental.repository.receipt(req.requestId)).payloadHash, expected);
  } finally { await generic.close(); await parental.close(); }
});

test('retry origen ajeno o contexto inactivo niega sin escribir', async () => {
  const fixture = await makeStoreFixture({ parentAuthority: authority, createId: () => 'never-created' });
  try {
    await fixture.seedJob({ id: 'foreign', ...legacyInput('tarea'), status: 'completed', createdAt: 1, updatedAt: 1, notified: true, createdBy: { kind: 'model', id: 'call:foreign' }, parentSessionId: 'other' }, { status: 'completed', finalResponse: 'ok', durationMs: 1, model: legacyInput('tarea').model });
    const before = { job: await fixture.repository.get('foreign'), index: await fixture.repository.index() };
    const denied = { requestId: 'retry:denied', action: 'retry', actor: { kind: 'model', id: 'call:foreign' } };
    const foreign = await fixture.repository.retry('foreign', denied, 2, authority).catch(error => error);
    assert.equal(foreign.error?.code ?? foreign.code, 'INVALID_REQUEST');
    authority.isActive = () => false;
    const inactive = await fixture.repository.retry('foreign', { ...denied, requestId: 'retry:inactive' }, 2, authority).catch(error => error);
    assert.equal(inactive.error?.code ?? inactive.code, 'INVALID_REQUEST');
    assert.deepEqual(await fixture.repository.get('foreign'), before.job);
    assert.deepEqual(await fixture.repository.index(), before.index);
    assert.equal(await fixture.repository.receipt('retry:denied'), undefined);
    assert.equal(await fixture.repository.receipt('retry:inactive'), undefined);
  } finally { authority.isActive = () => true; await fixture.close(); }
});

test('fallo de commit real revierte admisión y sanitiza STORAGE_ERROR', async () => {
  const fixture = await makeStoreFixture({ parentAuthority: authority, createId: () => 'rollback-job' });
  try {
    fixture.failNextCommitAfterStaging();
    const outcome = await start(fixture, 'start:rollback', authority);
    assert.equal(outcome.success, false);
    assert.equal(outcome.error.code, 'STORAGE_ERROR');
    assert.deepEqual(outcome.error.details, {});
    await fixture.reopen();
    assert.equal(await fixture.repository.get('rollback-job'), undefined);
    assert.equal(await fixture.repository.index(), undefined);
    assert.equal(await fixture.repository.receipt('start:rollback'), undefined);
  } finally { await fixture.close(); }
});

test('fallo de commit real revierte retry sin ledger parcial', async () => {
  const fixture = await makeStoreFixture({ parentAuthority: authority, createId: () => 'rollback-retry' });
  try {
    await fixture.seedJob({ id: 'retry-source', ...legacyInput('tarea'), status: 'completed', createdAt: 1, updatedAt: 1, notified: true, createdBy: { kind: 'model', id: 'call:retry' }, parentSessionId: 's1' }, { status: 'completed', finalResponse: 'ok', durationMs: 1, model: legacyInput('tarea').model });
    const before = { job: await fixture.repository.get('retry-source'), index: await fixture.repository.index() };
    fixture.failNextCommitAfterStaging();
    const outcome = await createControlService(fixture.repository, () => 2).retry('retry-source', { requestId: 'retry:rollback', action: 'retry', actor: { kind: 'model', id: 'call:retry' } });
    assert.equal(outcome.success, false);
    assert.equal(outcome.error.code, 'STORAGE_ERROR');
    await fixture.reopen();
    assert.deepEqual(await fixture.repository.get('retry-source'), before.job);
    assert.deepEqual(await fixture.repository.index(), before.index);
    assert.equal(await fixture.repository.receipt('retry:rollback'), undefined);
    assert.equal(await fixture.repository.get('rollback-retry'), undefined);
  } finally { await fixture.close(); }
});
