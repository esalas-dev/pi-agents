import type { JobRecord, JobQueryView, JobView, ResultView, WaitOptions } from "../domain/jobs.ts";
import { DomainError, failure, type Outcome } from "../domain/errors.ts";
import type { AdmissionReceipt, ConsumeReceipt, ConsumeRequest, ResolveInput, ReviewReceipt, StartRequest } from "../domain/requests.ts";
import type { ResultAccess, ReviewDecision } from "../domain/jobs.ts";
import type { JobRepository } from "../infrastructure/durable/repository.ts";
import type { StartService } from "./start.ts";
import type { WaitService } from "./wait.ts";
import type { ResultService } from "./result.ts";
import type { ReviewService } from "./review.ts";

export type JobsService = {
  start(request: StartRequest, resolve: ResolveInput): Promise<Outcome<AdmissionReceipt>>;
  status(id: string): Promise<Outcome<JobView>>;
  result(id: string): Promise<Outcome<ResultView>>;
  waitForJob(id: string, options?: WaitOptions): Promise<Outcome<JobQueryView>>;
  getResult(id: string, access: ResultAccess): Promise<Outcome<ResultView>>;
  consumeResult(id: string, request: ConsumeRequest): Promise<Outcome<ConsumeReceipt>>;
  decideReview(id: string, decision: ReviewDecision): Promise<Outcome<ReviewReceipt>>;
  markNotified(id: string): Promise<Outcome<void>>;
  unnotified(): Promise<Outcome<JobRecord[]>>;
};

export function createJobsService(repository: JobRepository, startService: StartService, waitService?: WaitService, resultService?: ResultService, reviewService?: ReviewService): JobsService {
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
    async waitForJob(id, options) {
      if (!waitService) return failure(new DomainError("STORAGE_ERROR"));
      return waitService.waitForJob(id, options);
    },
    async getResult(id, access) {
      if (!resultService) return failure(new DomainError("STORAGE_ERROR"));
      return resultService.getResult(id, access);
    },
    async consumeResult(id, request) {
      if (!resultService) return failure(new DomainError("STORAGE_ERROR"));
      return resultService.consumeResult(id, request);
    },
    async decideReview(id, decision) {
      if (!reviewService) return failure(new DomainError("STORAGE_ERROR"));
      return reviewService.decideReview(id, decision);
    },
    async markNotified(id) {
      if (!(await repository.get(id))) return failure(new DomainError("JOB_NOT_FOUND"));
      await repository.markNotified(id);
      return { success: true, value: undefined };
    },
    async unnotified() { return { success: true, value: await repository.unnotified() }; },
  };
}
