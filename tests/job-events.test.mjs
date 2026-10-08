import test from 'node:test';
import assert from 'node:assert/strict';
import { makeStoreFixture } from './helpers/store.mjs';

function input() {
  return {
    task: 'tarea privada SECRET_SENTINEL', cwd: '/private/path',
    agent: { name: 'agent', description: 'private', systemPrompt: 'secret', source: 'personal', filePath: '/private/agent.md', tools: [] },
    model: { provider: 'faux', modelId: 'faux-1' }, thinkingLevel: 'off',
  };
}

test('event write failure rolls back job and event atomically', async () => {
  const f = await makeStoreFixture({ createId: () => 'job-fail', failCommit: writes => JSON.stringify(writes).includes('pi-durable-subagents.outbox-event') });
  try {
    const req = { requestId: 'start-fail', actor: { kind: 'extension', id: 'caller' }, payloadHash: 'hash-fail' };
    await assert.rejects(f.repository.admit(req, input()), /failpoint: outbox-event/);
    await f.reopen();
    assert.equal(await f.repository.get('job-fail'), undefined);
    assert.deepEqual(await f.outbox.pending(10), []);
  } finally { await f.close(); }
});

test('admit atomically appends one public queued event and deduplicates concurrent intent', async () => {
  const f = await makeStoreFixture({ createId: () => 'job-1' });
  try {
    const req = { requestId: 'start-1', actor: { kind: 'extension', id: 'caller' }, payloadHash: 'hash-1' };
    const [first, second] = await Promise.all([f.repository.admit(req, input()), f.repository.admit(req, input())]);
    assert.deepEqual(first, second);
    const pending = await f.outbox.pending(10);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].type, 'job.queued');
    assert.deepEqual(pending[0].data, { status: 'queued', agent: 'agent', hasResult: false });
    assert.equal(JSON.stringify(pending).includes('SECRET_SENTINEL'), false);
  } finally { await f.close(); }
});
