import test from 'node:test';
import assert from 'node:assert/strict';
import { assertJob, publicStatus } from '../src/domain/jobs.ts';
import { assertControlRequest } from '../src/domain/requests.ts';
import { DomainError } from '../src/domain/errors.ts';
import { JobControlDocFamily } from '../src/infrastructure/durable/documents.ts';
import { legacyInput } from './helpers/legacy.mjs';

const baseJob = () => ({ id: 'psa_control', ...legacyInput('control'), status: 'queued', createdAt: 1000, updatedAt: 1000, notified: false });
const actor = { kind: 'human', id: 'tui' };

function invalid(callback, code = 'INVALID_REQUEST') {
  assert.throws(callback, error => error instanceof DomainError && error.error.code === code);
}

test('expone estados de control y valida requestId, actor, acción y motivo', () => {
  for (const status of ['paused', 'cancelling', 'cancelled']) assert.equal(publicStatus({ status }), status);
  assert.doesNotThrow(() => assertControlRequest({ requestId: 'control:1', action: 'cancel', actor, reason: 'detener' }));
  assert.doesNotThrow(() => assertControlRequest({ requestId: 'control:2', action: 'pause', actor, reason: 'x'.repeat(2048) }));
  for (const bad of [
    { requestId: '', action: 'cancel', actor },
    { requestId: 'control:3', action: 'unknown', actor },
    { requestId: 'control:4', action: 'cancel', actor: { kind: 'admin' } },
    { requestId: 'control:5', action: 'cancel', actor, reason: 'x'.repeat(2049) },
  ]) invalid(() => assertControlRequest(bad));
});

test('valida campos de intentos y expone la familia durable de historial', () => {
  assert.ok(JobControlDocFamily);
  assert.doesNotThrow(() => assertJob({ ...baseJob(), status: 'paused', queueOrdinal: 2, attemptNumber: 1, rootAttemptId: 'psa_root' }));
  assert.doesNotThrow(() => assertJob({ ...baseJob(), status: 'cancelling', conversationId: 1, control: { pending: 'cancel', requestedAt: 1001, requestedBy: actor, requestId: 'control:6' } }));
  assert.throws(() => assertJob({ ...baseJob(), status: 'cancelled' }), DomainError);
});
