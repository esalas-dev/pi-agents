import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import type { Context } from "@earendil-works/chord";
import { createSession } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { canonicalJson } from "../../domain/requests.ts";
import { DomainError } from "../../domain/errors.ts";
import type { Lease } from "./lease.ts";
import { LegacyJobsDoc } from "../durable/legacy-v1.ts";
import { JobConsumptionDocFamily, JobControlDocFamily, JobDocFamily, JobResultDocFamily, JobReviewDocFamily, JobsIndexDoc, StorageMetaDoc } from "../durable/documents.ts";
import { schema4Source } from "./schema4-source.ts";

export type StorageInspection = { kind: "empty" } | { kind: "legacy-v1"; jobs: number; sourceHash: string } | { kind: "current"; schemaVersion: 2 | 3 | 4 | 5; jobs?: number; sourceHash?: string };

function hiddenCurrent(schemaVersion: 2 | 3 | 4 | 5, extras: { jobs?: number; sourceHash?: string } = {}): StorageInspection {
  const value = { kind: "current" as const, schemaVersion } as StorageInspection & Record<string, unknown>;
  for (const [key, item] of Object.entries(extras)) Object.defineProperty(value, key, { value: item, enumerable: false });
  return value;
}

async function schema2Source(session: ReturnType<typeof createSession>, context: Context, meta: unknown, index: Awaited<ReturnType<ReturnType<typeof createSession>["snapshot"]>>): Promise<string> {
  const jobs: Record<string, unknown> = {};
  const summaries = (index as { summaries: Record<string, { hasResult: boolean }> }).summaries;
  for (const id of Object.keys(summaries)) {
    jobs[id] = { job: await session.snapshot(JobDocFamily, id, context), ...(summaries[id].hasResult ? { result: await session.snapshot(JobResultDocFamily, id, context) } : {}) };
  }
  return createHash("sha256").update(canonicalJson({ version: 2, meta, index, jobs })).digest("hex");
}

async function schema3Source(session: ReturnType<typeof createSession>, context: Context, meta: unknown, index: Awaited<ReturnType<ReturnType<typeof createSession>["snapshot"]>>): Promise<string> {
  const jobs: Record<string, unknown> = {};
  const summaries = (index as { summaries: Record<string, { hasResult: boolean }> }).summaries;
  for (const id of Object.keys(summaries)) {
    const job = await session.snapshot(JobDocFamily, id, context); const result = summaries[id].hasResult ? await session.snapshot(JobResultDocFamily, id, context) : undefined;
    const review = await session.snapshot(JobReviewDocFamily, id, context); const consumption = await session.snapshot(JobConsumptionDocFamily, id, context); const control = await session.snapshot(JobControlDocFamily, id, context);
    jobs[id] = { job, ...(result ? { result } : {}), ...(review ? { review } : {}), ...(consumption ? { consumption } : {}), ...(control ? { control } : {}) };
  }
  return createHash("sha256").update(canonicalJson({ version: 3, meta, index, jobs })).digest("hex");
}

export async function inspectStorage(lease: Lease, context: Context): Promise<StorageInspection> {
  let storage;
  let session;
  try {
    try { if ((await stat(lease.dbPath)).size === 0) return { kind: "empty" }; } catch (error) { if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return { kind: "empty" }; throw error; }
    storage = await openNodeSqliteStorage(lease.dbPath);
    const documents = [];
    let cursor;
    do {
      const page = await storage.scanDocuments({ scope: { kind: "session" }, at: "current" }, 100, cursor, context);
      documents.push(...page.items); cursor = page.next;
    } while (cursor);
    const kinds = new Set(documents.map(document => document.kind));
    if (kinds.has("pi-agents.storage")) {
      session = createSession(storage);
      const meta = await session.snapshot(StorageMetaDoc, context);
      if (meta?.storageSchemaVersion !== 2 && meta?.storageSchemaVersion !== 3 && meta?.storageSchemaVersion !== 4 && meta?.storageSchemaVersion !== 5) throw new DomainError("STORAGE_INCONSISTENT");
      if ([...kinds].some(kind => kind === "pi-agents.jobs")) throw new DomainError("STORAGE_INCONSISTENT");
      if (meta.storageSchemaVersion === 4) {
        const source = await schema4Source(session, storage, context);
        return hiddenCurrent(4, source);
      }
      if (meta.storageSchemaVersion === 5) return hiddenCurrent(5);
      const index = await session.snapshot(JobsIndexDoc, context);
      if (!index) throw new DomainError("STORAGE_INCONSISTENT");
      const jobs = Object.keys(index.summaries).length;
      const sourceHash = meta.storageSchemaVersion === 3 ? await schema3Source(session, context, meta, index) : await schema2Source(session, context, meta, index);
      return hiddenCurrent(meta.storageSchemaVersion, { jobs, sourceHash });
    }
    if (kinds.has("pi-agents.jobs")) {
      session = createSession(storage);
      const legacy = await session.snapshot(LegacyJobsDoc, context);
      if (!legacy) throw new DomainError("STORAGE_INCONSISTENT");
      const source = canonicalJson({ version: 1, state: legacy });
      return { kind: "legacy-v1", jobs: Object.keys(legacy.jobs).length, sourceHash: createHash("sha256").update(source).digest("hex") };
    }
    if (documents.length === 0) return { kind: "empty" };
    throw new DomainError("STORAGE_VERSION_UNSUPPORTED");
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError("STORAGE_ERROR");
  } finally { await session?.close(context); if (!session) await storage?.close(context); }
}
