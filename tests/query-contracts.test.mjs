import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertJobFilter,
  assertWaitOptions,
  createEmptyConsumption,
  createReviewState,
} from '../src/domain/jobs.ts';
import { DomainError } from '../src/domain/errors.ts';
import { JobReviewDocFamily, JobConsumptionDocFamily } from '../src/infrastructure/durable/documents.ts';

function codeOf(callback) {
  assert.throws(callback, error => error instanceof DomainError && error.error.code === 'INVALID_FILTER');
}

test('valida filtros de consulta y límites de listado', () => {
  assert.doesNotThrow(() => assertJobFilter({ limit: 1, statuses: ['queued'] }));
  assert.doesNotThrow(() => assertJobFilter({ limit: 100, createdAfter: 1, createdBefore: 2 }));
  codeOf(() => assertJobFilter({ limit: 0 }));
  codeOf(() => assertJobFilter({ limit: 101 }));
  codeOf(() => assertJobFilter({ statuses: ['unknown'] }));
  codeOf(() => assertJobFilter({ createdAfter: 3, createdBefore: 2 }));
});

test('valida espera inmediata y acotada sin mutar el trabajo', () => {
  assert.deepEqual(assertWaitOptions({ timeoutSeconds: 0 }), { timeoutSeconds: 0 });
  assert.deepEqual(assertWaitOptions({ timeoutSeconds: 300, until: 'completed' }), { timeoutSeconds: 300, until: 'completed' });
  codeOf(() => assertWaitOptions({ timeoutSeconds: -1 }));
  codeOf(() => assertWaitOptions({ timeoutSeconds: 301 }));
  codeOf(() => assertWaitOptions({ until: 'unknown' }));
});

test('expone estados iniciales de revisión y consumo sin cuerpo de resultado', () => {
  assert.deepEqual(createReviewState('pending'), { status: 'pending' });
  assert.deepEqual(createEmptyConsumption(), { count: 0, requestIds: [] });
  assert.ok(JobReviewDocFamily);
  assert.ok(JobConsumptionDocFamily);
});
