import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import type { Context } from "@earendil-works/chord";
import { createSession } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { canonicalJson } from "../../domain/requests.ts";
import { DomainError } from "../../domain/errors.ts";
import type { Lease } from "./lease.ts";
import { LegacyJobsDoc } from "../durable/legacy-v1.ts";

export type StorageInspection = { kind: "empty" } | { kind: "legacy-v1"; jobs: number; sourceHash: string } | { kind: "current"; schemaVersion: 2 };

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
      const meta = await session.snapshot((await import("../durable/documents.ts")).StorageMetaDoc, context);
      if (meta?.storageSchemaVersion !== 2) throw new DomainError("STORAGE_INCONSISTENT");
      if ([...kinds].some(kind => kind === "pi-agents.jobs")) throw new DomainError("STORAGE_INCONSISTENT");
      return { kind: "current", schemaVersion: 2 };
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
