import { mkdir } from "node:fs/promises";
import * as path from "node:path";
import type { Context } from "@earendil-works/chord";
import { withCancel } from "@earendil-works/chord/context";
import type { Models } from "@earendil-works/pi-ai";
import { createRegistry, Harness, type ToolRegistration } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { createSession } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import type { JobRecord, JobResult } from "../domain/jobs.ts";
import type { Clock, CreateId } from "../domain/requests.ts";
import { DomainError } from "../domain/errors.ts";
import { JobsIndexDoc, StorageMetaDoc } from "../infrastructure/durable/documents.ts";
import { OutboxMetaDoc } from "../infrastructure/durable/outbox-documents.ts";
import { createOutboxRepository, type OutboxRepository } from "../infrastructure/durable/outbox.ts";
import { createJobRepository } from "../infrastructure/durable/repository.ts";
import { inspectStorage } from "../infrastructure/storage/inspect.ts";
import { acquireLease, type Lease } from "../infrastructure/storage/lease.ts";
import { createExecution } from "../infrastructure/durable/execution.ts";
import { createCoordinator } from "./coordinator.ts";
import { createStartService } from "../application/start.ts";
import { createJobsService, type JobsService } from "../application/jobs.ts";
import { createQueryService } from "../application/query.ts";
import { createWaitService } from "../application/wait.ts";
import { createResultService } from "../application/result.ts";
import { createReviewService } from "../application/review.ts";
import { createControlService } from "../application/control.ts";
import { createParentJobsService, type ParentJobsService } from "../application/parent.ts";

export type RuntimeOptions = { storagePath: string; models: Models; context: Context; defaultCwd: string; maxConcurrency: number; sessionId: string; isParentActive?: () => boolean; now?: Clock; createId?: CreateId; onSettled?: (job: JobRecord, result: JobResult) => Promise<void>; onReport?: (error: unknown) => void };
export type SessionRuntime = { jobs: JobsService; parent?: ParentJobsService; outbox: OutboxRepository; subscribeOutboxWake(listener: () => void): () => void; seal(): void; retire(): Promise<void>; close(): Promise<void> };

export async function openSessionRuntime(options: RuntimeOptions): Promise<SessionRuntime> {
  if (typeof options.sessionId !== "string" || !options.sessionId) throw new DomainError("INVALID_REQUEST");
  const report = (error: unknown) => { try { options.onReport?.(error); } catch {} };
  const clock = options.now ?? Date.now; let lease: Lease | undefined; let harness: Awaited<ReturnType<typeof Harness.open>> | undefined;
  let retireOpening: (() => Promise<void>) | undefined;
  try {
    await mkdir(path.dirname(options.storagePath), { recursive: true, mode: 0o700 });
    lease = await acquireLease(options.storagePath); const inspection = await inspectStorage(lease, options.context);
    if (inspection.kind === "legacy-v1" || (inspection.kind === "current" && inspection.schemaVersion !== 5)) throw new DomainError("MIGRATION_REQUIRED");
    if (inspection.kind === "empty") {
      const storage = await openNodeSqliteStorage(lease.dbPath); const session = createSession(storage);
      try { await session.commit(async tx => { const meta = await tx.doc(StorageMetaDoc); meta.storageSchemaVersion = 5; const index = await tx.doc(JobsIndexDoc); index.storageSchemaVersion = 5; await tx.doc(OutboxMetaDoc); }, options.context); }
      finally { await session.close(options.context); }
    }
    const registry = createRegistry(); registry.install(CodingTools);
    const tools = new Map((CodingTools.tools ?? []).map(tool => [tool.name, tool as ToolRegistration]));
    harness = await Harness.open(await openNodeSqliteStorage(lease.dbPath), { models: options.models, registry, settings: { extensions: [CodingTools] }, env: ({ cwd }) => new NodeExecutionEnv({ cwd: cwd ?? options.defaultCwd }), onReport: report }, options.context);
    const outbox = createOutboxRepository(harness, options.context);
    const wakeListeners = new Set<() => void>();
    const unsubscribeCommits = harness.subscribeCommits(() => {
      queueMicrotask(() => {
        for (const listener of [...wakeListeners]) {
          try { listener(); } catch (error) { report(error); }
        }
      });
    });
    const subscribeOutboxWake = (listener: () => void): (() => void) => {
      wakeListeners.add(listener);
      return () => wakeListeners.delete(listener);
    };
    let closed = false;
    const authority = options.sessionId === undefined ? undefined : Object.freeze({ sessionId: options.sessionId, isActive: () => !closed && (options.isParentActive?.() ?? true) });
    const repository = createJobRepository(harness, options.context, clock, options.createId ?? (() => `psa_${Date.now()}_${Math.random().toString(16).slice(2)}`), options.sessionId, authority);
    const observation = withCancel(options.context);
    const execution = createExecution(harness, options.context, tools, clock, observation.context);
    let coordinator: ReturnType<typeof createCoordinator>;
    const query = createQueryService(repository);
    const wait = createWaitService(query, harness, options.context);
    const result = createResultService(repository, query, clock);
    const review = createReviewService(repository, clock);
    const controlService = createControlService(repository, clock);
    const control: ReturnType<typeof createControlService> = { ...controlService, async retry(id, request, parent) {
      const outcome = await controlService.retry(id, request, parent);
      if (outcome.success) coordinator.wake();
      return outcome;
    } };
    const start = createStartService(repository, () => coordinator.wake(), report);
    const jobs = createJobsService(repository, start, wait, result, review, query, control);
    const parent = authority ? createParentJobsService(authority, start, control, review) : undefined;
    coordinator = createCoordinator({ repository, execution, maxConcurrency: options.maxConcurrency, clock, onSettled: options.onSettled, report });
    let retiring: Promise<void> | undefined;
    let completion: Promise<void> | undefined;
    let closing: Promise<void> | undefined;
    const seal = () => {
      if (closed) return;
      closed = true;
      jobs.seal();
      coordinator.stop();
      observation.cancel();
      unsubscribeCommits(); wakeListeners.clear();
    };
    const retire = () => {
      if (!retiring) {
        seal();
        retiring = (async () => {
          await repository.drainParent();
          await coordinator.drain();
          // shortcut: SDK 1.0.1 puede retener el lease; simplificar solo con una API de cierre verificada.
          completion = (async () => {
            await harness?.close(options.context);
            harness = undefined;
            await lease?.release();
            lease = undefined;
          })();
          void completion.catch(report);
        })();
      }
      return retiring;
    };
    retireOpening = retire;
    await coordinator.recover();
    return { jobs, ...(parent ? { parent } : {}), outbox, subscribeOutboxWake, seal, retire, close() { return closing ??= retire().then(() => completion); } };
  } catch (error) {
    if (retireOpening) {
      try { await retireOpening(); } catch (cleanupError) { report(cleanupError); }
    } else if (harness) {
      // Opening failed before any application observer existed; SDK still owns its storage.
      const failedHarness = harness;
      void (async () => { await failedHarness.close(options.context); await lease?.release(); })().catch(report);
    } else {
      await lease?.release();
    }
    throw error;
  }
}
