import { mkdir } from "node:fs/promises";
import * as path from "node:path";
import type { Context } from "@earendil-works/chord";
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

export type RuntimeOptions = { storagePath: string; models: Models; context: Context; defaultCwd: string; maxConcurrency: number; sessionId: string; now?: Clock; createId?: CreateId; onSettled?: (job: JobRecord, result: JobResult) => Promise<void>; onReport?: (error: unknown) => void };
export type SessionRuntime = { jobs: JobsService; close(): Promise<void> };

export async function openSessionRuntime(options: RuntimeOptions): Promise<SessionRuntime> {
  const report = options.onReport ?? (() => {}); const clock = options.now ?? Date.now; let lease: Lease | undefined; let harness: Awaited<ReturnType<typeof Harness.open>> | undefined;
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
    const repository = createJobRepository(harness, options.context, clock, options.createId ?? (() => `psa_${Date.now()}_${Math.random().toString(16).slice(2)}`), options.sessionId);
    const execution = createExecution(harness, options.context, tools, clock);
    let coordinator: ReturnType<typeof createCoordinator>;
    const query = createQueryService(repository);
    const wait = createWaitService(query, harness, options.context);
    const result = createResultService(repository, query, clock);
    const review = createReviewService(repository, clock);
    const control = createControlService(repository, clock);
    const start = createStartService(repository, () => coordinator.wake(), report);
    const jobs = createJobsService(repository, start, wait, result, review, query, control);
    coordinator = createCoordinator({ repository, execution, maxConcurrency: options.maxConcurrency, clock, onSettled: options.onSettled, report });
    await coordinator.recover();
    let closed = false;
    return { jobs, async close() { if (closed) return; closed = true; start.seal(); coordinator.stop(); await coordinator.drain(); await harness?.close(options.context); harness = undefined; await lease?.release(); lease = undefined; } };
  } catch (error) { try { await harness?.close(options.context); } finally { await lease?.release(); } throw error; }
}
