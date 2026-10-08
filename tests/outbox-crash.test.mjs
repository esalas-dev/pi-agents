import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { makeStoreFixture } from './helpers/store.mjs';

test('crash worker after durable commit leaves job and event recoverable', async () => {
  const f = await makeStoreFixture();
  try {
    await f.session.close(context);
    const worker = fork(new URL('./helpers/outbox-crash-worker.mjs', import.meta.url), [f.database], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    await once(worker, 'message');
    await once(worker, 'message');
    worker.kill('SIGKILL');
    await once(worker, 'exit');
    await f.reopen();
    assert.equal((await f.repository.get('crash-job')).status, 'queued');
    assert.deepEqual((await f.outbox.pending(10)).map(event => event.type), ['job.queued']);
  } finally { await f.close(); }
});
