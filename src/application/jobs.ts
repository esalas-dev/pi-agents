import type { JobRecord, JobView, ResultView } from "../domain/jobs.ts";
import { DomainError, failure, type Outcome } from "../domain/errors.ts";
import type { AdmissionReceipt, ResolveInput, StartRequest } from "../domain/requests.ts";
import type { JobRepository } from "../infrastructure/durable/repository.ts";
import type { StartService } from "./start.ts";

export type JobsService = {
  start(request: StartRequest, resolve: ResolveInput): Promise<Outcome<AdmissionReceipt>>;
  status(id: string): Promise<Outcome<JobView>>;
  result(id: string): Promise<Outcome<ResultView>>;
  markNotified(id: string): Promise<Outcome<void>>;
  unnotified(): Promise<Outcome<JobRecord[]>>;
};

export function createJobsService(repository: JobRepository, startService: StartService): JobsService {
  return {
    start: (request, resolve) => startService.start(request, resolve),
    async status(id) {
      const job = await repository.get(id);
      if (!job) return failure(new DomainError("JOB_NOT_FOUND"));
      return { success: true, value: { job, queuePosition: await repository.queuedPosition(id) } };
    },
    async result(id) {
      const job = await repository.get(id);
      if (!job) return failure(new DomainError("JOB_NOT_FOUND"));
      const result = await repository.result(id);
      return { success: true, value: { job, queuePosition: await repository.queuedPosition(id), ...(result ? { result } : {}) } };
    },
    async markNotified(id) {
      if (!(await repository.get(id))) return failure(new DomainError("JOB_NOT_FOUND"));
      await repository.markNotified(id);
      return { success: true, value: undefined };
    },
    async unnotified() { return { success: true, value: await repository.unnotified() }; },
  };
}
