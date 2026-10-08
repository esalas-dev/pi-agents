import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createSession } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createJobRepository } from '../../src/infrastructure/durable/repository.ts';

const [database] = process.argv.slice(2);
const session = createSession(await openNodeSqliteStorage(database));
const repository = createJobRepository(session, context, () => 2000, () => 'crash-job', 'crash-session');
process.send?.({ point: 'before-commit' });
await repository.admit({ requestId: 'crash-request', actor: { kind: 'extension', id: 'crash' }, payloadHash: 'crash-hash' }, {
  task: 'private', cwd: process.cwd(), agent: { name: 'agent', description: 'd', systemPrompt: 's', source: 'personal', filePath: '/private/a', tools: [] }, model: { provider: 'faux', modelId: 'faux-1' }, thinkingLevel: 'off',
});
process.send?.({ point: 'after-commit' });
await new Promise(() => {});
