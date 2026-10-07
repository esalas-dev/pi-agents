import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { openSessionRuntime } from '../src/runtime/session.ts';
import { createV3Database } from './helpers/v3.mjs';

test('bloquea runtime en esquema 3 hasta migración explícita a esquema 4', async () => {
  const directory = await mkdtemp(join('/tmp', 'pi-agents-session-v3-'));
  try {
    const database = await createV3Database(directory);
    await assert.rejects(() => openSessionRuntime({ storagePath: database, models: {}, context, defaultCwd: process.cwd(), maxConcurrency: 1 }), error => error?.error?.code === 'MIGRATION_REQUIRED');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
