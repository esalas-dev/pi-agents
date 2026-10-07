import type { Context } from '@earendil-works/chord';
import type { Session } from '@earendil-works/pi-durable';
import { JobDocFamily } from '../infrastructure/durable/documents.ts';
import type { JobRepository } from '../infrastructure/durable/repository.ts';
import { assertWaitOptions, type JobQueryView, type WaitOptions } from '../domain/jobs.ts';
import { DomainError, failure, type Outcome } from '../domain/errors.ts';
import type { QueryService } from './query.ts';

const terminal = new Set(['completed', 'failed', 'interrupted']);

function satisfies(view: JobQueryView, until: WaitOptions['until']): boolean {
  return until === undefined || until === 'terminal' ? terminal.has(view.status) : view.status === until;
}

export type WaitService = {
  waitForJob(id: string, options?: WaitOptions): Promise<Outcome<JobQueryView>>;
};

export function createWaitService(query: Pick<QueryService, 'getJob'>, session: Session, context: Context): WaitService {
  return {
    async waitForJob(id, rawOptions = {}) {
      let options: WaitOptions;
      try { options = assertWaitOptions(rawOptions); } catch (error) { return failure(error); }
      if (options.signal?.aborted) return failure(new DomainError('WAIT_ABORTED'));
      const initial = await query.getJob(id);
      if (options.signal?.aborted) return failure(new DomainError('WAIT_ABORTED'));
      if (!initial.success || satisfies(initial.value, options.until)) return initial;
      if (options.timeoutSeconds === 0) return failure(new DomainError('WAIT_TIMEOUT'));
      const watch = await session.watchDoc(JobDocFamily, id, context);
      if (!watch) return failure(new DomainError('JOB_NOT_FOUND'));
      const timeout = (options.timeoutSeconds ?? 300) * 1000;
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let removeAbort: (() => void) | undefined;
      let stopped = false;
      const stop = async () => { if (!stopped) { stopped = true; await watch.stop(); } };
      return new Promise<Outcome<JobQueryView>>(resolve => {
        const finish = async (outcome: Outcome<JobQueryView>) => {
          if (settled) return;
          settled = true;
          if (timer !== undefined) clearTimeout(timer);
          removeAbort?.();
          await stop();
          resolve(outcome);
        };
        const check = async () => {
          try {
            const current = await query.getJob(id);
            if (!current.success || satisfies(current.value, options.until)) await finish(current);
          } catch (error) { await finish(failure(error)); }
        };
        const onAbort = () => { void finish(failure(new DomainError('WAIT_ABORTED'))); };
        if (options.signal) {
          options.signal.addEventListener('abort', onAbort, { once: true });
          removeAbort = () => options.signal?.removeEventListener('abort', onAbort);
        }
        timer = setTimeout(() => { void finish(failure(new DomainError('WAIT_TIMEOUT'))); }, timeout);
        void (async () => {
          try {
            // The second snapshot closes the gap between the initial read and watch acquisition.
            const current = await query.getJob(id);
            if (settled) return;
            if (!current.success || satisfies(current.value, options.until)) { await finish(current); return; }
            watch.start(async () => { await check(); });
          } catch (error) { await finish(failure(error)); }
        })();
      });
    },
  };
}
