import test from 'node:test';
import assert from 'node:assert/strict';
import { formatToolResultResponse, registerPiAgents } from '../src/adapters/pi/register.ts';

function fakePi() {
  const tools = []; const commands = [];
  return { tools, commands, on() {}, registerTool(tool) { tools.push(tool); }, registerCommand(name, command) { commands.push({ name, ...command }); }, registerEntryRenderer() {}, appendEntry() {} };
}

test('no expone el cuerpo completo del resultado en details de una tool', () => {
  const value = { job: { id: 'job-1', status: 'completed' }, result: { finalResponse: 'x'.repeat(70_000) } };
  const response = formatToolResultResponse(value);
  assert.ok(Buffer.byteLength(response.content[0].text) <= 64 * 1024);
  assert.equal(response.details.result.finalResponse, undefined);
  assert.equal(response.details.result.truncated, true);
});

test('registra las tools de consulta y control con parámetros separados', () => {
  const pi = fakePi();
  registerPiAgents(pi, { getAgentDir: () => '/tmp', createModels: async () => ({}), resolveModel: () => ({}), text: value => value, Type: { Object: fields => ({ fields }), String: () => ({ type: 'string' }) }, version: 'test' });
  assert.deepEqual(pi.tools.map(tool => tool.name), ['pi_agents', 'pi_agents_status', 'pi_agents_list', 'pi_agents_wait', 'pi_agents_result', 'pi_agents_control']);
  assert.ok(pi.tools.slice(1).every(tool => tool.parameters));
  assert.equal(pi.commands.length, 1);
});
