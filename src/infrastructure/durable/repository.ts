import { createHash } from "node:crypto";
import type { Context, JsonValue } from "@earendil-works/chord";
import type { Session, Tx } from "@earendil-works/pi-durable";
import type { ConsumptionState, JobRecord, JobResult } from "../../domain/jobs.ts";
import { assertJob, assertResult } from "../../domain/jobs.ts";
import type { AdmissionReceipt, Clock, CreateId, ConsumeReceipt, ConsumeRequest, ControlReceipt, ControlRequest, RequestRecord, RetryReceipt, RetryRequest, ReviewReceipt, StartRequest } from "../../domain/requests.ts";
import { assertControlRequest, canonicalJson } from "../../domain/requests.ts";
import { DomainError } from "../../domain/errors.ts";
import { JobConsumptionDocFamily, JobDocFamily, JobResultDocFamily, JobReviewDocFamily, JobsIndexDoc, RequestLedgerDocFamily, StorageMetaDoc, type JobsIndex, type JobReviewDocument } from "./documents.ts";

export type CreateConversation = (tx: Tx, job: JobRecord) => Promise<number>;
export type JobRepository = {
  get(id: string): Promise<JobRecord | undefined>;
  index(): Promise<JobsIndex | undefined>;
  review(id: string): Promise<JobReviewDocument | undefined>;
  consumption(id: string): Promise<ConsumptionState | undefined>;
  decideReview(id: string, decision: { requestId: string; status: "approved" | "rejected"; actor: { kind: "human"; id?: string }; reason?: string }, at: number): Promise<ReviewReceipt>;
  applyControl(id: string, request: ControlRequest, at: number): Promise<ControlReceipt>;
  retry(id: string, request: RetryRequest, at: number): Promise<RetryReceipt>;
  consume(id: string, request: ConsumeRequest, at: number): Promise<ConsumeReceipt>;
  result(id: string): Promise<JobResult | undefined>;
  queuedPosition(id: string): Promise<number | undefined>;
  active(): Promise<JobRecord[]>;
  unnotified(): Promise<JobRecord[]>;
  markNotified(id: string): Promise<void>;
  finish(id: string, result: JobResult, at: number): Promise<void>;
  markRunning(id: string, submissionId: number, at: number): Promise<void>;
  create(job: JobRecord, result?: JobResult): Promise<void>;
  claimNext(maxConcurrency: number, createConversation: CreateConversation): Promise<JobRecord | undefined>;
  receipt(requestId: string): Promise<RequestRecord | undefined>;
  admit(request: StartRequest & { payloadHash: string }, input: Omit<JobRecord, "id" | "status" | "createdAt" | "updatedAt" | "notified">): Promise<AdmissionReceipt>;
};

const activeStatuses = new Set(["provisioning", "running"]);
const terminalStatuses = new Set(["completed", "failed", "interrupted", "cancelled"]);

function initialReviewStatus(job: Pick<JobRecord, "createdBy">): "pending" | "not_required" {
  return job.createdBy?.kind === "model" || job.createdBy?.kind === "extension" ? "pending" : "not_required";
}
function summary(job: JobRecord, hasResult = Boolean(job.result), reviewStatus = initialReviewStatus(job)) {
  return { id: job.id, status: job.status, agent: job.agent.name, createdAt: job.createdAt, updatedAt: job.updatedAt, hasResult, notified: job.notified, reviewStatus };
}

function storedJob(job: JobRecord): JobRecord {
  const copy = structuredClone(job);
  delete copy.result;
  return copy;
}

function plain<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }

export function createJobRepository(session: Session, context: Context, clock: Clock, createId: CreateId): JobRepository {
  const readIndex = async () => await session.snapshot(JobsIndexDoc, context);
  const readJob = async (id: string) => await session.snapshot(JobDocFamily, id, context) as JobRecord | undefined;
  const writeIndexFor = async (tx: Tx, job: JobRecord, remove = false, hasResult?: boolean) => {
    const index = await tx.doc(JobsIndexDoc);
    if (remove) {
      delete index.summaries[job.id];
      index.order = index.order.filter((id: string) => id !== job.id);
      return;
    }
    index.summaries[job.id] = summary(job, hasResult ?? index.summaries[job.id]?.hasResult ?? Boolean(job.result), index.summaries[job.id]?.reviewStatus ?? initialReviewStatus(job));
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
    async receipt(requestId) {
      const key = createHash("sha256").update(requestId).digest("hex");
      const cell = await session.snapshot(RequestLedgerDocFamily, key, context) as { record: RequestRecord | null } | undefined;
      return cell?.record ? structuredClone(cell.record) : undefined;
    },
    async admit(request, input) {
      const key = createHash("sha256").update(request.requestId).digest("hex");
      let receipt: AdmissionReceipt | undefined;
      await session.commit(async tx => {
        const cell = await tx.doc(RequestLedgerDocFamily, key, null);
        const existing = cell.record as RequestRecord | null;
        if (existing) {
          if (existing.requestId !== request.requestId || existing.operation !== "start" || existing.actor.kind !== request.actor.kind || existing.actor.id !== request.actor.id || existing.payloadHash !== request.payloadHash) throw new DomainError("REQUEST_ID_CONFLICT");
          receipt = plain(existing.response);
          return;
        }
        const id = createId();
        const now = clock();
        const job: JobRecord = { ...structuredClone(input), createdBy: structuredClone(request.actor), id, status: "queued", createdAt: now, updatedAt: now, notified: false };
        assertJob(job);
        const admitted: RequestRecord = { requestId: request.requestId, operation: "start", actor: structuredClone(request.actor), canonicalVersion: 1, payloadHash: request.payloadHash, admittedAt: now, response: { jobId: id, status: "queued", agent: job.agent.name } };
        cell.record = admitted;
        await commitJob(tx, job);
        const review = await tx.doc(JobReviewDocFamily, id, { status: initialReviewStatus(job) });
        review.status = initialReviewStatus(job);
        receipt = structuredClone(admitted.response);
      }, context);
      if (!receipt) throw new DomainError("STORAGE_ERROR");
      return receipt;
    },
    async get(id) { return structuredClone(await readJob(id)); },
    async index() { return structuredClone(await readIndex()); },
    async review(id) {
      return structuredClone(await session.snapshot(JobReviewDocFamily, id, context) as JobReviewDocument | undefined);
    },
    async consumption(id) {
      return structuredClone(await session.snapshot(JobConsumptionDocFamily, id, context) as ConsumptionState | undefined);
    },
    async decideReview(id, decision, at) {
      let receipt: ReviewReceipt | undefined;
      await session.commit(async tx => {
        const job = await tx.doc(JobDocFamily, id, null as unknown as JsonValue) as JobRecord | undefined;
        if (!job) throw new DomainError("JOB_NOT_FOUND");
        const review = await tx.doc(JobReviewDocFamily, id, { status: "not_required" });
        const payloadHash = createHash("sha256").update(canonicalJson({ version: 1, operation: "review", jobId: id, status: decision.status, actor: decision.actor, reason: decision.reason })).digest("hex");
        const key = createHash("sha256").update(decision.requestId).digest("hex");
        const cell = await tx.doc(RequestLedgerDocFamily, key, null);
        const existing = cell.record as RequestRecord | null;
        if (existing) {
          if (existing.requestId !== decision.requestId || existing.operation !== "review" || existing.payloadHash !== payloadHash) throw new DomainError("REQUEST_ID_CONFLICT");
          receipt = plain(existing.receipt) as ReviewReceipt;
          return;
        }
        review.status = decision.status; review.decidedAt = at; review.decidedBy = decision.actor.id; review.reason = decision.reason;
        const index = await tx.doc(JobsIndexDoc);
        if (index.summaries[id]) index.summaries[id].reviewStatus = decision.status;
        const decided: ReviewReceipt = { jobId: id, requestId: decision.requestId, status: decision.status, decidedAt: at, ...(decision.actor.id === undefined ? {} : { decidedBy: decision.actor.id }), ...(decision.reason === undefined ? {} : { reason: decision.reason }) };
        const record: RequestRecord = { requestId: decision.requestId, operation: "review", actor: structuredClone(decision.actor), canonicalVersion: 1, payloadHash, admittedAt: at, response: { jobId: id, status: "queued", agent: job.agent.name }, receipt: decided as unknown as JsonValue };
        cell.record = record; receipt = decided;
      }, context);
      if (!receipt) throw new DomainError("STORAGE_ERROR");
      return receipt;
    },
    async applyControl(id, request, at) {
      assertControlRequest(request);
      let receipt: ControlReceipt | undefined;
      await session.commit(async tx => {
        const rawJob = await tx.doc(JobDocFamily, id, null as unknown as JsonValue) as JobRecord | undefined;
        const job = rawJob ? plain(rawJob) : undefined;
        if (!job) throw new DomainError("JOB_NOT_FOUND");
        const payloadHash = createHash("sha256").update(canonicalJson({ version: 1, operation: "control", jobId: id, action: request.action, actor: request.actor, ...(request.reason === undefined ? {} : { reason: request.reason }) })).digest("hex");
        const key = createHash("sha256").update(request.requestId).digest("hex");
        const cell = await tx.doc(RequestLedgerDocFamily, key, null);
        const existing = cell.record as RequestRecord | null;
        if (existing) {
          if (existing.requestId !== request.requestId || existing.operation !== "control" || existing.payloadHash !== payloadHash) throw new DomainError("CONTROL_CONFLICT");
          receipt = { ...(plain(existing.receipt) as ControlReceipt), replayed: true };
          return;
        }
        if (request.action === "retry") throw new DomainError("RETRY_NOT_ALLOWED");
        const index = await tx.doc(JobsIndexDoc);
        const previousStatus = job.status;
        let result: JobResult | undefined;
        if (request.action === "pause") {
          if (job.status === "provisioning" || job.status === "running" || job.status === "cancelling") throw new DomainError("PAUSE_ACTIVE_UNSUPPORTED");
          if (job.status !== "queued") throw new DomainError("CONTROL_INVALID_STATE");
          job.queueOrdinal = index.order.indexOf(id) + 1;
          job.status = "paused";
          index.order = index.order.filter(candidate => candidate !== id);
        } else if (request.action === "resume") {
          if (job.status !== "paused") throw new DomainError("CONTROL_INVALID_STATE");
          job.status = "queued";
          job.queueOrdinal = index.order.length + 1;
          if (!index.order.includes(id)) index.order.push(id);
        } else {
          if (terminalStatuses.has(job.status) || job.status === "cancelling") throw new DomainError("CONTROL_INVALID_STATE");
          if (job.status === "queued" || job.status === "paused") {
            job.status = "cancelled";
            index.order = index.order.filter(candidate => candidate !== id);
            job.finishedAt = at; job.resultMeta = { durationMs: 0, model: structuredClone(job.model), status: "interrupted", error: "cancelled before execution" };
            result = { finalResponse: "", durationMs: 0, model: structuredClone(job.model), status: "interrupted", error: "cancelled before execution" };
          } else {
            job.status = "cancelling";
            job.control = { pending: "cancel", requestedAt: at, requestedBy: structuredClone(request.actor), requestId: request.requestId };
          }
        }
        job.updatedAt = at;
        job.controlHistory = [...(job.controlHistory ?? []), { action: request.action, requestId: request.requestId, actor: structuredClone(request.actor), requestedAt: at, appliedAt: at, previousStatus, nextStatus: job.status }].slice(-32);
        const stored = await tx.doc(JobDocFamily, id, null as unknown as JsonValue); Object.assign(stored, storedJob(job));
        if (result) { const body = await tx.doc(JobResultDocFamily, id, result); Object.assign(body, structuredClone(result)); }
        index.summaries[id] = summary(job, Boolean(result) || Boolean(index.summaries[id]?.hasResult), index.summaries[id]?.reviewStatus ?? initialReviewStatus(job));
        if (job.status !== "queued") index.order = index.order.filter(candidate => candidate !== id);
        const decided: ControlReceipt = { jobId: id, requestId: request.requestId, action: request.action, previousStatus, status: job.status, replayed: false, appliedAt: at };
        const record: RequestRecord = { requestId: request.requestId, operation: "control", actor: structuredClone(request.actor), canonicalVersion: 1, payloadHash, admittedAt: at, response: { jobId: id, status: "queued", agent: job.agent.name }, receipt: decided as unknown as JsonValue };
        cell.record = record; receipt = decided;
      }, context);
      if (!receipt) throw new DomainError("STORAGE_ERROR");
      return receipt;
    },
    async retry(id, request, at) {
      assertControlRequest(request);
      let receipt: RetryReceipt | undefined;
      await session.commit(async tx => {
        const rawOriginal = await tx.doc(JobDocFamily, id, null as unknown as JsonValue) as JobRecord | undefined;
        const original = rawOriginal ? plain(rawOriginal) : undefined;
        if (!original) throw new DomainError("JOB_NOT_FOUND");
        const payloadHash = createHash("sha256").update(canonicalJson({ version: 1, operation: "retry", jobId: id, actor: request.actor, ...(request.reason === undefined ? {} : { reason: request.reason }) })).digest("hex");
        const key = createHash("sha256").update(request.requestId).digest("hex");
        const cell = await tx.doc(RequestLedgerDocFamily, key, null);
        const existing = cell.record as RequestRecord | null;
        if (existing) {
          if (existing.requestId !== request.requestId || existing.operation !== "retry" || existing.payloadHash !== payloadHash) throw new DomainError("CONTROL_CONFLICT");
          receipt = { ...(plain(existing.receipt) as RetryReceipt), replayed: true };
          return;
        }
        if (!terminalStatuses.has(original.status)) throw new DomainError("RETRY_NOT_ALLOWED");
        const retryJob: JobRecord = {
          id: createId(), status: "queued", task: original.task, cwd: original.cwd,
          agent: plain(original.agent), model: plain(original.model), thinkingLevel: original.thinkingLevel,
          createdAt: at, updatedAt: at, createdBy: plain(request.actor), notified: false,
          retryOf: original.id, rootAttemptId: original.rootAttemptId ?? original.id, attemptNumber: (original.attemptNumber ?? 1) + 1,
        };
        const next: RetryReceipt = { jobId: retryJob.id, requestId: request.requestId, action: "retry", previousStatus: original.status, status: "queued", replayed: false, appliedAt: at, retryJobId: retryJob.id, retryOf: original.id, attemptNumber: retryJob.attemptNumber };
        await commitJob(tx, retryJob);
        const review = await tx.doc(JobReviewDocFamily, retryJob.id, { status: initialReviewStatus(retryJob) });
        review.status = initialReviewStatus(retryJob);
        cell.record = { requestId: request.requestId, operation: "retry", actor: plain(request.actor), canonicalVersion: 1, payloadHash, admittedAt: at, response: { jobId: retryJob.id, status: "queued", agent: retryJob.agent.name }, receipt: next as unknown as JsonValue };
        receipt = next;
      }, context);
      if (!receipt) throw new DomainError("STORAGE_ERROR");
      return receipt;
    },
    async consume(id, request, at) {
      let receipt: ConsumeReceipt | undefined;
      await session.commit(async tx => {
        const job = await tx.doc(JobDocFamily, id, null as unknown as JsonValue) as JobRecord | undefined;
        if (!job) throw new DomainError("JOB_NOT_FOUND");
        const payloadHash = createHash("sha256").update(canonicalJson({ version: 1, operation: "consume", jobId: id, actor: request.actor, consumer: request.consumer })).digest("hex");
        const key = createHash("sha256").update(request.requestId).digest("hex");
        const cell = await tx.doc(RequestLedgerDocFamily, key, null);
        const existing = cell.record as RequestRecord | null;
        if (existing) {
          if (existing.requestId !== request.requestId || existing.operation !== "consume" || existing.payloadHash !== payloadHash) throw new DomainError("REQUEST_ID_CONFLICT");
          receipt = plain(existing.receipt) as ConsumeReceipt;
          return;
        }
        const index = await tx.doc(JobsIndexDoc);
        if (!index.summaries[id]?.hasResult || !terminalStatuses.has(job.status)) throw new DomainError("RESULT_NOT_READY");
        const review = await tx.doc(JobReviewDocFamily, id, { status: "not_required" });
        if (review.status === "pending") throw new DomainError("RESULT_REVIEW_REQUIRED");
        if (review.status === "rejected") throw new DomainError("RESULT_REJECTED");
        const body = await tx.doc(JobResultDocFamily, id, null as unknown as JsonValue) as JobResult | undefined;
        if (!body || typeof body.finalResponse !== "string") throw new DomainError("RESULT_NOT_READY");
        const consumption = await tx.doc(JobConsumptionDocFamily, id, { count: 0, requestIds: [] });
        consumption.count += 1; consumption.firstConsumedAt ??= at; consumption.lastConsumedAt = at; consumption.lastConsumer = request.consumer;
        consumption.requestIds = [...consumption.requestIds.filter(candidate => candidate !== request.requestId), request.requestId].slice(-32);
        const consumed: ConsumeReceipt = { jobId: id, requestId: request.requestId, consumedAt: at, consumedBy: request.consumer, count: consumption.count, result: plain(body) };
        const record: RequestRecord = { requestId: request.requestId, operation: "consume", actor: structuredClone(request.actor), canonicalVersion: 1, payloadHash, admittedAt: at, response: { jobId: id, status: "queued", agent: job.agent.name }, receipt: consumed as unknown as JsonValue };
        cell.record = record; receipt = consumed;
      }, context);
      if (!receipt) throw new DomainError("STORAGE_ERROR");
      return receipt;
    },
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
