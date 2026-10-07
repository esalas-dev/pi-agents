import test from 'node:test';
import assert from 'node:assert/strict';
import { registerPiAgents, canConfirmMigration } from '../src/adapters/pi/register.ts';
import { formatControl } from '../src/adapters/pi/display.ts';

function fakePi() {
  const tools = []; const commands = [];
  return { tools, commands, on() {}, registerTool(tool) { tools.push(tool); }, registerCommand(name, command) { commands.push({ name, ...command }); }, registerEntryRenderer() {}, appendEntry() {} };
}

test('registra la tool de control con request_id, acción y razón', () => {
  const pi = fakePi();
  registerPiAgents(pi, { getAgentDir: () => '/tmp', createModels: async () => ({}), resolveModel: () => ({}), text: value => value, Type: { Object: fields => ({ fields }), String: () => ({ type: 'string' }) }, version: 'test' });
  const tool = pi.tools.find(item => item.name === 'pi_agents_control');
  assert.ok(tool);
  assert.deepEqual(Object.keys(tool.parameters.fields), ['id', 'action', 'request_id', 'reason']);
  assert.equal(formatControl({ jobId: 'job-1', action: 'cancel', status: 'cancelled', replayed: false }), 'Trabajo job-1: cancel → cancelled');
  assert.equal(canConfirmMigration({ mode: 'tui', hasUI: true }), true);
  assert.equal(canConfirmMigration({ mode: 'rpc', hasUI: false }), false);
});
