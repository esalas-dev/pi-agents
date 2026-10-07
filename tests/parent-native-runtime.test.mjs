import test from 'node:test';
import assert from 'node:assert/strict';
import { createParentJobsService } from '../src/application/parent.ts';

test('parent facade delegates exact authority and derives model review actor', async () => {
  const authority = Object.freeze({ sessionId: 'adapter-test', isActive: () => true });
  const calls = [];
  const start = { start: async (...args) => { calls.push(['start', ...args]); return { success: true, value: 'started' }; } };
  const control = { retry: async (...args) => { calls.push(['retry', ...args]); return { success: true, value: 'retried' }; } };
  const review = { decideReview: async (...args) => { calls.push(['review', ...args]); return { success: true, value: 'reviewed' }; } };
  const service = createParentJobsService(authority, start, control, review);
  const startRequest = { requestId: 'start:1', actor: { kind: 'model', id: 'tool:1' }, intent: { agent: 'worker', task: 'do it', cwd: '/tmp' } };
  assert.equal((await service.start(startRequest, async () => ({}))).success, true);
  assert.equal((await service.retry('job-1', { requestId: 'retry:1', action: 'retry', actor: { kind: 'model', id: 'tool:2' } })).success, true);
  assert.equal((await service.decideReview('job-1', { requestId: 'review:1', status: 'approved' })).success, true);
  assert.equal(calls[0][3], authority);
  assert.equal(calls[1][3], authority);
  assert.equal(calls[2][3], authority);
  assert.deepEqual(calls[2][2], { requestId: 'review:1', status: 'approved' });
});

test('parent facade rejects non-model start/retry and review actor injection', async () => {
  const authority = Object.freeze({ sessionId: 's', isActive: () => true });
  const never = async () => { throw new Error('must not delegate'); };
  const service = createParentJobsService(authority, { start: never }, { retry: never }, { decideReview: never });
  assert.equal((await service.start({ requestId: 's', actor: { kind: 'human' }, intent: { agent: 'a', task: 'x', cwd: '/tmp' } }, async () => ({}))).error.code, 'INVALID_REQUEST');
  assert.equal((await service.retry('j', { requestId: 'r', action: 'retry', actor: { kind: 'human' } })).error.code, 'INVALID_REQUEST');
  assert.equal((await service.decideReview('j', { requestId: 'r', status: 'approved', actor: { kind: 'human' } })).error.code, 'INVALID_REQUEST');
});
