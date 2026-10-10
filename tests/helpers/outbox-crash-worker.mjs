import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createSession } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createJobRepository } from '../../src/infrastructure/durable/repository.ts';

const [database, mode = 'after'] = process.argv.slice(2);
const storage = await openNodeSqliteStorage(database);
const originalCommit = storage.commit.bind(storage);
let firstCommit = true;
const observed = new Proxy(storage, {
  get(target, property, receiver) {
    if (property !== 'commit') return Reflect.get(target, property, receiver);
    return async (writes, ...args) => {
      if (mode === 'before' && firstCommit) {
        firstCommit = false;
        process.send?.({ point: 'before-commit' });
        await waitFor('continue-before');
      }
      const result = await originalCommit(writes, ...args);
      if (mode === 'after' && firstCommit) {
        firstCommit = false;
        process.send?.({ point: 'after-commit' });
        await waitFor('continue-after');
      }
      return result;
    };
  },
});
const session = createSession(observed);
const repository = createJobRepository(session, context, () => 2000, () => 'crash-job', 'crash-session');
function waitFor(expected) {
  return new Promise(resolve => {
    const handler = message => {
      if (message?.point === expected) {
        process.off('message', handler);
        resolve();
      }
    };
    process.on('message', handler);
  });
}
await repository.admit({ requestId: 'crash-request', actor: { kind: 'extension', id: 'crash' }, payloadHash: 'crash-hash' }, {
  task: 'private', cwd: process.cwd(), agent: { name: 'agent', description: 'd', systemPrompt: 's', source: 'personal', filePath: '/private/a', tools: [] }, model: { provider: 'faux', modelId: 'faux-1' }, thinkingLevel: 'off',
});
await new Promise(() => {});
