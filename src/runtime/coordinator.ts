import type { Clock } from "../domain/requests.ts";
import type { JobRecord } from "../domain/jobs.ts";
import type { JobRepository } from "../infrastructure/durable/repository.ts";
import type { DurableExecution } from "../infrastructure/durable/execution.ts";

export type Coordinator = { recover(): Promise<void>; reconcileControls(): Promise<void>; wake(): void; drain(): Promise<void>; stop(): void };
export function createCoordinator(options: { repository: JobRepository; execution: DurableExecution; maxConcurrency: number; clock: Clock; onSettled?: (job: JobRecord, result: Awaited<ReturnType<DurableExecution["wait"]>>) => Promise<void>; report: (error: unknown) => void }): Coordinator {
  const monitors = new Map<string, Promise<void>>(); const pending = new Set<Promise<void>>(); let stopped = false; let tail = Promise.resolve();
  const report = (error: unknown) => { try { options.report(error); } catch {} };
  const fail = async (job: JobRecord, error: unknown) => {
    try { await options.repository.finish(job.id, { finalResponse: "", durationMs: 0, model: job.model, status: "failed", error: error instanceof Error ? error.message : String(error) }, options.clock()); }
    catch (finishError) { report(finishError); }
  };
  const monitor = (job: JobRecord) => {
    if (monitors.has(job.id)) return;
    const promise = (async () => {
      try {
        const result = await options.execution.wait(job); await options.repository.finish(job.id, result, options.clock());
        const current = await options.repository.get(job.id);
        if (current && options.onSettled) { try { await options.onSettled(current, result); } catch (error) { report(error); } }
      } catch (error) { if (!stopped) await fail(job, error); else report(error); }
      finally { monitors.delete(job.id); if (!stopped) wake(); }
    })();
    monitors.set(job.id, promise);
  };
  const continueJob = async (job: JobRecord) => {
    try {
      const submissionId = await options.execution.submit(job); await options.repository.markRunning(job.id, submissionId, options.clock());
      const running = await options.repository.get(job.id); if (running) monitor(running);
    } catch (error) { await fail(job, error); }
  };
  const startContinuation = (job: JobRecord) => { const task = continueJob(job); pending.add(task); void task.finally(() => pending.delete(task)); };
  const reconcileControls = async () => {
    for (const job of await options.repository.active()) {
      if (job.status !== "cancelling" || job.control?.pending !== "cancel") continue;
      try {
        const outcome = await options.execution.abort(job);
        if (outcome === "aborted" || outcome === "already_terminal") await options.repository.finishCancelled(job.id, outcome, options.clock());
        else await options.repository.finish(job.id, { finalResponse: "", durationMs: 0, model: job.model, status: "interrupted", error: "No se pudo confirmar la cancelación durable." }, options.clock());
      } catch (error) {
        try { await options.repository.finish(job.id, { finalResponse: "", durationMs: 0, model: job.model, status: "interrupted", error: error instanceof Error ? error.message : String(error) }, options.clock()); }
        catch (finishError) { report(finishError); }
      }
    }
  };
  const pump = async () => {
    if (stopped) return;
    await reconcileControls();
    while (!stopped) {
      const job = await options.repository.claimNext(options.maxConcurrency, (tx, candidate) => options.execution.create(tx, candidate));
      if (!job) return;
      startContinuation(job);
    }
  };
  function wake() { if (stopped) return; tail = tail.then(pump).catch(report); }
  return {
    async recover() {
      await reconcileControls();
      for (const job of await options.repository.active()) { if (job.status === "provisioning") startContinuation(job); else if (job.status === "running") monitor(job); }
      wake(); await tail;
    },
    reconcileControls,
    wake,
    async drain() { await tail; while (pending.size || monitors.size) { await Promise.allSettled([...pending, ...monitors]); } await tail; },
    stop() { stopped = true; },
  };
}
