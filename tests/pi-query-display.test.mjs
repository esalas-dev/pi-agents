import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { formatList, formatReview, formatResult, formatStatus, formatWait, briefSummary, truncateToolResult } from '../src/adapters/pi/display.ts';

test('presenta listado, espera y revisión para humanos', () => {
  const view = { id: 'job-1', status: 'completed', agent: { name: 'a', source: 'personal' }, model: { provider: 'faux', modelId: 'one' }, cwd: '/tmp', createdAt: 1, updatedAt: 2, hasResult: true, reviewStatus: 'pending', consumption: { count: 0, requestIds: [] }, task: 'hazlo' };
  assert.match(formatList({ items: [view], nextCursor: 'next' }), /job-1/);
  assert.match(formatWait(view), /completed/);
  assert.match(formatReview({ jobId: 'job-1', status: 'approved', decidedBy: 'alice' }), /approved/);
  assert.match(formatStatus({ job: { ...view, resultMeta: { durationMs: 12, model: view.model, status: 'completed' } } }), /faux\/one/);
  assert.match(formatResult({ job: { ...view, resultMeta: { durationMs: 12, model: view.model, status: 'completed' } }, result: { finalResponse: 'respuesta', durationMs: 12, model: view.model, status: 'completed' } }), /Respuesta final/);
  assert.equal(briefSummary({ finalResponse: 'abcdefgh', durationMs: 1, model: view.model, status: 'completed' }, 'completed', 5), 'abcd…');
});

test('trunca por bytes UTF-8 y conserva hash/longitud del cuerpo completo', () => {
  const full = 'á'.repeat(40_000) + ' fin';
  const bounded = truncateToolResult(full, 64 * 1024);
  assert.equal(bounded.truncated, true);
  assert.ok(Buffer.byteLength(bounded.text) <= 64 * 1024);
  assert.equal(bounded.totalBytes, Buffer.byteLength(full));
  assert.equal(bounded.sha256, createHash('sha256').update(full).digest('hex'));
  assert.doesNotMatch(bounded.text, /�$/);
  const small = truncateToolResult('ok');
  assert.deepEqual(small, { text: 'ok', totalBytes: 2, sha256: createHash('sha256').update('ok').digest('hex'), truncated: false });
});
