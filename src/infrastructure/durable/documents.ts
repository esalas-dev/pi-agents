import { defineDoc, defineDocFamily } from "@earendil-works/pi-durable";
import type { JsonValue } from "@earendil-works/chord";
import type { JobRecord, JobResult, ReviewState, ConsumptionState } from "../../domain/jobs.ts";
import type { ControlEvent } from "../../domain/requests.ts";

export type StorageMeta = {
  storageSchemaVersion: 2 | 3;
  source: "new" | "migrated";
  migrationRequestId?: string;
  migratedAt?: number;
  migrationActor?: { kind: "human"; id?: string };
  sourceHash?: string;
  backupPath?: string;
  backupHash?: string;
};
export type JobsIndex = {
  storageSchemaVersion: 2 | 3;
  order: string[];
  summaries: Record<string, { id: string; status: JobRecord["status"]; agent: string; createdAt: number; updatedAt: number; hasResult: boolean; notified: boolean; reviewStatus?: ReviewState }>;
};
export type JobDocument = JobRecord;
export type JobResultDocument = JobResult;
export type JobReviewDocument = { status: ReviewState; decidedAt?: number; decidedBy?: string; reason?: string };
export type JobConsumptionDocument = ConsumptionState;
export type JobControlDocument = { events: ControlEvent[] };
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

export const JobReviewDocFamily = defineDocFamily<JobReviewDocument, JsonValue>({
  kind: "pi-agents.job-review", version: 1, scope: "session", family: true,
  initial: (seed) => seed as JobReviewDocument,
  checkpointWhen: (_value, _ops, info) => info.deltasSinceBase >= 31,
});

export const JobConsumptionDocFamily = defineDocFamily<JobConsumptionDocument, JsonValue>({
  kind: "pi-agents.job-consumption", version: 1, scope: "session", family: true,
  initial: (seed) => seed as JobConsumptionDocument,
  checkpointWhen: (_value, _ops, info) => info.deltasSinceBase >= 31,
});

export const JobControlDocFamily = defineDocFamily<JobControlDocument, JsonValue>({
  kind: "pi-agents.job-control", version: 1, scope: "session", family: true,
  initial: (seed) => seed as JobControlDocument,
  checkpointWhen: (_value, _ops, info) => info.deltasSinceBase >= 31,
});

export const RequestLedgerDocFamily = defineDocFamily<LedgerCell, JsonValue>({
  kind: "pi-agents.request", version: 1, scope: "session", family: true,
  initial: (seed) => ({ record: seed }),
  checkpointWhen: (_value, _ops, info) => info.deltasSinceBase >= 31,
});
