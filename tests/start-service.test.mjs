import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { makeStoreFixture } from './helpers/store.mjs';
import { legacyInput } from './helpers/legacy.mjs';
import { createStartService } from '../src/application/start.ts';
import { createJobsService } from '../src/application/jobs.ts';

function request(task = 'haz la tarea', requestId = 'tool:1', actor = { kind: 'model' }) {
  return { requestId, actor, intent: { agent: 'test-agent', task, cwd: process.cwd() } };
}

test('admisión idempotente no resuelve dos veces y devuelve el recibo histórico', async () => {
  let next = 0; const f = await makeStoreFixture({ createId: () => `psa_${++next}` }); let wake = 0; const reports = [];
  try {
    const service = createStartService(f.repository, () => { wake++; }, error => reports.push(error));
    let resolves = 0; const resolve = async intent => { resolves++; return legacyInput(intent.task); };
    const one = await service.start(request(), resolve);
    const again = await service.start(request(), async () => { throw new Error('config changed'); });
    assert.deepEqual(again, one); assert.equal(resolves, 1); assert.equal(wake, 1); assert.deepEqual(reports, []);
    assert.equal((await f.repository.get(one.value.jobId)).status, 'queued');
    assert.equal((await service.start(request('different'), resolve)).error.code, 'REQUEST_ID_CONFLICT');
    assert.equal((await service.start(request('haz la tarea', 'tool:1', { kind: 'human' }), resolve)).error.code, 'REQUEST_ID_CONFLICT');
    assert.equal((await service.start(request('otra', 'tool:2'), resolve)).value.jobId, 'psa_2');
  } finally { await f.close(); }
});

test('admisiones concurrentes con el mismo requestId crean un solo job', async () => {
  let next = 0; const f = await makeStoreFixture({ createId: () => `psa_${++next}` });
  try {
    const service = createStartService(f.repository, () => {}, () => {});
    const input = async intent => legacyInput(intent.task);
    const results = await Promise.all([service.start(request(), input), service.start(request(), input)]);
    assert.equal(results[0].success, true); assert.equal(results[1].success, true);
    assert.equal(results[0].value.jobId, results[1].value.jobId); assert.equal((await f.repository.active()).length, 0);
    assert.equal((await f.repository.unnotified()).length, 0);
  } finally { await f.close(); }
});

test('consulta de estado no materializa resultado y reporta IDs ausentes', async () => {
  const f = await makeStoreFixture();
  try {
    const start = createStartService(f.repository, () => {}, () => {});
    const jobs = createJobsService(f.repository, start);
    assert.equal((await jobs.status('missing')).error.code, 'JOB_NOT_FOUND');
    const admitted = await start.start(request(), async intent => legacyInput(intent.task));
    const view = await jobs.status(admitted.value.jobId);
    assert.equal(view.value.job.result, undefined); assert.equal(view.value.queuePosition, 1);
    assert.equal((await jobs.result(admitted.value.jobId)).value.result, undefined);
  } finally { await f.close(); }
});

test('seal rechaza admisiones nuevas y wake errors no deshacen el commit', async () => {
  let next = 0; const f = await makeStoreFixture({ createId: () => `psa_${++next}` }); const reports = [];
  try {
    const service = createStartService(f.repository, () => { throw new Error('wake failed'); }, error => reports.push(error));
    const one = await service.start(request(), async intent => legacyInput(intent.task));
    assert.equal(one.success, true); assert.equal(reports.length, 1); assert.equal((await f.repository.get(one.value.jobId)).id, one.value.jobId);
    service.seal(); assert.equal((await service.start(request('new', 'tool:2'), async intent => legacyInput(intent.task))).error.code, 'RUNTIME_CLOSING');
  } finally { await f.close(); }
});

test('ledger existente con otra operación entra en conflicto sin mutar', async () => {
  const f = await makeStoreFixture();
  try {
    const id = createHash('sha256').update('tool:foreign').digest('hex');
    await f.seedRequest(id, { requestId: 'tool:foreign', operation: 'foreign-operation', actor: { kind: 'model' }, canonicalVersion: 1, payloadHash: 'x', admittedAt: 1, response: { jobId: 'old', status: 'queued', agent: 'old' } });
    const service = createStartService(f.repository, () => {}, () => {});
    assert.equal((await service.start(request('x', 'tool:foreign'), async intent => legacyInput(intent.task))).error.code, 'REQUEST_ID_CONFLICT');
    assert.equal((await f.repository.get('old')), undefined);
  } finally { await f.close(); }
});
