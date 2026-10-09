import { createHash } from "node:crypto";
import type { Context } from "@earendil-works/chord";
import type { Session, Storage } from "@earendil-works/pi-durable";
import { canonicalJson } from "../../domain/requests.ts";
import { DomainError } from "../../domain/errors.ts";

export async function schema4Source(session: Session, storage: Storage, context: Context): Promise<{ sourceHash: string; jobs: number }> {
  void session;
  const documents: { kind: string; key?: string; value: unknown }[] = [];
  let cursor;
  do {
    const page = await storage.scanDocuments({ scope: { kind: "session" }, at: "current" }, 100, cursor, context);
    for (const record of page.items) {
      const stored = await storage.document(record.id, "current", context);
      if (!stored) throw new DomainError("STORAGE_INCONSISTENT");
      documents.push({ kind: record.kind, ...(record.key === undefined ? {} : { key: record.key }), value: stored.value });
    }
    cursor = page.next;
  } while (cursor !== undefined);
  documents.sort((left, right) => {
    const a = `${left.kind}/${left.key ?? ""}`; const b = `${right.kind}/${right.key ?? ""}`;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  if (documents.some(document => document.kind.startsWith("pi-durable-subagents.outbox-"))) throw new DomainError("STORAGE_INCONSISTENT");
  const meta = documents.find(document => document.kind === "pi-agents.storage")?.value as { storageSchemaVersion?: number } | undefined;
  const index = documents.find(document => document.kind === "pi-agents.jobs-index")?.value as { storageSchemaVersion?: number; summaries?: Record<string, unknown> } | undefined;
  if (meta?.storageSchemaVersion !== 4 || index?.storageSchemaVersion !== 4 || !index.summaries) throw new DomainError("STORAGE_INCONSISTENT");
  const source = canonicalJson({ version: 4, documents });
  return { sourceHash: createHash("sha256").update(source).digest("hex"), jobs: Object.keys(index.summaries).length };
}
