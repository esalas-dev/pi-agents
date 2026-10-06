import { defineDoc, defineDocFamily } from "@earendil-works/pi-durable";
import type { JsonValue } from "@earendil-works/chord";
import type { JobRecord, JobResult } from "../../domain/jobs.ts";

export type StorageMeta = {
  storageSchemaVersion: 2;
  source: "new" | "migrated";
  migrationRequestId?: string;
  migratedAt?: number;
};
export type JobsIndex = {
  storageSchemaVersion: 2;
  order: string[];
  summaries: Record<string, { id: string; status: JobRecord["status"]; agent: string; createdAt: number; updatedAt: number; hasResult: boolean; notified: boolean }>;
};
export type JobDocument = JobRecord;
export type JobResultDocument = JobResult;
export type LedgerCell = { record: JsonValue };

export const StorageMetaDoc = defineDoc<StorageMeta>({
  kind: "pi-agents.storage", version: 1, scope: "session", initial: () => ({ storageSchemaVersion: 2, source: "new" }),
});

export const JobsIndexDoc = defineDoc<JobsIndex>({
  kind: "pi-agents.jobs-index", version: 1, scope: "session", initial: () => ({ storageSchemaVersion: 2, order: [], summaries: {} }),
  checkpointWhen: (_value, _ops, info) => info.deltasSinceBase >= 31,
});

export const JobDocFamily = defineDocFamily<JobDocument, JsonValue>({
  kind: "pi-agents.job", version: 1, scope: "session", family: true,
  initial: (seed) => seed as JobDocument,
  checkpointWhen: (_value, _ops, info) => info.deltasSinceBase >= 31,
});

export const JobResultDocFamily = defineDocFamily<JobResultDocument, JsonValue>({
  kind: "pi-agents.job-result", version: 1, scope: "session", family: true,
  initial: (seed) => seed as JobResultDocument,
  checkpointWhen: (_value, _ops, info) => info.deltasSinceBase >= 31,
});

export const RequestLedgerDocFamily = defineDocFamily<LedgerCell, JsonValue>({
  kind: "pi-agents.request", version: 1, scope: "session", family: true,
  initial: (seed) => ({ record: seed }),
  checkpointWhen: (_value, _ops, info) => info.deltasSinceBase >= 31,
});
