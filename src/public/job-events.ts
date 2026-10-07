import type { JobStatusPublic, ReviewState } from "../domain/jobs.ts";

export type JobEventType = `job.${"queued" | "provisioning" | "started" | "paused" | "resumed" | "cancel-requested" | "cancelled" | "completed" | "failed" | "interrupted" | "reviewed" | "consumed"}`;
export const JobEventTypes: JobEventType[] = ["job.queued", "job.provisioning", "job.started", "job.paused", "job.resumed", "job.cancel-requested", "job.cancelled", "job.completed", "job.failed", "job.interrupted", "job.reviewed", "job.consumed"];
export type JobEventData = { status: JobStatusPublic; agent: string; hasResult: boolean; reviewStatus?: ReviewState; consumptionCount?: number; retryOf?: string };
export type JobEventV1 = { protocolVersion: 1; eventId: string; sequence: number; sessionId: string; jobId: string; type: JobEventType; occurredAt: number; data: JobEventData };
export type EventBusLike = { emit(channel: string, data: unknown): void; on(channel: string, handler: (data: unknown) => void): () => void };
export type TimerApi = { setTimeout(handler: () => void, ms: number): ReturnType<typeof setTimeout>; clearTimeout(handle: ReturnType<typeof setTimeout>): void };
export function eventChannel(type: JobEventType | string): string { return `pi-durable-subagents:job:${type.replace(/^job\./, "")}`; }
