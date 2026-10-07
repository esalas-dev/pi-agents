import { createHash } from "node:crypto";
import type { Context } from "@earendil-works/chord";
import { createSession } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { DomainError } from "../../domain/errors.ts";
import { canonicalJson, type MigrationApproval } from "../../domain/requests.ts";
import type { JobRecord, JobResult } from "../../domain/jobs.ts";
import { JobConsumptionDocFamily, JobControlDocFamily, JobDocFamily, JobResultDocFamily, JobReviewDocFamily, JobsIndexDoc, StorageMetaDoc } from "../durable/documents.ts";
import { LegacyJobsDoc, type JobsStateV1 } from "../durable/legacy-v1.ts";
import type { BackupReceipt } from "./backup.ts";
import { verifyBackup } from "./backup.ts";
import type { Lease } from "./lease.ts";

export async function migrateV2ToV3(lease: Lease, approval: MigrationApproval, backup: BackupReceipt, context: Context): Promise<{ schemaVersion: 3; migratedJobs: number }> {
  if (approval.actor.kind !== "human" || approval.dbPath !== lease.dbPath) throw new DomainError("INVALID_REQUEST");
  await verifyBackup(backup);
  const storage = await openNodeSqliteStorage(lease.dbPath); const session = createSession(storage);
  try {
    const meta = await session.snapshot(StorageMetaDoc, context);
    if (!meta) throw new DomainError("STORAGE_INCONSISTENT");
    if (meta.storageSchemaVersion === 3) return { schemaVersion: 3, migratedJobs: 0 };
    if (meta.storageSchemaVersion !== 2) throw new DomainError("STORAGE_VERSION_UNSUPPORTED");
    const sourceIndex = await session.snapshot(JobsIndexDoc, context);
    if (!sourceIndex) throw new DomainError("STORAGE_INCONSISTENT");
    const sourceJobs: Record<string, unknown> = {};
    for (const id of Object.keys(sourceIndex.summaries)) sourceJobs[id] = { job: await session.snapshot(JobDocFamily, id, context), ...(sourceIndex.summaries[id].hasResult ? { result: await session.snapshot(JobResultDocFamily, id, context) } : {}) };
    const source = canonicalJson({ version: 2, meta, index: sourceIndex, jobs: sourceJobs });
    const sourceHash = createHash("sha256").update(source).digest("hex");
    if (sourceHash !== approval.sourceHash) throw new DomainError("STORAGE_INCONSISTENT");
    const migratedJobs = Object.keys(sourceIndex.summaries).length;
    await session.commit(async tx => {
      const currentMeta = await tx.doc(StorageMetaDoc);
      const index = await tx.doc(JobsIndexDoc);
      for (const id of Object.keys(index.summaries)) {
        const job = await tx.doc(JobDocFamily, id, null as never) as JobRecord;
        if (!job) throw new DomainError("STORAGE_INCONSISTENT");
        const pending = job.createdBy?.kind === "model" || job.createdBy?.kind === "extension";
        const review = await tx.doc(JobReviewDocFamily, id, { status: pending ? "pending" : "not_required" });
        review.status = pending ? "pending" : "not_required";
        const consumption = await tx.doc(JobConsumptionDocFamily, id, { count: 0, requestIds: [] });
        consumption.count ??= 0; consumption.requestIds ??= [];
        index.summaries[id].reviewStatus = review.status;
      }
      currentMeta.storageSchemaVersion = 3; currentMeta.source = "migrated"; currentMeta.migrationRequestId = approval.requestId;
      currentMeta.migratedAt = approval.approvedAt; currentMeta.migrationActor = { kind: "human", ...(approval.actor.id ? { id: approval.actor.id } : {}) };
      currentMeta.sourceHash = sourceHash; currentMeta.backupPath = backup.path; currentMeta.backupHash = backup.sha256;
      index.storageSchemaVersion = 3;
    }, context);
    return { schemaVersion: 3, migratedJobs };
  } finally { await session.close(context); }
}

export async function migrateV3ToV4(lease: Lease, approval: MigrationApproval, backup: BackupReceipt, context: Context): Promise<{ schemaVersion: 4; migratedJobs: number }> {
  if (approval.actor.kind !== "human" || approval.dbPath !== lease.dbPath) throw new DomainError("INVALID_REQUEST");
  await verifyBackup(backup);
  const storage = await openNodeSqliteStorage(lease.dbPath); const session = createSession(storage);
  try {
    const meta = await session.snapshot(StorageMetaDoc, context); if (!meta) throw new DomainError("STORAGE_INCONSISTENT");
    if (meta.storageSchemaVersion === 4) return { schemaVersion: 4, migratedJobs: 0 };
    if (meta.storageSchemaVersion !== 3) throw new DomainError("STORAGE_VERSION_UNSUPPORTED");
    const sourceIndex = await session.snapshot(JobsIndexDoc, context); if (!sourceIndex) throw new DomainError("STORAGE_INCONSISTENT");
    const jobs: Record<string, unknown> = {};
    for (const id of Object.keys(sourceIndex.summaries)) {
      const job = await session.snapshot(JobDocFamily, id, context); const result = sourceIndex.summaries[id].hasResult ? await session.snapshot(JobResultDocFamily, id, context) : undefined;
      const review = await session.snapshot(JobReviewDocFamily, id, context); const consumption = await session.snapshot(JobConsumptionDocFamily, id, context); const control = await session.snapshot(JobControlDocFamily, id, context);
      jobs[id] = { job, ...(result ? { result } : {}), ...(review ? { review } : {}), ...(consumption ? { consumption } : {}), ...(control ? { control } : {}) };
    }
    const source = canonicalJson({ version: 3, meta, index: sourceIndex, jobs }); const sourceHash = createHash("sha256").update(source).digest("hex");
    if (sourceHash !== approval.sourceHash) throw new DomainError("STORAGE_INCONSISTENT");
    const migratedJobs = Object.keys(sourceIndex.summaries).length;
    await session.commit(async tx => {
      const currentMeta = await tx.doc(StorageMetaDoc); const index = await tx.doc(JobsIndexDoc);
      for (const id of Object.keys(index.summaries)) {
        const job = await tx.doc(JobDocFamily, id, null as never) as JobRecord;
        if (!job) throw new DomainError("STORAGE_INCONSISTENT");
        if (job.status === "queued") job.queueOrdinal ??= index.order.indexOf(id) + 1;
        job.controlHistory ??= [];
        const control = await tx.doc(JobControlDocFamily, id, { events: [] }); control.events ??= [];
        Object.assign(control, { events: control.events });
      }
      currentMeta.storageSchemaVersion = 4; currentMeta.source = "migrated"; currentMeta.migrationRequestId = approval.requestId;
      currentMeta.migratedAt = approval.approvedAt; currentMeta.migrationActor = { kind: "human", ...(approval.actor.id ? { id: approval.actor.id } : {}) };
      currentMeta.sourceHash = sourceHash; currentMeta.backupPath = backup.path; currentMeta.backupHash = backup.sha256; index.storageSchemaVersion = 4;
    }, context);
    return { schemaVersion: 4, migratedJobs };
  } finally { await session.close(context); }
}

export async function migrateV1(lease: Lease, approval: MigrationApproval, backup: BackupReceipt, context: Context): Promise<{ schemaVersion: 2; migratedJobs: number }> {
  if (approval.actor.kind !== "human" || approval.dbPath !== lease.dbPath) throw new DomainError("INVALID_REQUEST");
  await verifyBackup(backup);
  const storage = await openNodeSqliteStorage(lease.dbPath); const session = createSession(storage);
  try {
    const legacy = await session.snapshot(LegacyJobsDoc, context);
    if (!legacy) throw new DomainError("STORAGE_INCONSISTENT");
    const source = canonicalJson({ version: 1, state: legacy });
    const sourceHash = createHash("sha256").update(source).digest("hex");
    if (sourceHash !== approval.sourceHash) throw new DomainError("STORAGE_INCONSISTENT");
    const migratedJobs = Object.values(legacy.jobs).length;
    await session.commit(async tx => {
      const meta = await tx.doc(StorageMetaDoc);
      meta.storageSchemaVersion = 2; meta.source = "migrated"; meta.migrationRequestId = approval.requestId;
      meta.migratedAt = approval.approvedAt; meta.migrationActor = { kind: "human", ...(approval.actor.id ? { id: approval.actor.id } : {}) };
      meta.sourceHash = sourceHash; meta.backupPath = backup.path; meta.backupHash = backup.sha256;
      const index = await tx.doc(JobsIndexDoc);
      index.storageSchemaVersion = 2; index.order = [...legacy.queue]; index.summaries = {};
      for (const job of Object.values(legacy.jobs) as JobRecord[]) {
        const copy = structuredClone(job); const result = copy.result; delete copy.result;
        const stored = await tx.doc(JobDocFamily, job.id, copy); Object.assign(stored, copy);
        if (result) { const body = await tx.doc(JobResultDocFamily, job.id, result); Object.assign(body, result); }
        index.summaries[job.id] = { id: job.id, status: job.status, agent: job.agent.name, createdAt: job.createdAt, updatedAt: job.updatedAt, hasResult: Boolean(result), notified: job.notified };
      }
      await tx.retireDoc(LegacyJobsDoc);
    }, context);
    return { schemaVersion: 2, migratedJobs };
  } finally { await session.close(context); }
}
