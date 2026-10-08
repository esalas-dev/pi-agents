import { createHash } from "node:crypto";
import type { Context } from "@earendil-works/chord";
import type { Session, Tx } from "@earendil-works/pi-durable";
import type { JobEventType, JobEventV1 } from "../../public/job-events.ts";
import { DomainError } from "../../domain/errors.ts";
import { OutboxEventDocFamily, OutboxMetaDoc, OutboxPageDocFamily, type OutboxMeta } from "./outbox-documents.ts";

export type AppendEventInput = { sessionId: string; jobId: string; type: JobEventType; occurredAt: number; data: JobEventV1["data"] };
export type OutboxRepository = {
  pending(limit: number): Promise<JobEventV1[]>;
  markEmitted(eventId: string, sequence: number, at: number): Promise<void>;
};

const PAGE_SIZE = 256;
const RECENT_SIZE = 1000;
const storageError = () => new DomainError("STORAGE_ERROR");
const pageKey = (sequence: number) => String(Math.floor((sequence - 1) / PAGE_SIZE));
const eventKey = (sequence: number) => String(sequence);

export async function appendEvent(tx: Tx, input: AppendEventInput): Promise<JobEventV1> {
  const meta = await tx.doc(OutboxMetaDoc);
  if (!Number.isSafeInteger(meta.nextSequence) || meta.nextSequence < 1 || meta.nextSequence >= Number.MAX_SAFE_INTEGER) throw storageError();
  const sequence = meta.nextSequence;
  const eventId = `evt_${createHash("sha256").update(JSON.stringify([input.sessionId, sequence])).digest("hex")}`;
  const envelope: JobEventV1 = {
    protocolVersion: 1, eventId, sequence, sessionId: input.sessionId, jobId: input.jobId,
    type: input.type, occurredAt: input.occurredAt, data: structuredClone(input.data),
  };
  const event = await tx.doc(OutboxEventDocFamily, eventKey(sequence), { envelope });
  Object.assign(event, { envelope });
  const page = await tx.doc(OutboxPageDocFamily, pageKey(sequence), { sequences: [] });
  if (!page.sequences.includes(sequence)) page.sequences.push(sequence);
  meta.nextSequence = sequence + 1;
  return structuredClone(envelope);
}

export function createOutboxRepository(session: Session, context: Context): OutboxRepository {
  return {
    async pending(limit) {
      const result: JobEventV1[] = [];
      const meta = await session.snapshot(OutboxMetaDoc, context) as OutboxMeta | undefined;
      if (!meta || limit <= 0) return result;
      for (let sequence = meta.nextToEmit; sequence < meta.nextSequence && result.length < limit; sequence++) {
        const page = await session.snapshot(OutboxPageDocFamily, pageKey(sequence), context) as { sequences: number[] } | undefined;
        if (!page?.sequences.includes(sequence)) continue;
        const event = await session.snapshot(OutboxEventDocFamily, eventKey(sequence), context) as { envelope: JobEventV1; emittedAt?: number } | undefined;
        if (event && event.emittedAt === undefined) result.push(structuredClone(event.envelope));
      }
      return result;
    },
    async markEmitted(eventId, sequence, at) {
      if (!Number.isSafeInteger(sequence) || sequence < 1 || !Number.isFinite(at)) throw storageError();
      await session.commit(async tx => {
        const meta = await tx.doc(OutboxMetaDoc);
        const event = await tx.doc(OutboxEventDocFamily, eventKey(sequence), null as never) as { envelope: JobEventV1; emittedAt?: number } | undefined;
        if (!event || event.envelope.eventId !== eventId) throw storageError();
        if (sequence < meta.nextToEmit) {
          if (meta.recent.some(item => item.sequence === sequence && item.eventId === eventId)) return;
          throw storageError();
        }
        if (sequence !== meta.nextToEmit) throw storageError();
        const page = await tx.doc(OutboxPageDocFamily, pageKey(sequence), null as never) as { sequences: number[] } | undefined;
        if (!page?.sequences.includes(sequence)) throw storageError();
        event.emittedAt = at;
        page.sequences = page.sequences.filter(candidate => candidate !== sequence);
        meta.nextToEmit = sequence + 1;
        meta.recent = [...meta.recent, { eventId, sequence }].slice(-RECENT_SIZE);
      }, context);
    },
  };
}
