import {
  createRpcClient, eventChannel, JobEventTypes,
  type EventBusLike, type JobEventType, type JobEventV1,
} from "../../rpc.ts";

function isJobEvent(value: unknown): value is JobEventV1 {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<JobEventV1>;
  return event.protocolVersion === 1 && typeof event.eventId === "string" && Number.isSafeInteger(event.sequence)
    && typeof event.sessionId === "string" && typeof event.jobId === "string" && typeof event.type === "string"
    && typeof event.occurredAt === "number" && !!event.data && typeof event.data === "object";
}

export function createRpcCaller(options: { bus: EventBusLike; callerId: string; sessionId?: string; createCorrelationId?: () => string }) {
  const client = createRpcClient(options);
  const seen = new Set<string>();
  const events: JobEventV1[] = [];
  const subscriptions: (() => void)[] = [];
  for (const type of JobEventTypes) {
    subscriptions.push(options.bus.on(eventChannel(type as JobEventType), value => {
      if (!isJobEvent(value)) return;
      const key = JSON.stringify([value.sessionId, value.eventId]);
      if (seen.has(key)) return;
      seen.add(key);
      events.push(value);
    }));
  }
  return {
    client,
    events,
    get seenEventIds() { return [...seen]; },
    async reconcile(jobId: string, requestIdPrefix: string) {
      const status = await client.call("status", { id: jobId }, { requestId: `${requestIdPrefix}:status` });
      const list = await client.call("list", { limit: 100 }, { requestId: `${requestIdPrefix}:list` });
      return { status, list };
    },
    shutdown() {
      for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
      client.close();
    },
  };
}
