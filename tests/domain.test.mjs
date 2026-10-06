import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalStart, canonicalJson } from '../src/domain/requests.ts';
import { transition, publicStatus, assertJob, assertResult } from '../src/domain/jobs.ts';
import { DomainError, failure } from '../src/domain/errors.ts';
import { legacyInput } from './helpers/legacy.mjs';

const request = { requestId: 'tool:1', actor: { kind: 'model' }, intent: { agent: 'reviewer', task: '  tarea  interna  ', cwd: '/tmp/a/../b' } };
const job = () => ({ id: 'psa_1', ...legacyInput('tarea'), status: 'queued', createdAt: 1000, updatedAt: 1000, notified: false });

test('canonización normaliza solo espacios externos y cwd, preservando intención y actor', () => {
  const a = canonicalStart(request);
  const b = canonicalStart({ intent: { cwd: '/tmp/b', task: 'tarea  interna', agent: 'reviewer' }, actor: { id: undefined, kind: 'model' }, requestId: 'tool:1' });
  assert.equal(a.payloadHash, b.payloadHash);
  assert.equal(a.normalized.intent.task, 'tarea  interna');
  assert.equal(a.normalized.intent.cwd, '/tmp/b');
  assert.equal(a.key.length, 64);
  assert.notEqual(a.payloadHash, canonicalStart({ ...request, actor: { kind: 'human' } }).payloadHash);
  assert.notEqual(a.payloadHash, canonicalStart({ ...request, intent: { ...request.intent, agent: 'Reviewer' } }).payloadHash);
  assert.notEqual(a.payloadHash, canonicalStart({ ...request, intent: { ...request.intent, task: 'tarea interna' } }).payloadHash);
  assert.equal(a.payloadHash, canonicalStart({ ...request, requestId: 'tool:2' }).payloadHash);
  assert.notEqual(a.key, canonicalStart({ ...request, requestId: 'tool:2' }).key);
});

test('rechaza solicitudes malformadas antes de admitirlas', () => {
  for (const bad of [null, { ...request, requestId: '' }, { ...request, actor: { kind: 'admin' } }, { ...request, intent: { ...request.intent, task: ' ' } }, { ...request, intent: { ...request.intent, cwd: 'relative' } }]) {
    assert.throws(() => canonicalStart(bad), e => e instanceof DomainError && e.error.code === 'INVALID_REQUEST');
  }
  assert.equal(canonicalJson(JSON.parse('{"constructor":2,"__proto__":1}')), '{"__proto__":1,"constructor":2}');
  assert.throws(() => canonicalJson({ invalid: NaN }), DomainError);
});

test('transiciones preservan el original y rechazan salto o modificación de terminales', () => {
  const original = job();
  const next = transition(original, 'provisioning', 1001);
  assert.equal(next.status, 'provisioning');
  assert.equal(next.updatedAt, 1001);
  assert.equal(original.status, 'queued');
  assert.equal(publicStatus(next), 'running');
  for (const state of ['queued', 'provisioning', 'running']) {
    const active = { ...job(), status: state, ...(state === 'provisioning' || state === 'running' ? { conversationId: 1 } : {}), ...(state === 'running' ? { submissionId: 2 } : {}) };
    assert.equal(transition(active, 'failed', 1002).status, 'failed');
  }
  assert.throws(() => transition(original, 'completed', 1002), DomainError);
  assert.throws(() => transition({ ...job(), status: 'completed' }, 'failed', 1002), DomainError);
  assert.throws(() => transition(original, 'provisioning', NaN), DomainError);
});

test('valida documentos y resultados sin aceptar flags activos sin identidad durable', () => {
  assert.doesNotThrow(() => assertJob(job()));
  assert.throws(() => assertJob({ ...job(), status: 'running' }), DomainError);
  assert.throws(() => assertJob({ ...job(), createdAt: Infinity }), DomainError);
  assert.throws(() => assertJob({ ...job(), agent: { ...job().agent, tools: ['unsafe'] } }), DomainError);
  assert.doesNotThrow(() => assertJob({ ...job(), id: '__proto__' }));
  const result = { status: 'completed', finalResponse: 'ok', durationMs: 3, model: job().model };
  assert.doesNotThrow(() => assertResult(result));
  assert.throws(() => assertResult({ ...result, durationMs: -1 }), DomainError);
});

test('errores inesperados no exponen rutas ni detalles sensibles en el sobre público', () => {
  assert.deepEqual(failure(new Error('/secret/password')), { success: false, error: { code: 'STORAGE_ERROR', message: 'No se pudo completar la operación de almacenamiento.', retryable: false, details: {} } });
  const error = new DomainError('JOB_NOT_FOUND', 'Trabajo inexistente');
  assert.equal(failure(error).error.code, 'JOB_NOT_FOUND');
});
