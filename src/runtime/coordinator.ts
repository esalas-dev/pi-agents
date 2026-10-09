import type { Clock } from "../domain/requests.ts";
import type { JobRecord } from "../domain/jobs.ts";
import type { JobRepository } from "../infrastructure/durable/repository.ts";
import type { DurableExecution } from "../infrastructure/durable/execution.ts";

export type Coordinator = { recover(): Promise<void>; reconcileControls(): Promise<void>; wake(): void; drain(): Promise<void>; stop(): void };
export function createCoordinator(options: { repository: JobRepository; execution: DurableExecution; maxConcurrency: number; clock: Clock; onSettled?: (job: JobRecord, result: Awaited<ReturnType<DurableExecution["wait"]>>) => Promise<void>; report: (error: unknown) => void }): Coordinator {
  const monitors = new Map<string, Promise<void>>(); const pending = new Set<Promise<void>>(); let stopped = false; let tail = Promise.resolve(); let generation = 0;
  const report = (error: unknown) => { try { options.report(error); } catch {} };
  const active = (g: number) => !stopped && g === generation;
  const track = (task: Promise<void>) => {
    pending.add(task);
    void task.then(() => pending.delete(task), () => pending.delete(task));
    return task;
  };
  const fail = async (job: JobRecord, error: unknown, g: number) => {
    if (!active(g)) return;
    try { await options.repository.finish(job.id, { finalResponse: "", durationMs: 0, model: job.model, status: "failed", error: error instanceof Error ? error.message : String(error) }, options.clock()); }
    catch (finishError) { report(finishError); }
  };
  const monitor = (job: JobRecord) => {
    if (monitors.has(job.id)) return;
    const g = generation;
    const promise = (async () => {
      let admitted = false;
      try {
        const result = await options.execution.wait(job);
        if (!active(g)) return;
        admitted = true;
        await track((async () => {
          await options.repository.finish(job.id, result, options.clock());
          if (!active(g)) return;
          const current = await options.repository.get(job.id);
          if (!active(g)) return;
          if (current && options.onSettled) { try { await options.onSettled(current, result); } catch (error) { report(error); } }
        })());
      } catch (error) { if (active(g)) await track(fail(job, error, g)); else if (admitted) report(error); }
      finally { monitors.delete(job.id); if (active(g)) wake(); }
    })();
    monitors.set(job.id, promise);
  };
  const continueJob = async (job: JobRecord) => {
    const g = generation;
    try {
      const submissionId = await options.execution.submit(job); if (!active(g)) return;
      await options.repository.markRunning(job.id, submissionId, options.clock()); if (!active(g)) return;
      const running = await options.repository.get(job.id); if (!active(g)) return;
      if (running) monitor(running);
    } catch (error) { if (active(g)) await fail(job, error, g); else report(error); }
  };
  const startContinuation = (job: JobRecord) => { void track(continueJob(job)); };
  const reconcile = async () => {
    const g = generation;
    for (const job of await options.repository.active()) {
      if (!active(g)) return;
      if (job.status !== "cancelling" || job.control?.pending !== "cancel") continue;
      try {
        const outcome = await options.execution.abort(job); if (!active(g)) return;
        if (outcome === "aborted" || outcome === "already_terminal") await options.repository.finishCancelled(job.id, outcome, options.clock());
        else await options.repository.finish(job.id, { finalResponse: "", durationMs: 0, model: job.model, status: "interrupted", error: "No se pudo confirmar la cancelación durable." }, options.clock());
      } catch (error) {
        if (!active(g)) return;
        try { await options.repository.finish(job.id, { finalResponse: "", durationMs: 0, model: job.model, status: "interrupted", error: error instanceof Error ? error.message : String(error) }, options.clock()); }
        catch (finishError) { if (!stopped) report(finishError); }
      }
    }
  };
  const reconcileControls = () => track(reconcile());
  const pump = async () => {
    if (stopped) return;
    await reconcileControls(); if (stopped) return;
    while (!stopped) {
      const g = generation;
      const job = await options.repository.claimNext(options.maxConcurrency, (tx, candidate) => options.execution.create(tx, candidate));
      if (!active(g)) return;
      if (!job) return;
      startContinuation(job);
    }
  };
  function wake() { if (stopped) return; tail = tail.then(pump).catch(error => { if (!stopped) report(error); }); }
  return {
    async recover() {
      await reconcileControls();
      if (stopped) return;
      for (const job of await options.repository.active()) { if (stopped) return; if (job.status === "provisioning") startContinuation(job); else if (job.status === "running") monitor(job); }
      wake(); await tail;
    },
    reconcileControls,
    wake,
    async drain() { await tail; while (pending.size) { await Promise.allSettled([...pending]); } await tail; },
    stop() { stopped = true; generation++; },
  };
}
