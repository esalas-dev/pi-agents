import test from 'node:test';
import assert from 'node:assert/strict';
import { formatToolResultResponse, registerPiAgents } from '../src/adapters/pi/register.ts';
import { makeEventBus } from './helpers/rpc.mjs';

function fakePi() {
  const tools = []; const commands = []; const handlers = new Map();
  return { events: makeEventBus(), tools, commands, handlers, on(name, handler) { handlers.set(name, handler); }, registerTool(tool) { tools.push(tool); }, registerCommand(name, command) { commands.push({ name, ...command }); }, registerEntryRenderer() {}, appendEntry() {} };
}

const context = sessionId => ({ cwd: '/tmp', mode: 'tui', hasUI: true, isProjectTrusted: () => false, sessionManager: { getSessionId: () => sessionId }, modelRegistry: { getAll: () => [], getProvider: () => undefined }, ui: { confirm: async () => false, notify() {} } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('no expone el cuerpo completo del resultado en details de una tool', () => {
  const value = { job: { id: 'job-1', status: 'completed' }, result: { finalResponse: 'x'.repeat(70_000) } };
  const response = formatToolResultResponse(value);
  assert.ok(Buffer.byteLength(response.content[0].text) <= 64 * 1024);
  assert.equal(response.details.result.finalResponse, undefined);
  assert.equal(response.details.result.truncated, true);
});

test('una espera abortada al cambiar de generación no cancela el trabajo', { timeout: 5000 }, async () => {
  const pi = fakePi(); const waitStarted = deferred(); let abortCalls = 0; let closeCalls = 0;
  registerPiAgents(pi, {
    getAgentDir: () => '/tmp', createModels: async () => ({ registerNativeProvider() {} }), resolveModel: () => ({}), text: value => value,
    Type: { Object: fields => ({ fields }), String: () => ({ type: 'string' }) }, version: 'test',
    openRuntime: async () => ({
      outbox: { pending: async () => [], markEmitted: async () => {} },
      subscribeOutboxWake: () => () => {},
      jobs: {
        unnotified: async () => ({ success: true, value: [] }),
        waitForJob: (_id, { signal }) => {
          waitStarted.resolve();
          return new Promise(resolve => {
            const aborted = () => resolve({ success: false, error: { message: 'wait aborted' } });
            if (signal.aborted) aborted();
            else signal.addEventListener('abort', aborted, { once: true });
          });
        },
        cancel: async () => { abortCalls++; },
      },
      seal() {}, async close() { closeCalls++; },
    }),
  });
  const ctx = context('same'); await pi.handlers.get('session_start')({}, ctx);
  const caller = new AbortController();
  const waiting = pi.tools.find(tool => tool.name === 'pi_agents_wait').execute('call', { id: 'job', until: 'terminal', timeout_seconds: '30' }, caller.signal, undefined, ctx);
  await waitStarted.promise;
  await pi.handlers.get('session_start')({}, ctx);
  const result = await waiting;
  assert.equal(result.content[0].text, 'wait aborted');
  assert.equal(abortCalls, 0);
  assert.equal(closeCalls, 1);
  await pi.handlers.get('session_shutdown')();
});

test('registra las tools de consulta y control con parámetros separados', () => {
  const pi = fakePi();
  registerPiAgents(pi, { getAgentDir: () => '/tmp', createModels: async () => ({}), resolveModel: () => ({}), text: value => value, Type: { Object: fields => ({ fields }), String: () => ({ type: 'string' }) }, version: 'test' });
  assert.deepEqual(pi.tools.map(tool => tool.name), ['pi_agents', 'pi_agents_status', 'pi_agents_list', 'pi_agents_wait', 'pi_agents_result', 'pi_agents_control']);
  assert.ok(pi.tools.slice(1).every(tool => tool.parameters));
  assert.equal(pi.commands.length, 1);
});
