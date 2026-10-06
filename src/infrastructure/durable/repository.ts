import type { Context, JsonValue } from "@earendil-works/chord";
import type { Session, Tx } from "@earendil-works/pi-durable";
import type { JobRecord, JobResult } from "../../domain/jobs.ts";
import { assertJob, assertResult } from "../../domain/jobs.ts";
import type { Clock, CreateId } from "../../domain/requests.ts";
import { DomainError } from "../../domain/errors.ts";
import { JobDocFamily, JobResultDocFamily, JobsIndexDoc, StorageMetaDoc } from "./documents.ts";

export type CreateConversation = (tx: Tx, job: JobRecord) => Promise<number>;
export type JobRepository = {
  get(id: string): Promise<JobRecord | undefined>;
  result(id: string): Promise<JobResult | undefined>;
  queuedPosition(id: string): Promise<number | undefined>;
  active(): Promise<JobRecord[]>;
  unnotified(): Promise<JobRecord[]>;
  markNotified(id: string): Promise<void>;
  finish(id: string, result: JobResult, at: number): Promise<void>;
  markRunning(id: string, submissionId: number, at: number): Promise<void>;
  create(job: JobRecord, result?: JobResult): Promise<void>;
  claimNext(maxConcurrency: number, createConversation: CreateConversation): Promise<JobRecord | undefined>;
};

const activeStatuses = new Set(["provisioning", "running"]);
const terminalStatuses = new Set(["completed", "failed", "interrupted"]);

function summary(job: JobRecord, hasResult = Boolean(job.result)) {
  return { id: job.id, status: job.status, agent: job.agent.name, createdAt: job.createdAt, updatedAt: job.updatedAt, hasResult, notified: job.notified };
}

function storedJob(job: JobRecord): JobRecord {
  const copy = structuredClone(job);
  delete copy.result;
  return copy;
}

function plain<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }

export function createJobRepository(session: Session, context: Context, clock: Clock, _createId: CreateId): JobRepository {
  const readIndex = async () => await session.snapshot(JobsIndexDoc, context);
  const readJob = async (id: string) => await session.snapshot(JobDocFamily, id, context) as JobRecord | undefined;
  const writeIndexFor = async (tx: Tx, job: JobRecord, remove = false, hasResult = Boolean(job.result)) => {
    const index = await tx.doc(JobsIndexDoc);
    if (remove) {
      delete index.summaries[job.id];
      index.order = index.order.filter((id: string) => id !== job.id);
      return;
    }
    index.summaries[job.id] = summary(job, hasResult);
    if (!index.order.includes(job.id) && job.status === "queued") index.order.push(job.id);
    if (job.status !== "queued") index.order = index.order.filter((id: string) => id !== job.id);
  };
  const commitJob = async (tx: Tx, job: JobRecord, result?: JobResult) => {
    const stored = await tx.doc(JobDocFamily, job.id, storedJob(job));
    Object.assign(stored, storedJob(job));
    if (result) {
      const body = await tx.doc(JobResultDocFamily, job.id, result);
      Object.assign(body, structuredClone(result));
    }
    await writeIndexFor(tx, job, false, Boolean(result));
  };
  return {
    async get(id) { return structuredClone(await readJob(id)); },
    async result(id) {
      const job = await readJob(id);
      if (!job) return undefined;
      const index = await readIndex();
      if (!index?.summaries[id]?.hasResult) return undefined;
      const result = await session.snapshot(JobResultDocFamily, id, context) as JobResult | undefined;
      return structuredClone(result);
    },
    async queuedPosition(id) {
      const index = await readIndex();
      const position = index?.order.indexOf(id) ?? -1;
      return position < 0 ? undefined : position + 1;
    },
    async active() {
      const index = await readIndex();
      if (!index) return [];
      const jobs = await Promise.all(Object.values(index.summaries).filter(item => activeStatuses.has(item.status)).map(item => readJob(item.id)));
      return jobs.filter((job): job is JobRecord => Boolean(job)).map(job => structuredClone(job));
    },
    async unnotified() {
      const index = await readIndex();
      if (!index) return [];
      const jobs = await Promise.all(Object.values(index.summaries).filter(item => terminalStatuses.has(item.status) && !item.notified).map(item => readJob(item.id)));
      return jobs.filter((job): job is JobRecord => Boolean(job)).map(job => structuredClone(job));
    },
    async markNotified(id) {
      await session.commit(async tx => {
        const job = await tx.doc(JobDocFamily, id, null as unknown as JsonValue);
        if (!job || !job.id) return;
        if (!job.notified) { job.notified = true; job.updatedAt = clock(); }
        await writeIndexFor(tx, job);
      }, context);
    },
    async finish(id, result, at) {
      assertResult(result);
      await session.commit(async tx => {
        const job = await tx.doc(JobDocFamily, id, null as unknown as JsonValue);
        if (!job || terminalStatuses.has(job.status)) return;
        job.status = result.status; job.resultMeta = { durationMs: result.durationMs, model: structuredClone(result.model), status: result.status, ...(result.error === undefined ? {} : { error: result.error }) };
        job.finishedAt = at; job.updatedAt = at;
        const body = await tx.doc(JobResultDocFamily, id, result); Object.assign(body, structuredClone(result));
        await writeIndexFor(tx, job, false, true);
      }, context);
    },
    async markRunning(id, submissionId, at) {
      await session.commit(async tx => {
        const job = await tx.doc(JobDocFamily, id, null as unknown as JsonValue);
        if (!job || job.status !== "provisioning") return;
        job.status = "running"; job.submissionId = submissionId; job.startedAt ??= at; job.updatedAt = at;
        await writeIndexFor(tx, job);
      }, context);
    },
    async create(job, result) {
      assertJob(job);
      await session.commit(async tx => { await commitJob(tx, job, result); }, context);
    },
    async claimNext(maxConcurrency, createConversation) {
      let claimed: JobRecord | undefined;
      await session.commit(async tx => {
        const index = await tx.doc(JobsIndexDoc);
        const active = Object.values(index.summaries).filter(item => activeStatuses.has(item.status)).length;
        if (active >= maxConcurrency) return;
        const id = index.order.find(candidate => index.summaries[candidate]?.status === "queued");
        if (!id) return;
        const job = await tx.doc(JobDocFamily, id, null as unknown as JsonValue) as JobRecord;
        if (!job || job.status !== "queued") return;
        job.status = "provisioning"; job.updatedAt = clock();
        job.conversationId = await createConversation(tx, job);
        await writeIndexFor(tx, job);
        claimed = plain(job);
      }, context);
      return claimed;
    },
  };
}

export { StorageMetaDoc };
