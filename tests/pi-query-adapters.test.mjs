import test from 'node:test';
import assert from 'node:assert/strict';
import { registerPiAgents } from '../src/adapters/pi/register.ts';

function fakePi() {
  const tools = []; const commands = [];
  return { tools, commands, on() {}, registerTool(tool) { tools.push(tool); }, registerCommand(name, command) { commands.push({ name, ...command }); }, registerEntryRenderer() {}, appendEntry() {} };
}

test('registra las cuatro tools de consulta con parámetros separados', () => {
  const pi = fakePi();
  registerPiAgents(pi, { getAgentDir: () => '/tmp', createModels: async () => ({}), resolveModel: () => ({}), text: value => value, Type: { Object: fields => ({ fields }), String: () => ({ type: 'string' }) }, version: 'test' });
  assert.deepEqual(pi.tools.map(tool => tool.name), ['pi_agents', 'pi_agents_status', 'pi_agents_list', 'pi_agents_wait', 'pi_agents_result']);
  assert.ok(pi.tools.slice(1).every(tool => tool.parameters));
  assert.equal(pi.commands.length, 1);
});
