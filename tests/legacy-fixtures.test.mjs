import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createLegacyFixture, readLegacy } from './helpers/legacy.mjs';

for (const scenario of ['queued', 'provisioning', 'running', 'terminal-mix', 'large-result']) {
  test(`fixture v1 ${scenario}: conserva los datos tras reabrir`, { timeout: 15_000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pi-agents-v1-'));
    try {
      const fixture = await createLegacyFixture({ directory, scenario });
      const actual = await readLegacy(fixture.database);
      assert.deepEqual(actual, fixture.expected);
      assert.ok(Object.keys(actual.jobs).length > 0);
      if (scenario === 'queued') {
        assert.deepEqual(actual.queue, ['psa_second', 'psa_first']);
        assert.equal(actual.jobs.psa_second.task, 'segunda tarea');
        assert.equal(actual.jobs.psa_first.createdAt, 1000);
      } else if (scenario === 'terminal-mix') {
        assert.equal(actual.jobs.psa_done.notified, false);
        assert.equal(actual.jobs.psa_failed.notified, true);
        assert.equal(actual.jobs.psa_interrupted.result.status, 'interrupted');
        assert.equal(actual.jobs.psa_done.result.finalResponse, 'respuesta histórica');
      } else if (scenario === 'large-result') {
        assert.equal(actual.jobs.psa_large.result.finalResponse, 'x'.repeat(1024 * 1024));
      } else {
        const job = actual.jobs.psa_active;
        assert.equal(job.status, scenario);
        const storage = await openNodeSqliteStorage(fixture.database);
        try {
          const conversation = await storage.conversation(job.conversationId, BACKGROUND_CONTEXT);
          assert.equal(conversation.id, job.conversationId);
          if (scenario === 'running') {
            const submission = await storage.submission(job.submissionId, BACKGROUND_CONTEXT);
            assert.equal(submission.conversationId, job.conversationId);
            assert.equal(submission.requestId, 'pi-agents:psa_active');
            assert.equal(submission.type, 'input');
            assert.equal(submission.status, 'placed');
            const tasks = await storage.scanTasks({ conversationId: job.conversationId }, 100, undefined, BACKGROUND_CONTEXT);
            assert.ok(tasks.items.some(task => task.kind === 'pi.generation' && ['pending', 'running'].includes(task.state.status)));
          } else assert.equal(job.submissionId, undefined);
        } finally { await storage.close(BACKGROUND_CONTEXT); }
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
}

