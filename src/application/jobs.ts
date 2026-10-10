import type { JobFilter, JobListView, JobRecord, JobQueryView, JobView, ResultView, WaitOptions } from "../domain/jobs.ts";
import { DomainError, failure, type Outcome } from "../domain/errors.ts";
import type { AdmissionReceipt, ConsumeReceipt, ConsumeRequest, ControlAdmission, ControlReceipt, ControlRequest, ResolveInput, ReviewReceipt, RetryReceipt, RetryRequest, StartRequest } from "../domain/requests.ts";
import type { ResultAccess, ReviewDecision } from "../domain/jobs.ts";
import type { JobRepository } from "../infrastructure/durable/repository.ts";
import type { StartService } from "./start.ts";
import type { WaitService } from "./wait.ts";
import type { ResultService } from "./result.ts";
import type { ReviewService } from "./review.ts";
import type { QueryService } from "./query.ts";

export type JobsService = {
  seal(): void;
  start(request: StartRequest, resolve: ResolveInput): Promise<Outcome<AdmissionReceipt>>;
  control(id: string, request: ControlRequest, admission?: ControlAdmission): Promise<Outcome<ControlReceipt>>;
  retry(id: string, request: RetryRequest): Promise<Outcome<RetryReceipt>>;
  status(id: string): Promise<Outcome<JobView>>;
  getJob(id: string, options?: { includeTask?: boolean }): Promise<Outcome<JobQueryView>>;
  listJobs(filter: JobFilter): Promise<Outcome<{ items: readonly JobListView[]; nextCursor?: string }>>;
  result(id: string): Promise<Outcome<ResultView>>;
  waitForJob(id: string, options?: WaitOptions): Promise<Outcome<JobQueryView>>;
  getResult(id: string, access: ResultAccess): Promise<Outcome<ResultView>>;
  consumeResult(id: string, request: ConsumeRequest): Promise<Outcome<ConsumeReceipt>>;
  decideReview(id: string, decision: ReviewDecision): Promise<Outcome<ReviewReceipt>>;
  markNotified(id: string): Promise<Outcome<void>>;
  unnotified(): Promise<Outcome<JobRecord[]>>;
};

export function createJobsService(repository: JobRepository, startService: StartService, waitService?: WaitService, resultService?: ResultService, reviewService?: ReviewService, queryService?: QueryService, controlService?: { control(id: string, request: ControlRequest, admission?: ControlAdmission): Promise<Outcome<ControlReceipt>>; retry(id: string, request: RetryRequest): Promise<Outcome<RetryReceipt>> }): JobsService {
  let sealed = false;
  const closing = () => failure(new DomainError("RUNTIME_CLOSING"));
  return {
    seal() { if (!sealed) { sealed = true; startService.seal(); repository.seal(); } },
    async start(request, resolve) {
      if (sealed) return closing();
      return startService.start(request, resolve);
    },
    async control(id, request, admission) {
      if (sealed) return closing();
      if (!controlService) return failure(new DomainError("STORAGE_ERROR"));
      return controlService.control(id, request, admission);
    },
    async retry(id, request) {
      if (sealed) return closing();
      if (!controlService) return failure(new DomainError("STORAGE_ERROR"));
      return controlService.retry(id, request);
    },
    async status(id) {
      const job = await repository.get(id);
      if (!job) return failure(new DomainError("JOB_NOT_FOUND"));
      return { success: true, value: { job, queuePosition: await repository.queuedPosition(id) } };
    },
    async getJob(id, options) {
      if (!queryService) return failure(new DomainError("STORAGE_ERROR"));
      return queryService.getJob(id, options);
    },
    async listJobs(filter) {
      if (!queryService) return failure(new DomainError("STORAGE_ERROR"));
      return queryService.listJobs(filter);
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
      if (sealed && access.operation === "consume") return closing();
      if (!resultService) return failure(new DomainError("STORAGE_ERROR"));
      return resultService.getResult(id, access);
    },
    async consumeResult(id, request) {
      if (sealed) return closing();
      if (!resultService) return failure(new DomainError("STORAGE_ERROR"));
      return resultService.consumeResult(id, request);
    },
    async decideReview(id, decision) {
      if (sealed) return closing();
      if (!reviewService) return failure(new DomainError("STORAGE_ERROR"));
      return reviewService.decideReview(id, decision);
    },
    async markNotified(id) {
      if (sealed) return closing();
      if (!(await repository.get(id))) return failure(new DomainError("JOB_NOT_FOUND"));
      await repository.markNotified(id);
      return { success: true, value: undefined };
    },
    async unnotified() { return { success: true, value: await repository.unnotified() }; },
  };
}
