import test from 'node:test';
import assert from 'node:assert/strict';
import { makeStoreFixture } from './helpers/store.mjs';
import { createReviewService } from '../src/application/review.ts';
import { createResultService } from '../src/application/result.ts';
import { createQueryService } from '../src/application/query.ts';

const authority = Object.freeze({ sessionId: 's1', isActive: () => true });
const job = (id, status = 'completed', parentSessionId = 's1') => ({ id, status, task: id, cwd: '/tmp/project', createdAt: 1, updatedAt: 2, finishedAt: 2, agent: { name: 'a', description: 'a', systemPrompt: 'p', source: 'personal', filePath: '/tmp/a', tools: [] }, model: { provider: 'faux', modelId: 'faux' }, thinkingLevel: 'off', notified: false, parentSessionId });
const result = (status = 'completed') => ({ finalResponse: 'body', durationMs: 1, model: { provider: 'faux', modelId: 'faux' }, status });
async function setup(status = 'completed', review = { status: 'pending' }, parent = authority) {
  const fixture = await makeStoreFixture({ parentAuthority: parent });
  await fixture.seedJob(job('child', status), result(status));
  await fixture.session.commit(async tx => { const { JobReviewDocFamily } = await import('../src/infrastructure/durable/documents.ts'); const doc = await tx.doc(JobReviewDocFamily, 'child', review); Object.assign(doc, review); }, (await import('@earendil-works/chord/context')).BACKGROUND_CONTEXT);
  const service = createReviewService(fixture.repository, () => 10);
  return { fixture, service };
}
const parentDecision = (requestId, status = 'approved', reason) => ({ requestId, status, ...(reason === undefined ? {} : { reason }) });

 test('padre propio aprueba y rechaza con actor model derivado', async () => {
  const current = await setup(); try {
    const approved = await current.service.decideReview('child', parentDecision('p1'), authority);
    assert.equal(approved.success, true); assert.deepEqual(approved.value.decidedByActor, { kind: 'model', id: 'parent:s1' });
    const rejected = await current.service.decideReview('child', parentDecision('p2', 'rejected', 'no'), authority);
    assert.equal(rejected.success, true); assert.equal(rejected.value.status, 'rejected');
  } finally { await current.fixture.close(); }
});

test('failed con resultado no implica éxito técnico', async () => {
  const current = await setup('failed');
  try {
    const out = await current.service.decideReview('child', parentDecision('p-failed'), authority);
    assert.equal(out.success, true);
    const resultService = createResultService(current.fixture.repository, createQueryService(current.fixture.repository));
    const peek = await resultService.getResult('child', { mode: 'tool', operation: 'peek', actor: { kind: 'model', id: 'm' } });
    assert.equal(peek.value.result.status, 'failed');
  } finally {
    await current.fixture.close();
  }
});

test('modelo genérico, autoridad copiada, ajena, sealed o legacy no bastan', async () => {
  const current = await setup();
  try {
    const generic = await current.service.decideReview('child', { ...parentDecision('generic'), actor: { kind: 'model', id: 'parent:s1' } });
    assert.equal(generic.error.code, 'INVALID_REQUEST');
    assert.equal((await current.service.decideReview('child', parentDecision('copy'), { ...authority })).error.code, 'INVALID_REQUEST');
    assert.equal((await current.service.decideReview('child', parentDecision('foreign'), { sessionId: 's2', isActive: () => true })).error.code, 'INVALID_REQUEST');
    current.fixture.repository.sealParent();
    assert.equal((await current.service.decideReview('child', parentDecision('sealed'), authority)).error.code, 'RUNTIME_CLOSING');
  } finally {
    await current.fixture.close();
  }
});

test('no resultado y reason 2049 son rechazados', async () => {
  const current = await setup();
  try {
    const noResult = await setup();
    await noResult.fixture.seedJob(job('none'), undefined);
    assert.equal((await noResult.service.decideReview('none', parentDecision('none'), authority)).error.code, 'RESULT_NOT_READY');
    await noResult.fixture.close();
    assert.equal((await current.service.decideReview('child', parentDecision('long', 'approved', 'x'.repeat(2049)), authority)).error.code, 'INVALID_REQUEST');
  } finally {
    await current.fixture.close();
  }
});

test('reason ausente y 2048 son válidos', async () => {
  for (const reason of [undefined, 'x'.repeat(2048)]) {
    const current = await setup();
    try {
      const out = await current.service.decideReview('child', parentDecision(`reason-${reason?.length ?? 0}`, 'approved', reason), authority);
      assert.equal(out.success, true);
    } finally {
      await current.fixture.close();
    }
  }
});

test('mismo ID con status actor o reason distintos entra en conflicto', async () => {
  const current = await setup();
  try {
    assert.equal((await current.service.decideReview('child', parentDecision('same'), authority)).success, true);
    for (const decision of [{ ...parentDecision('same', 'rejected') }, { ...parentDecision('same'), reason: 'other' }]) {
      assert.equal((await current.service.decideReview('child', decision, authority)).error.code, 'REQUEST_ID_CONFLICT');
    }
  } finally {
    await current.fixture.close();
  }
});

test('humano conserva precedencia y bloquea decisión parental posterior', async () => {
  const current = await setup();
  try {
    const human = await current.service.decideReview('child', { requestId: 'human', status: 'approved', actor: { kind: 'human', id: 'u' } });
    assert.equal(human.success, true);
    const parent = await current.service.decideReview('child', parentDecision('after-human'), authority);
    assert.equal(parent.error.code, 'INVALID_REQUEST');
  } finally {
    await current.fixture.close();
  }
});

test('same-status parental conserva fecha autor motivo pero crea ledger nuevo', async () => {
  const current = await setup();
  try {
    const first = await current.service.decideReview('child', parentDecision('first', 'approved', 'keep'), authority);
    const second = await current.service.decideReview('child', parentDecision('second', 'approved', 'new'), authority);
    assert.equal(second.value.decidedAt, first.value.decidedAt);
    assert.deepEqual(second.value.decidedByActor, first.value.decidedByActor);
    assert.equal(second.value.reason, 'keep');
    assert.equal((await current.fixture.repository.receipt('second')).requestId, 'second');
  } finally { await current.fixture.close(); }
});

test('cambio de status parental registra nueva fecha y motivo', async () => {
  const current = await setup();
  let now = 10;
  current.service = createReviewService(current.fixture.repository, () => now);
  try {
    const approved = await current.service.decideReview('child', parentDecision('approved', 'approved', 'reason-a'), authority);
    now = 20;
    const rejected = await current.service.decideReview('child', parentDecision('rejected', 'rejected', 'reason-b'), authority);
    assert.equal(rejected.value.status, 'rejected');
    assert.equal(rejected.value.decidedAt, 20);
    assert.equal(rejected.value.reason, 'reason-b');
    assert.notEqual(rejected.value.decidedAt, approved.value.decidedAt);
    now = 30;
    const restored = await current.service.decideReview('child', parentDecision('restored', 'approved', 'reason-c'), authority);
    assert.equal(restored.value.status, 'approved');
    assert.equal(restored.value.decidedAt, 30);
    assert.equal(restored.value.reason, 'reason-c');
  } finally { await current.fixture.close(); }
});

test('same-status parental sin razón conserva ausencia y auditoría anterior', async () => {
  const current = await setup();
  try {
    const first = await current.service.decideReview('child', parentDecision('without-reason', 'approved'), authority);
    const second = await current.service.decideReview('child', parentDecision('without-reason-2', 'approved', 'invented'), authority);
    assert.equal(Object.hasOwn(first.value, 'reason'), false);
    assert.equal(Object.hasOwn(second.value, 'reason'), false);
    assert.equal(second.value.decidedAt, first.value.decidedAt);
    assert.deepEqual(second.value.decidedByActor, first.value.decidedByActor);
  } finally { await current.fixture.close(); }
});

test('humano confirma status parental y cambia la autoridad', async () => {
  const current = await setup();
  try {
    assert.equal((await current.service.decideReview('child', parentDecision('parent'), authority)).success, true);
    const human = await current.service.decideReview('child', { requestId: 'human-confirm', status: 'approved', actor: { kind: 'human', id: 'parent:s1' } });
    assert.equal(human.success, true);
    assert.equal(human.value.decidedByActor.kind, 'human');
    assert.equal((await current.service.decideReview('child', parentDecision('after-human'), authority)).error.code, 'INVALID_REQUEST');
  } finally { await current.fixture.close(); }
});

test('actor humano malformado siempre es INVALID_REQUEST y no escribe', async () => {
  for (const actor of [undefined, null, [], 'human', { kind: 'unknown' }, { kind: 'human', id: 1 }, { kind: 'human', id: {} }]) {
    const current = await setup();
    try {
      const out = await current.service.decideReview('child', { requestId: `bad-${String(actor)}`, status: 'approved', actor });
      assert.equal(out.success, false);
      assert.equal(out.error.code, 'INVALID_REQUEST');
      assert.equal((await current.fixture.repository.review('child')).status, 'pending');
      assert.equal(await current.fixture.repository.receipt(`bad-${String(actor)}`), undefined);
    } finally { await current.fixture.close(); }
  }
});

test('legacy approved/rejected sin actor se considera humano', async () => {
  const current = await setup('completed', { status: 'approved', decidedAt: 3, decidedBy: 'old' });
  try {
    const out = await current.service.decideReview('child', parentDecision('legacy'), authority);
    assert.equal(out.error.code, 'INVALID_REQUEST');
  } finally {
    await current.fixture.close();
  }
});

test('reopen conserva recibo parental y permite consume aprobado', async () => {
  const current = await setup();
  try {
    const approved = await current.service.decideReview('child', parentDecision('approve'), authority);
    assert.equal(approved.success, true);
    await current.fixture.reopen();
    const reopened = createReviewService(current.fixture.repository, () => 20);
    assert.deepEqual(await reopened.decideReview('child', parentDecision('approve'), authority), approved);
    const resultService = createResultService(current.fixture.repository, createQueryService(current.fixture.repository));
    const consumed = await resultService.consumeResult('child', { requestId: 'consume', actor: { kind: 'model', id: 'm' }, consumer: 'm' });
    assert.equal(consumed.success, true);
  } finally {
    await current.fixture.close();
  }
});

test('rollback no deja review index ni ledger', async () => {
  const current = await setup();
  try {
    const beforeReview = await current.fixture.repository.review('child');
    const beforeIndex = await current.fixture.repository.index();
    const beforeReceipt = await current.fixture.repository.receipt('rollback');
    current.fixture.failNextCommitAfterStaging();
    const out = await current.service.decideReview('child', parentDecision('rollback'), authority);
    assert.equal(out.error.code, 'STORAGE_ERROR');
    await current.fixture.reopen();
    assert.deepEqual(await current.fixture.repository.review('child'), beforeReview);
    assert.deepEqual(await current.fixture.repository.index(), beforeIndex);
    assert.deepEqual(await current.fixture.repository.receipt('rollback'), beforeReceipt);
  } finally { await current.fixture.close(); }
});
