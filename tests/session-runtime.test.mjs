import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxAssistantMessage, fauxProvider, fauxText } from '@earendil-works/pi-ai/providers/faux';
import { openSessionRuntime } from '../src/runtime/session.ts';
import { acquireLease } from '../src/infrastructure/storage/lease.ts';
import { Harness } from '@earendil-works/pi-durable';
import { createExecution } from '../src/infrastructure/durable/execution.ts';
import { JobDocFamily } from '../src/infrastructure/durable/documents.ts';
import { createLegacyFixture } from './helpers/legacy.mjs';
import { legacyInput } from './helpers/legacy.mjs';

const hasCode = code => error => error?.error?.code === code;
const options = (storagePath, models = createModels()) => ({ storagePath, models, context, defaultCwd: process.cwd(), maxConcurrency: 1, now: () => 10, createId: () => 'psa_runtime' });
const request = { requestId: 'runtime:1', actor: { kind: 'model' }, intent: { agent: 'test-agent', task: 'hazlo', cwd: process.cwd() } };

 test('base legacy exige mantenimiento antes de abrir Harness', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-agents-runtime-legacy-'));
  try { const fixture = await createLegacyFixture({ directory, scenario: 'queued' }); await assert.rejects(openSessionRuntime(options(fixture.database)), hasCode('MIGRATION_REQUIRED')); }
  finally { await rm(directory, { recursive: true, force: true }); }
});

test('base vacía inicializa meta e índice y close es idempotente', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-agents-runtime-empty-')); const database = join(directory, 'jobs.sqlite');
  try { const runtime = await openSessionRuntime(options(database)); assert.equal(runtime.parent, undefined); await runtime.close(); await runtime.close(); const lease = await acquireLease(database); await lease.release(); }
  finally { await rm(directory, { recursive: true, force: true }); }
});

test('runtime ejecuta jobs y un fallo de notificación no cambia completed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-agents-runtime-run-')); const database = join(directory, 'jobs.sqlite'); const models = createModels(); const faux = fauxProvider(); faux.setResponses([fauxAssistantMessage([fauxText('ok')])]); models.setProvider(faux.provider); let runtime;
  try {
    runtime = await openSessionRuntime({ ...options(database, models), onSettled: async () => { throw new Error('notify'); } }); const admitted = await runtime.jobs.start(request, async task => legacyInput(task.task)); assert.equal(admitted.success, true);
    await new Promise(resolve => setTimeout(resolve, 30)); const status = await runtime.jobs.status(admitted.value.jobId); assert.equal(status.value.job.status, 'completed');
    await runtime.close();
  } finally { await runtime?.close(); await rm(directory, { recursive: true, force: true }); }
});

test('retire termina sin proveedor, close concurrente retiene lease hasta el cierre real', { timeout: 10000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-parent-retire-'));
  const database = join(directory, 'jobs.sqlite');
  const started = Promise.withResolvers();
  const response = Promise.withResolvers();
  const models = createModels();
  const faux = fauxProvider();
  faux.setResponses([async () => { started.resolve(); return response.promise; }]);
  models.setProvider(faux.provider);
  let runtime, other, reopened, closing;
  try {
    const reports = [];
    runtime = await openSessionRuntime({ ...options(database, models), sessionId: 'parent-retire', onReport: error => reports.push(error) });
    assert.equal((await runtime.parent.start(request, async task => legacyInput(task.task))).success, true);
    await started.promise;
    assert.equal(typeof runtime.retire, 'function');
    const firstRetire = runtime.retire();
    assert.equal(runtime.retire(), firstRetire);
    await firstRetire;
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(reports, []);
    const denied = await runtime.parent.decideReview('psa_runtime', { requestId: 'late', status: 'approved' });
    assert.equal(denied.success, false);
    closing = runtime.close();
    assert.equal(runtime.close(), closing);
    let closed = false;
    const secondClose = runtime.close().then(() => { closed = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(closed, false);
    await assert.rejects(acquireLease(database), hasCode('STORAGE_BUSY'));
    await assert.rejects(openSessionRuntime(options(database)), hasCode('STORAGE_BUSY'));
    const otherModels = createModels();
    const otherFaux = fauxProvider();
    otherFaux.setResponses([fauxAssistantMessage([fauxText('otra base')])]);
    otherModels.setProvider(otherFaux.provider);
    const settled = Promise.withResolvers();
    other = await openSessionRuntime({ ...options(join(directory, 'other.sqlite'), otherModels), onSettled: async () => settled.resolve() });
    assert.equal((await other.jobs.start(request, async task => legacyInput(task.task))).success, true);
    await settled.promise;
    assert.equal((await other.jobs.result('psa_runtime')).value.result.finalResponse, 'otra base');
    response.resolve(fauxAssistantMessage([fauxText('respuesta tardía')]));
    await Promise.all([closing, secondClose]);
    reopened = await openSessionRuntime(options(database));
    const previousJob = (await reopened.jobs.status('psa_runtime')).value.job;
    assert.notEqual(previousJob.status, 'cancelled');
    assert.equal(previousJob.control?.pending, undefined);
  } finally {
    response.resolve(fauxAssistantMessage([fauxText('cleanup')]));
    await closing;
    await runtime?.close();
    await other?.close();
    await reopened?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('close concurrente no devuelve éxito mientras el proveedor sigue activo', { timeout: 10000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-parent-close-shared-'));
  const started = Promise.withResolvers();
  const response = Promise.withResolvers();
  const models = createModels();
  const faux = fauxProvider();
  faux.setResponses([async () => { started.resolve(); return response.promise; }]);
  models.setProvider(faux.provider);
  let runtime, closing;
  try {
    runtime = await openSessionRuntime(options(join(directory, 'jobs.sqlite'), models));
    await runtime.jobs.start(request, async task => legacyInput(task.task));
    await started.promise;
    closing = runtime.close();
    let early = false;
    const concurrent = runtime.close().then(() => { early = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(early, false);
    response.resolve(fauxAssistantMessage([fauxText('fin')]));
    await Promise.all([closing, concurrent]);
  } finally {
    response.resolve(fauxAssistantMessage([fauxText('cleanup')]));
    await closing;
    await runtime?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('retire no espera resolver y lo rechaza antes de admitir un job tardío', { timeout: 10000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-parent-resolver-'));
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  let runtime, admission;
  try {
    runtime = await openSessionRuntime({ ...options(join(directory, 'jobs.sqlite')), sessionId: 'resolver' });
    admission = runtime.parent.start(request, async task => { entered.resolve(); await release.promise; return legacyInput(task.task); });
    await entered.promise;
    assert.equal(typeof runtime.retire, 'function');
    await runtime.retire();
    release.resolve();
    assert.equal((await admission).error.code, 'RUNTIME_CLOSING');
    await runtime.close();
  } finally {
    release.resolve();
    await admission;
    await runtime?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('fallo de cierre SDK es observado y no libera lease ni simula close satisfactorio', { timeout: 10000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-parent-close-error-'));
  const database = join(directory, 'jobs.sqlite');
  const error = new Error('sdk-close-fixture');
  const reported = Promise.withResolvers();
  const originalOpen = Harness.open;
  let captured, originalClose, runtime;
  const mock = t.mock.method(Harness, 'open', async (...args) => {
    captured = await originalOpen(...args);
    originalClose = captured.close.bind(captured);
    captured.close = () => Promise.reject(error);
    return captured;
  });
  try {
    runtime = await openSessionRuntime({ ...options(database), onReport: e => reported.resolve(e) });
    assert.equal(typeof runtime.retire, 'function');
    await runtime.retire();
    assert.equal(await reported.promise, error);
    await assert.rejects(runtime.close(), e => e === error);
    await assert.rejects(runtime.close(), e => e === error);
    await assert.rejects(acquireLease(database), hasCode('STORAGE_BUSY'));
  } finally {
    // Solo fixture temporal: cerrar el SDK real antes de eliminar sus archivos.
    if (!captured && runtime) await runtime.close().catch(() => {});
    mock.mock.restore();
    if (captured) await originalClose(context);
    await rm(directory, { recursive: true, force: true });
  }
});

test('fallo al abrir y al limpiar SDK conserva lease de storage no cerrado', { timeout: 10000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-parent-open-error-'));
  const database = join(directory, 'jobs.sqlite');
  const openError = new Error('recover-fixture');
  const closeError = new Error('cleanup-fixture');
  const errors = [];
  const originalOpen = Harness.open;
  let captured, originalClose;
  const mock = t.mock.method(Harness, 'open', async (...args) => {
    captured = await originalOpen(...args);
    originalClose = captured.close.bind(captured);
    captured.snapshot = async () => { throw openError; };
    captured.close = async () => { throw closeError; };
    return captured;
  });
  try {
    let observed;
    await assert.rejects(openSessionRuntime({ ...options(database), onReport: e => errors.push(e) }), e => { observed = e; return true; });
    await assert.rejects(acquireLease(database), hasCode('STORAGE_BUSY'));
    assert.equal(observed, openError);
    assert.equal(errors.includes(closeError), true);
  } finally {
    mock.mock.restore();
    if (captured) await originalClose(context);
    await rm(directory, { recursive: true, force: true });
  }
});

test('apertura fallida devuelve el error sin esperar proveedor y conserva lease durante cleanup real', { timeout: 10000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-parent-open-pending-'));
  const database = join(directory, 'jobs.sqlite');
  const started = Promise.withResolvers();
  const response = Promise.withResolvers();
  const cleanupStarted = Promise.withResolvers();
  const cleanupEnded = Promise.withResolvers();
  const openError = new Error('recover con proveedor pendiente');
  const models = createModels();
  const faux = fauxProvider();
  const release = () => response.resolve(fauxAssistantMessage([fauxText('cleanup')]));
  t.signal.addEventListener('abort', release, { once: true });
  faux.setResponses([async () => { started.resolve(); return response.promise; }]);
  models.setProvider(faux.provider);
  const originalOpen = Harness.open;
  const mock = t.mock.method(Harness, 'open', async (...args) => {
    const harness = await originalOpen(...args);
    const originalClose = harness.close.bind(harness);
    harness.close = async (...closeArgs) => { cleanupStarted.resolve(); await originalClose(...closeArgs); cleanupEnded.resolve(); };
    const execution = createExecution(harness, context, new Map(), () => 2);
    const job = { ...legacyInput('opening'), id: 'opening-task', status: 'queued', createdAt: 1, updatedAt: 1, notified: false };
    const conversationId = await harness.commit(tx => execution.create(tx, job), context);
    await execution.submit({ ...job, conversationId });
    await started.promise;
    harness.snapshot = async () => { throw openError; };
    return harness;
  });
  let opening;
  try {
    let rejected = false;
    opening = openSessionRuntime(options(database, models)).then(() => { throw new Error('unexpected success'); }, error => { rejected = true; return error; });
    await cleanupStarted.promise;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(rejected, true);
    assert.equal(await opening, openError);
    await assert.rejects(acquireLease(database), hasCode('STORAGE_BUSY'));
    release();
    await cleanupEnded.promise;
  } finally {
    release();
    await opening;
    await cleanupEnded.promise;
    mock.mock.restore();
    await rm(directory, { recursive: true, force: true });
  }
});

for (const phase of ['finish', 'markNotified']) {
  test(`runtime espera ${phase} real admitido antes de iniciar cierre SDK`, { timeout: 10000 }, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'pi-parent-write-drain-'));
    const database = join(directory, 'jobs.sqlite');
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    t.signal.addEventListener('abort', () => release.resolve(), { once: true });
    const models = createModels();
    const faux = fauxProvider();
    faux.setResponses([fauxAssistantMessage([fauxText('drain real')])]);
    models.setProvider(faux.provider);
    const originalOpen = Harness.open;
    let closeCalls = 0, held = false, watchWrites = false, runtime, reopened;
    const mock = t.mock.method(Harness, 'open', async (...args) => {
      const harness = await originalOpen(...args);
      const originalClose = harness.close.bind(harness);
      harness.close = (...closeArgs) => { closeCalls++; return originalClose(...closeArgs); };
      if (phase === 'finish') {
        const originalCommit = harness.commit.bind(harness);
        harness.commit = (fn, ...commitArgs) => originalCommit(async tx => {
          const value = await fn(tx);
          if (!held && watchWrites) {
            const job = await tx.doc(JobDocFamily, 'psa_runtime');
            if (job?.status === 'completed') { held = true; entered.resolve(); await release.promise; }
          }
          return value;
        }, ...commitArgs);
      }
      return harness;
    });
    try {
      runtime = await openSessionRuntime({ ...options(database, models), onSettled: async job => {
        if (phase === 'markNotified') { entered.resolve(); await release.promise; await runtime.jobs.markNotified(job.id); }
      } });
      watchWrites = true;
      const admitted = await runtime.jobs.start(request, async task => legacyInput(task.task));
      assert.equal(admitted.success, true);
      await entered.promise;
      let retired = false;
      const retiring = runtime.retire().then(() => { retired = true; });
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(retired, false);
      assert.equal(closeCalls, 0);
      release.resolve();
      await retiring;
      await runtime.close();
      assert.equal(closeCalls, 1);
      mock.mock.restore();
      reopened = await openSessionRuntime(options(database));
      const job = (await reopened.jobs.status('psa_runtime')).value.job;
      assert.equal(job.status, 'completed');
      assert.equal(job.notified, phase === 'markNotified');
    } finally {
      release.resolve();
      await runtime?.close();
      await reopened?.close();
      mock.mock.restore();
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test('cierre sella admisión sin dejar job admitido sin persistir', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-agents-runtime-close-')); const database = join(directory, 'jobs.sqlite');
  try { const runtime = await openSessionRuntime(options(database)); const closing = runtime.close(); const rejected = await runtime.jobs.start(request, async task => legacyInput(task.task)); await closing; assert.equal(rejected.success, false); assert.equal(rejected.error.code, 'RUNTIME_CLOSING'); }
  finally { await rm(directory, { recursive: true, force: true }); }
});
