import test from 'node:test';
import assert from 'node:assert/strict';
import { CommandSyntaxError, parsePiAgentsCommand, tokenizeCommandLine } from '../src/command.ts';

test('analiza inicio con tarea entre comillas o sin ellas', () => {
  assert.deepEqual(parsePiAgentsCommand('reviewer "revisa el cambio completo"'), { action: 'start', agent: 'reviewer', task: 'revisa el cambio completo' });
  assert.deepEqual(parsePiAgentsCommand("reviewer 'revisa el diff'"), { action: 'start', agent: 'reviewer', task: 'revisa el diff' });
  assert.deepEqual(parsePiAgentsCommand('reviewer revisa el cambio'), { action: 'start', agent: 'reviewer', task: 'revisa el cambio' });
});

test('analiza status y result con exactamente un id', () => {
  assert.deepEqual(parsePiAgentsCommand('status psa_123'), { action: 'status', id: 'psa_123' });
  assert.deepEqual(parsePiAgentsCommand('result psa_123'), { action: 'result', id: 'psa_123' });
  assert.throws(() => parsePiAgentsCommand('status'), CommandSyntaxError);
  assert.throws(() => parsePiAgentsCommand('result a b'), CommandSyntaxError);
});

test('analiza listado con filtros, cursor y límite', () => {
  assert.deepEqual(parsePiAgentsCommand('list --status queued --status running --limit 10 --cursor abc --pending-review'), { action: 'list', statuses: ['queued', 'running'], limit: 10, cursor: 'abc', pendingReview: true });
  assert.throws(() => parsePiAgentsCommand('list --limit 0'), CommandSyntaxError);
  assert.throws(() => parsePiAgentsCommand('list --status queued --status queued'), CommandSyntaxError);
});

test('analiza espera y decisiones humanas con razón', () => {
  assert.deepEqual(parsePiAgentsCommand('wait job-1 --until completed --timeout 30'), { action: 'wait', id: 'job-1', until: 'completed', timeoutSeconds: 30 });
  assert.deepEqual(parsePiAgentsCommand('approve job-1 --reason "verificado por mí"'), { action: 'approve', id: 'job-1', reason: 'verificado por mí' });
  assert.deepEqual(parsePiAgentsCommand('reject job-1 --reason no'), { action: 'reject', id: 'job-1', reason: 'no' });
  assert.throws(() => parsePiAgentsCommand('wait job-1 --timeout 301'), CommandSyntaxError);
  assert.throws(() => parsePiAgentsCommand('approve job-1 --unknown x'), CommandSyntaxError);
});

test('analiza controles con razón, confirmación explícita y límites', () => {
  assert.deepEqual(parsePiAgentsCommand('cancel job-1 --reason "ya no hace falta" --yes'), { action: 'cancel', id: 'job-1', reason: 'ya no hace falta', yes: true });
  assert.deepEqual(parsePiAgentsCommand('pause job-1'), { action: 'pause', id: 'job-1', yes: false });
  assert.deepEqual(parsePiAgentsCommand('resume job-1 --yes'), { action: 'resume', id: 'job-1', yes: true });
  assert.deepEqual(parsePiAgentsCommand('retry job-1'), { action: 'retry', id: 'job-1', yes: false });
  assert.throws(() => parsePiAgentsCommand('cancel job-1 --reason'), CommandSyntaxError);
  assert.throws(() => parsePiAgentsCommand('cancel job-1 --reason ""'), CommandSyntaxError);
  assert.throws(() => parsePiAgentsCommand(`cancel job-1 --reason ${'x'.repeat(2049)}`), CommandSyntaxError);
});

test('usa /subagents en la ayuda de sintaxis', () => {
  assert.throws(() => parsePiAgentsCommand(''), /Uso: \/subagents/);
});

test('rechaza comillas abiertas y conserva escapes en comillas dobles', () => {
  assert.deepEqual(tokenizeCommandLine('agent "usa \\"npm test\\""'), ['agent', 'usa "npm test"']);
  assert.throws(() => tokenizeCommandLine('agent "incompleta'), /comilla sin cerrar/);
  assert.throws(() => parsePiAgentsCommand(''), /Uso:/);
});
