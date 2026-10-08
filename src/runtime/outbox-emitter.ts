import type { Clock } from "../domain/requests.ts";
import type { OutboxRepository } from "../infrastructure/durable/outbox.ts";
import { eventChannel, type EventBusLike, type JobEventV1 } from "../public/job-events.ts";

const PAGE_SIZE = 256;
const BATCH_SIZE = 64;
const RETRY_DELAY_MS = 1000;

type OutboxEmitterOptions = {
  outbox: OutboxRepository;
  bus: EventBusLike;
  isActive: () => boolean;
  clock: Clock;
  subscribeWake: (listener: () => void) => () => void;
  report: (error: unknown) => void;
};

function sanitize(_error: unknown): { name: string; message: string } {
  return { name: "Error", message: "Outbox delivery failed." };
}

export function createOutboxEmitter(options: OutboxEmitterOptions): {
  start(): void;
  wake(): void;
  stop(): Promise<void>;
} {
  let started = false;
  let stopping = false;
  let unsubscribe: (() => void) | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let drainPromise: Promise<void> | undefined;
  let wakePending = false;
  let stopPromise: Promise<void> | undefined;

  const report = (error: unknown): void => {
    try { options.report(sanitize(error)); } catch { /* reporting must not affect delivery */ }
  };

  const scheduleRetry = (): void => {
    if (stopping || retryTimer !== undefined) return;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      wake();
    }, RETRY_DELAY_MS);
  };

  const drain = async (): Promise<void> => {
    while (!stopping && options.isActive()) {
      let pending: JobEventV1[];
      try {
        pending = await options.outbox.pending(PAGE_SIZE);
      } catch (error) {
        report(error);
        scheduleRetry();
        return;
      }
      if (pending.length === 0) return;

      for (let index = 0; index < pending.length && !stopping; index++) {
        const event = pending[index];
        if (!options.isActive()) return;
        try {
          options.bus.emit(eventChannel(event.type), event);
        } catch (error) {
          report(error);
          scheduleRetry();
          return;
        }
        try {
          await options.outbox.markEmitted(event.eventId, event.sequence, options.clock());
        } catch (error) {
          report(error);
          scheduleRetry();
          return;
        }
        if ((index + 1) % BATCH_SIZE === 0 && !stopping) {
          await new Promise<void>(resolve => setImmediate(resolve));
        }
      }
    }
  };

  function wake(): void {
    if (!started || stopping) return;
    if (drainPromise !== undefined || retryTimer !== undefined) {
      wakePending = true;
      return;
    }
    wakePending = false;
    drainPromise = drain().catch(report).finally(() => {
      drainPromise = undefined;
      if (wakePending && !stopping && retryTimer === undefined) {
        wakePending = false;
        wake();
      }
    });
  }

  function start(): void {
    if (started || stopping) return;
    started = true;
    unsubscribe = options.subscribeWake(wake);
    wake();
  }

  function stop(): Promise<void> {
    if (stopPromise !== undefined) return stopPromise;
    stopping = true;
    if (retryTimer !== undefined) {
      clearTimeout(retryTimer);
      retryTimer = undefined;
    }
    unsubscribe?.();
    unsubscribe = undefined;
    stopPromise = drainPromise?.then(() => {}) ?? Promise.resolve();
    return stopPromise;
  }

  return { start, wake, stop };
}
