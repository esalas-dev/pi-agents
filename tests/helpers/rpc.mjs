import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { makeStoreFixture } from './store.mjs';
import { createQueryService } from '../../src/application/query.ts';
import { createWaitService } from '../../src/application/wait.ts';
import { createResultService } from '../../src/application/result.ts';
import { createReviewService } from '../../src/application/review.ts';
import { createControlService } from '../../src/application/control.ts';
import { createStartService } from '../../src/application/start.ts';
import { createJobsService } from '../../src/application/jobs.ts';
import { createGeneration } from '../../src/runtime/generation.ts';
import { requestChannel, replyChannel } from '../../src/public/rpc-contracts.ts';
import { registerRpcServer } from '../../src/adapters/pi/rpc.ts';

const model = { provider: 'faux', modelId: 'faux-1' };
const agent = { name: 'agent-a', description: 'Agent A', systemPrompt: 'private prompt', source: 'personal', filePath: '/private/agent.md', tools: [] };
const resolve = async intent => ({ task: intent.task, cwd: intent.cwd, agent: { ...agent, name: intent.agent }, model, thinkingLevel: 'off' });

export function makeEventBus() {
  const listeners = new Map();
  const emitted = [];
  const bus = {
    emitted,
    emit(channel, data) {
      emitted.push({ channel, data: structuredClone(data) });
      for (const handler of [...(listeners.get(channel) ?? [])]) handler(data);
    },
    on(channel, handler) {
      let set = listeners.get(channel);
      if (!set) listeners.set(channel, set = new Set());
      set.add(handler);
      return () => { set.delete(handler); if (set.size === 0) listeners.delete(channel); };
    },
    listenerCount(channel) { return listeners.get(channel)?.size ?? 0; },
  };
  return bus;
}

export function makeFakeTimers() {
  let now = 0;
  let nextId = 1;
  const tasks = new Map();
  return {
    api: {
      setTimeout(handler, ms) { const id = nextId++; tasks.set(id, { at: now + ms, handler }); return id; },
      clearTimeout(id) { tasks.delete(id); },
    },
    advance(ms) {
      now += ms;
      while (true) {
        const due = [...tasks].filter(([, task]) => task.at <= now).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        tasks.delete(due[0]);
        due[1].handler();
      }
    },
    get pending() { return tasks.size; },
  };
}

export function rpcRequest(operation, params, overrides = {}) {
  return {
    protocolVersion: 1,
    requestId: 'rpc-request-1',
    correlationId: `rpc-${operation}-1`,
    callerId: 'trusted-extension',
    ...(operation === 'ping' ? {} : { sessionId: 'rpc-session' }),
    params,
    ...overrides,
  };
}

export function observeRpc(fixture, operation, request = rpcRequest(operation, {})) {
  const replies = [];
  let resolve;
  const response = new Promise(done => { resolve = done; });
  const unsubscribe = fixture.bus.on(replyChannel(operation, request.correlationId), value => { replies.push(value); resolve(value); });
  fixture.bus.emit(requestChannel(operation), request);
  return { response, replies, unsubscribe };
}

export const flushRpc = () => new Promise(resolve => setImmediate(resolve));

export async function makeRpcFixture({ runtime: runtimeOverride, mode = 'tui', hasUI = mode === 'tui', confirm = async () => true, timers, resolver = resolve } = {}) {
  const store = await makeStoreFixture({ sessionId: 'rpc-session', createId: (() => { let id = 0; return () => `rpc-job-${++id}`; })() });
  const createJobs = () => {
    const query = createQueryService(store.repository);
    const wait = createWaitService(query, store.session, BACKGROUND_CONTEXT);
    const result = createResultService(store.repository, query, () => 2000);
    const review = createReviewService(store.repository, () => 2000);
    const control = createControlService(store.repository, () => 2000);
    const start = createStartService(store.repository, () => {}, () => {});
    return createJobsService(store.repository, start, wait, result, review, query, control);
  };
  let jobs = createJobs();
  const runtime = runtimeOverride ?? { jobs, outbox: store.outbox, subscribeOutboxWake: () => () => {}, seal() {}, close: async () => {} };
  const bus = makeEventBus();
  const generation = createGeneration('rpc-session');
  generation.activate();
  const context = { cwd: '/tmp/project', mode, hasUI, ui: { confirm }, sessionManager: { getSessionId: () => 'rpc-session' } };
  const state = { sessionId: 'rpc-session', runtime, models: {}, context, generation };
  const server = registerRpcServer({ bus, state, resolve: resolver, confirmActiveCancellation: id => confirm(id, generation), ...(timers ? { timers } : {}) });
  let closed = false;
  return {
    store, get jobs() { return jobs; }, runtime, bus, generation, state, server, resolve: resolver,
    setJobs(overrides) { runtime.jobs = { ...jobs, ...overrides }; },
    async reopen() { await store.reopen(); jobs = createJobs(); runtime.jobs = jobs; },
    seedJob(id, overrides = {}, withResult = false) {
      const record = {
        id, status: 'queued', task: `private task ${id}`, cwd: '/private/workspace', createdAt: 1000, updatedAt: 1000,
        agent: structuredClone(agent), model, thinkingLevel: 'off', notified: false,
        createdBy: { kind: 'extension', id: 'trusted-extension' },
        ...overrides,
      };
      const body = withResult ? { finalResponse: 'resulto completo', durationMs: 10, model, status: 'completed' } : undefined;
      return store.seedJob(record, body);
    },
    async seedReview(id, status) {
      const { JobReviewDocFamily } = await import('../../src/infrastructure/durable/documents.ts');
      await store.session.commit(async tx => {
        const reviewDoc = await tx.doc(JobReviewDocFamily, id, { status });
        reviewDoc.status = status;
      }, BACKGROUND_CONTEXT);
    },
    close: async () => {
      if (closed) return;
      closed = true;
      server.seal();
      await server.close();
      generation.seal();
      jobs.seal();
      await store.close();
    },
  };
}
