import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRpcRequest, parseRpcResponse, requestChannel, replyChannel, eventChannel,
  isSafeCorrelation, hasOversizedIds, RpcValidationError,
} from '../src/public/rpc-contracts.ts';
import { JobEventTypes } from '../src/public/job-events.ts';

const valid = {
  protocolVersion: 1, requestId: 'req-1', correlationId: 'corr_1', callerId: 'caller', sessionId: 'session',
  params: { id: 'job-1' },
};
const job = {
  id: 'job-1', status: 'queued', agent: 'safe',
  model: { provider: 'openai-codex', modelId: 'gpt-5.6-luna' },
  createdAt: 1, updatedAt: 2, hasResult: false, reviewStatus: 'not_required',
  consumption: { count: 0 },
};
const response = { protocolVersion: 1, requestId: 'req-1', correlationId: 'corr_1', sessionId: 'session', success: true, data: job };
const provisioningView = {
  id: 'job-1', status: 'provisioning', agent: { name: 'safe', description: '', systemPrompt: 'SECRET_SENTINEL', source: 'project', filePath: '/tmp/a', tools: [] },
  model: { provider: 'openai-codex', modelId: 'gpt-5.6-luna' }, thinkingLevel: 'high', cwd: '/secret/cwd', task: 'SECRET_SENTINEL', createdAt: 1, updatedAt: 2,
  hasResult: false, reviewStatus: 'not_required', consumption: { count: 0, requestIds: ['SECRET_SENTINEL'], lastConsumer: 'SECRET_SENTINEL' }, resultMeta: { error: 'SECRET_SENTINEL' },
};
function invalid(value, operation = 'status') { assert.throws(() => parseRpcRequest(operation, value), RpcValidationError); }
function errorResponse(error) { const { data, ...base } = response; return { ...base, success: false, error }; }

 test('valida requests por operación, sesión y límites sin cuotas inventadas', () => {
  assert.deepEqual(parseRpcRequest('status', valid), valid);
  assert.deepEqual(parseRpcRequest('ping', { ...valid, sessionId: undefined, params: {} }).params, {});
  assert.equal(parseRpcRequest('spawn', { ...valid, params: { agent: 'a', task: 't'.repeat(257) } }).params.task.length, 257);
  invalid({ ...valid, protocolVersion: 2 });
  assert.throws(() => parseRpcRequest('status', { ...valid, protocolVersion: 2 }), e => e.code === 'PROTOCOL_UNSUPPORTED');
  invalid({ ...valid, params: { id: 'job-1', unknown: true } });
  invalid({ ...valid, params: { id: 'job-1', actor: 'human' } });
  invalid({ ...valid, params: { id: 'job-1', confirmation: true } });
  invalid({ ...valid, params: { id: 'job-1', cwd: '/tmp' } });
  invalid({ ...valid, sessionId: undefined });
});

test('rechaza grafo no JSON, ciclos, prototipos y accessors sin ejecutar getters', () => {
  invalid({ ...valid, params: { id: 'job-1', value: 1n } });
  invalid({ ...valid, params: { id: 'job-1', value: NaN } });
  invalid({ ...valid, params: { id: 'job-1', value: () => {} } });
  const circular = { ...valid }; circular.self = circular; invalid(circular);
  let calls = 0;
  const array = [];
  Object.defineProperty(array, '0', { enumerable: true, get() { calls++; return 'x'; } });
  invalid({ ...valid, params: { id: 'job-1', array } });
  assert.equal(calls, 0);
  const getter = { ...valid, params: { id: 'job-1' } };
  Object.defineProperty(getter.params, 'id', { get() { calls++; return 'job-1'; }, enumerable: true });
  invalid(getter);
  invalid(Object.assign(Object.create({ polluted: true }), valid));
});

test('aplica UTF-8, correlación e IDs sobredimensionados', () => {
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

test('valida DTO completo por operación, códigos y adición informativa', () => {
  assert.equal(parseRpcResponse('status', { ...response, futureInfo: true }).data.id, 'job-1');
  assert.throws(() => parseRpcResponse('status', { ...response, data: { id: 'job-1' } }));
  for (const code of ['UNKNOWN', 'CONTROL_CONFLICT', 'ACTIVE_CANCEL_CONFIRMATION_REQUIRED']) {
    assert.throws(() => parseRpcResponse('status', { ...response, success: false, data: undefined, error: { code, message: 'x', retryable: false, details: {} } }));
  }
  assert.throws(() => parseRpcResponse('status', { ...response, success: false, error: { code: 'INVALID_REQUEST', message: 'x', retryable: false, details: {} }, data: job }));
  assert.throws(() => parseRpcResponse('status', { ...response, success: false, error: { code: 'INVALID_REQUEST', message: 'x', retryable: false, details: {} } }));
  assert.throws(() => parseRpcResponse('status', { ...response, data: { ...job, id: undefined } }));
  assert.throws(() => parseRpcResponse('status', { ...response, success: false, error: { code: 'JOB_NOT_FOUND', message: 'x', retryable: false, details: {} } }));
  assert.throws(() => parseRpcResponse('review', { ...response, success: false, error: { code: 'JOB_NOT_FOUND', message: 'x', retryable: false, details: {} } }));
  assert.equal(parseRpcResponse('review', errorResponse({ code: 'RPC_REVIEW_FORBIDDEN', message: 'x', retryable: false, details: {} })).error.code, 'RPC_REVIEW_FORBIDDEN');
  assert.throws(() => parseRpcResponse('status', { ...response, success: false, error: { code: 'INVALID_REQUEST', message: 'x', retryable: false, details: { secret: true } } }));
});

test('exige tipos estrictos en estados, acciones, códigos y opcionales de control', () => {
  assert.throws(() => parseRpcRequest('control', { ...valid, params: { id: 'job-1', action: ['pause'] } }));
  assert.throws(() => parseRpcRequest('list', { ...valid, params: { statuses: ['queued'], createdAfter: 10, createdBefore: 1 } }));
  assert.throws(() => parseRpcResponse('status', { ...response, data: { ...job, reviewStatus: ['approved'] } }));
  assert.throws(() => parseRpcResponse('control', { ...response, data: { jobId: 'j', requestId: 'r', action: ['pause'], previousStatus: 'queued', status: 'paused', replayed: false, appliedAt: 1 } }));
  for (const patch of [{ retryJobId: 1 }, { retryOf: null }, { attemptNumber: -1 }, { attemptNumber: 1.5 }]) {
    assert.throws(() => parseRpcResponse('control', { ...response, data: { jobId: 'j', requestId: 'r', action: 'retry', previousStatus: 'queued', status: 'queued', replayed: false, appliedAt: 1, ...patch } }));
  }
});

test('distingue errores previos de transporte y deriva códigos runtime del dominio', async () => {
  const { runtimeErrorCodes } = await import('../src/domain/errors.ts');
  assert.ok(runtimeErrorCodes.includes('JOB_NOT_FOUND'));
  assert.ok(runtimeErrorCodes.includes('CONTROL_CONFLICT'));
  assert.throws(() => parseRpcRequest('review', { ...valid, protocolVersion: 2, params: {} }), e => e.code === 'PROTOCOL_UNSUPPORTED');
  assert.equal(parseRpcResponse('review', errorResponse({ code: 'PROTOCOL_UNSUPPORTED', message: 'x', retryable: false, details: {} })).error.code, 'PROTOCOL_UNSUPPORTED');
  assert.equal(parseRpcResponse('review', errorResponse({ code: 'RPC_SHUTTING_DOWN', message: 'x', retryable: false, details: {} })).error.code, 'RPC_SHUTTING_DOWN');
});

test('mantiene positivos informativos sin cuotas silenciosas y valida IDs', async () => {
  const long = 'x'.repeat(257);
  assert.equal(parseRpcRequest('spawn', { ...valid, params: { agent: long, task: long } }).params.agent.length, 257);
  assert.equal(parseRpcResponse('status', { ...response, data: { ...job, agent: long, model: { provider: long, modelId: long } } }).data.agent.length, 257);
  assert.equal(parseRpcResponse('list', { ...response, data: { items: [], nextCursor: long } }).data.nextCursor.length, 257);
  assert.equal(parseRpcResponse('result', { ...response, data: { job, result: { text: long, totalBytes: 257, sha256: 'hash', truncated: false, durationMs: 1, model: { provider: 'p', modelId: 'm' }, status: 'completed' } } }).data.result.text.length, 257);
  assert.throws(() => parseRpcRequest('status', { ...valid, sessionId: long }));
  assert.throws(() => parseRpcResponse('status', { ...response, requestId: long }));
});

test('valida data específica de list/spawn/result y discovery', () => {
  assert.deepEqual(parseRpcResponse('list', { ...response, data: { items: [job] } }).data.items, [job]);
  assert.deepEqual(parseRpcResponse('spawn', { ...response, data: { jobId: 'j', status: 'queued', agent: 'a' } }).data.status, 'queued');
  assert.throws(() => parseRpcResponse('spawn', { ...response, data: { jobId: 'j', status: 'running', agent: 'a' } }));
  assert.throws(() => parseRpcResponse('ping', { ...response, data: {} }));
});

test('expone canales deterministas y eventos v1', () => {
  assert.equal(requestChannel('status'), 'pi-durable-subagents:rpc:status');
  assert.equal(replyChannel('status', 'corr-1'), 'pi-durable-subagents:rpc:status:reply:corr-1');
  assert.equal(eventChannel('job.queued'), 'pi-durable-subagents:job:queued');
  assert.ok(JobEventTypes.includes('job.consumed'));
});

test('proyecta únicamente datos públicos y traduce provisioning a running', async () => {
  const { projectJob } = await import('../src/public/rpc-contracts.ts');
  assert.equal(projectJob(provisioningView).status, 'running');
  const output = JSON.stringify(projectJob(provisioningView));
  assert.equal(output.includes('SECRET_SENTINEL'), false);
  assert.deepEqual(Object.keys(projectJob(provisioningView)).sort(), ['agent', 'consumption', 'createdAt', 'hasResult', 'id', 'model', 'reviewStatus', 'status', 'updatedAt']);
});
