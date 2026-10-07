import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { registerPiAgents, canConfirmMigration } from '../src/adapters/pi/register.ts';
import { resolveInput } from '../src/adapters/pi/resolve.ts';
import { formatStatus, formatResult, briefSummary } from '../src/adapters/pi/display.ts';

function host(ctx) {
  const handlers = {}; const registered = { tools: [] }; const entries = [];
  const pi = { on: (name, fn) => { handlers[name] = fn; }, registerTool: tool => { registered.tools.push(tool); registered.tool = tool; }, registerCommand: (name, command) => { registered.command = { name, ...command }; }, registerEntryRenderer: () => {}, appendEntry: (type, data) => entries.push({ type, data }) };
  return { pi, handlers, registered, entries, dispatch: async (name, ...args) => handlers[name]?.(...args, ctx) };
}
function modelRuntime(model) { return { registerNativeProvider() {}, getModel: () => model }; }
function context(cwd) { return { cwd, mode: 'tui', hasUI: true, model: { provider: 'faux', id: 'faux-1' }, thinkingLevel: 'off', modelRegistry: { getAll: () => [], getProvider: () => undefined }, isProjectTrusted: () => true, sessionManager: { getSessionId: () => 'adapter-test', getBranch: () => [] }, ui: { notify() {}, confirm: async () => true } }; }

 test('resolveInput conserva confianza, snapshot y modelo configurado', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-agents-adapter-')); const agentDir = join(directory, 'agents'); await (await import('node:fs/promises')).mkdir(agentDir, { recursive: true }); await writeFile(join(agentDir, 'a.md'), '---\nname: worker\ndescription: worker\ntools: read,write\n---\nSystem prompt'); const ctx = context(directory); const model = { provider: 'faux', id: 'faux-1' };
  try { const resolved = await resolveInput(ctx, modelRuntime(model), { agent: 'worker', task: ' tarea ', cwd: directory }, { getAgentDir: () => directory, createModels: async () => modelRuntime(model), resolveModel: () => ({ model }), text: () => {}, Type: {}, version: 'test' }); assert.equal(resolved.agent.source, 'personal'); assert.equal(resolved.task, ' tarea '); assert.deepEqual(resolved.model, { provider: model.provider, modelId: model.id }); }
  finally { await rm(directory, { recursive: true, force: true }); }
});

test('registro no abre runtime al construir y tool devuelve recibo inmediato con actor model', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-agents-adapter-register-')); const ctx = context(directory); const model = { provider: 'faux', id: 'faux-1' }; const h = host(ctx);
  try {
    registerPiAgents(h.pi, { getAgentDir: () => directory, createModels: async () => modelRuntime(model), resolveModel: () => ({ model }), text: content => content, Type: { Object: x => x, String: () => ({}) }, version: 'test' });
    assert.deepEqual(h.registered.tools.map(tool => tool.name), ['pi_agents', 'pi_agents_status', 'pi_agents_list', 'pi_agents_wait', 'pi_agents_result']); assert.equal(h.registered.command.name, 'subagents'); assert.deepEqual(Object.keys(h.registered.command), ['name', 'description', 'handler']); assert.equal(typeof h.handlers.session_start, 'function');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('migración solo puede confirmarse desde TUI con UI real', () => {
  assert.equal(canConfirmMigration({ mode: 'tui', hasUI: true }), true); assert.equal(canConfirmMigration({ mode: 'rpc', hasUI: true }), false); assert.equal(canConfirmMigration({ mode: 'tui', hasUI: false }), false);
});

test('presentación no lee respuesta completa para status y resume con límite', () => {
  const job = { id: 'psa_1', status: 'completed', task: 'x', cwd: '/tmp', createdAt: 1, updatedAt: 2, agent: { name: 'a', source: 'personal', tools: [] }, model: { provider: 'faux', modelId: 'one' }, thinkingLevel: 'off', notified: false, resultMeta: { durationMs: 12, model: { provider: 'faux', modelId: 'two' }, status: 'completed' } };
  const view = { job, queuePosition: undefined }; assert.match(formatStatus(view), /faux\/two/); assert.match(formatResult({ ...view, result: { finalResponse: 'ok', durationMs: 12, model: job.model, status: 'completed' } }), /Respuesta final/); assert.equal(briefSummary({ finalResponse: 'abcdefgh', durationMs: 1, model: job.model, status: 'completed' }, 'completed', 5), 'abcd…');
});
