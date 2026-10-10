import { defineDoc, defineDocFamily } from "@earendil-works/pi-durable";
import type { JsonValue } from "@earendil-works/chord";
import type { JobEventV1 } from "../../public/job-events.ts";

export type OutboxMeta = { nextSequence: number; nextToEmit: number; recent: { eventId: string; sequence: number }[] };
export type OutboxEvent = { envelope: JobEventV1; emittedAt?: number };
export type OutboxPage = { sequences: number[] };
export const OutboxMetaDoc = defineDoc<OutboxMeta>({
  kind: "pi-durable-subagents.outbox-meta", version: 1, scope: "session",
  initial: () => ({ nextSequence: 1, nextToEmit: 1, recent: [] }),
});
export const OutboxEventDocFamily = defineDocFamily<OutboxEvent, JsonValue>({
  kind: "pi-durable-subagents.outbox-event", version: 1, scope: "session", family: true,
  initial: seed => seed as OutboxEvent,
});
export const OutboxPageDocFamily = defineDocFamily<OutboxPage, JsonValue>({
  kind: "pi-durable-subagents.outbox-page", version: 1, scope: "session", family: true,
  initial: seed => seed as OutboxPage,
});
