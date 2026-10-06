import { createHash } from "node:crypto";
import type { Context } from "@earendil-works/chord";
import { createSession } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { DomainError } from "../../domain/errors.ts";
import { canonicalJson, type MigrationApproval } from "../../domain/requests.ts";
import type { JobRecord, JobResult } from "../../domain/jobs.ts";
import { JobDocFamily, JobResultDocFamily, JobsIndexDoc, StorageMetaDoc } from "../durable/documents.ts";
import { LegacyJobsDoc, type JobsStateV1 } from "../durable/legacy-v1.ts";
import type { BackupReceipt } from "./backup.ts";
import { verifyBackup } from "./backup.ts";
import type { Lease } from "./lease.ts";

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
