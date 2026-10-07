import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRpcRequest, parseRpcResponse, requestChannel, replyChannel, eventChannel,
  isSafeCorrelation, hasOversizedIds,
} from '../src/public/rpc-contracts.ts';
import { projectJob } from '../src/public/rpc-contracts.ts';
import { JobEventTypes } from '../src/public/job-events.ts';

const valid = {
  protocolVersion: 1, requestId: 'req-1', correlationId: 'corr_1', callerId: 'caller', sessionId: 'session',
  params: { id: 'job-1' },
};
const response = { protocolVersion: 1, requestId: 'req-1', correlationId: 'corr_1', sessionId: 'session', success: true, data: { id: 'job-1' } };
const provisioningView = {
  id: 'job-1', status: 'provisioning', agent: { name: 'safe', description: '', systemPrompt: 'SECRET_SENTINEL', source: 'project', filePath: '/tmp/a', tools: [] },
  model: { provider: 'openai-codex', modelId: 'gpt-5.6-luna' }, thinkingLevel: 'high', cwd: '/secret/cwd', task: 'SECRET_SENTINEL', createdAt: 1, updatedAt: 2,
  hasResult: false, reviewStatus: 'not_required', consumption: { count: 0, requestIds: ['SECRET_SENTINEL'], lastConsumer: 'SECRET_SENTINEL' }, resultMeta: { error: 'SECRET_SENTINEL' },
};
const sensitiveView = { ...provisioningView, status: 'completed', resultMeta: { error: 'SECRET_SENTINEL' } };

function invalid(value, operation = 'status') { assert.throws(() => parseRpcRequest(operation, value)); }

test('acepta request v1 por operación y conserva solo el contrato', () => {
  assert.deepEqual(parseRpcRequest('status', valid), valid);
  assert.deepEqual(parseRpcRequest('ping', { ...valid, sessionId: undefined, params: {} }), { ...valid, sessionId: undefined, params: {} });
  assert.deepEqual(parseRpcRequest('spawn', { ...valid, params: { agent: 'a', task: 't' } }), { ...valid, params: { agent: 'a', task: 't' } });
  invalid({ ...valid, protocolVersion: 2 });
  invalid({ ...valid, params: { id: 'job-1', unknown: true } });
  invalid({ ...valid, params: { id: 'job-1', actor: 'human' } });
  invalid({ ...valid, params: { id: 'job-1', confirmation: true } });
  invalid({ ...valid, params: { id: 'job-1', cwd: '/tmp' } });
});

test('rechaza valores no JSON, getters y prototipos no permitidos', () => {
  invalid({ ...valid, params: { id: 'job-1', value: 1n } });
  invalid({ ...valid, params: { id: 'job-1', value: NaN } });
  invalid({ ...valid, params: { id: 'job-1', value: () => {} } });
  const circular = { ...valid }; circular.self = circular; invalid(circular);
  const getter = { ...valid, params: { id: 'job-1' } };
  Object.defineProperty(getter.params, 'id', { get() { throw new Error('getter executed'); }, enumerable: true });
  invalid(getter);
  invalid(Object.assign(Object.create({ polluted: true }), valid));
});

test('aplica límites UTF-8, correlación segura e IDs sobredimensionados', () => {
  assert.equal(Buffer.byteLength('é'.repeat(128)), 256);
  assert.equal(parseRpcRequest('status', { ...valid, requestId: 'é'.repeat(128) }).requestId.length, 128);
  invalid({ ...valid, requestId: 'é'.repeat(129) });
  invalid({ ...valid, callerId: 'x'.repeat(257) });
  invalid({ ...valid, correlationId: 'a'.repeat(129) });
  assert.equal(isSafeCorrelation('A-._09'), true);
  assert.equal(isSafeCorrelation('é'), false);
  assert.equal(isSafeCorrelation(''), false);
  assert.equal(hasOversizedIds({ requestId: 'x'.repeat(257) }), true);
  assert.equal(hasOversizedIds({ requestId: 'ok', callerId: 'ok', sessionId: 'ok' }), false);
});

test('valida respuestas success/error mutuamente excluyentes y campos opcionales', () => {
  assert.deepEqual(parseRpcResponse('status', { ...response, data: { id: 'job-1', extra: true } }).data, { id: 'job-1', extra: true });
  assert.deepEqual(parseRpcResponse('status', { ...response, sessionId: undefined }).sessionId, undefined);
  assert.throws(() => parseRpcResponse('status', { ...response, success: false, error: { code: 'INVALID_REQUEST', message: 'x', retryable: false, details: {}, }, data: {} }));
  assert.throws(() => parseRpcResponse('status', { ...response, success: false, error: { code: 'INVALID_REQUEST', message: 'x', retryable: false, details: {} } }));
});

test('expone canales deterministas y eventos v1', () => {
  assert.equal(requestChannel('status'), 'pi-durable-subagents:rpc:status:request');
  assert.equal(replyChannel('status', 'corr-1'), 'pi-durable-subagents:rpc:status:reply:corr-1');
  assert.equal(eventChannel('job.queued'), 'pi-durable-subagents:event:job.queued');
  assert.ok(JobEventTypes.includes('job.consumed'));
});

test('proyecta únicamente datos públicos y traduce provisioning a running', () => {
  assert.equal(projectJob(provisioningView).status, 'running');
  const output = JSON.stringify(projectJob(sensitiveView));
  assert.equal(output.includes('SECRET_SENTINEL'), false);
  assert.deepEqual(Object.keys(projectJob(provisioningView)).sort(), ['agent', 'consumption', 'createdAt', 'hasResult', 'id', 'model', 'reviewStatus', 'status', 'updatedAt']);
});
