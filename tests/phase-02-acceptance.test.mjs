import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const files = async () => Object.fromEntries(await Promise.all(['README.md', 'docs/ARCHITECTURE.md', 'docs/PHASE-02-ACCEPTANCE.md', 'specs/ROADMAP.md'].map(async path => [path, await readFile(path, 'utf8')])));

test('documenta el contrato implementado de control durable y sus límites', async () => {
  const docs = await files(); const text = Object.values(docs).join('\n');
  for (const token of ['pi_agents_control', '/subagents cancel', '/subagents pause', '/subagents resume', '/subagents retry', 'paused', 'cancelling', 'cancelled', 'PAUSE_ACTIVE_UNSUPPORTED', 'esquema 3', 'esquema 4', 'interrupted', 'cancelled', 'autoridad TUI']) assert.match(text, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(text, /force kill/i);
  assert.match(docs['specs/ROADMAP.md'] ?? text, /Fase 02/);
});
