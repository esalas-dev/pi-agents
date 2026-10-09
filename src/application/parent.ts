import type { ParentAuthority, ResolveInput, RetryRequest, StartRequest } from "../domain/requests.ts";
import type { ParentReviewDecision } from "../domain/jobs.ts";
import { DomainError, failure, type Outcome } from "../domain/errors.ts";
import type { AdmissionReceipt, RetryReceipt, ReviewReceipt } from "../domain/requests.ts";
import type { StartService } from "./start.ts";
import type { ControlService } from "./control.ts";
import type { ReviewService } from "./review.ts";

export type ParentReviewRequest = ParentReviewDecision;
export type ParentJobsService = {
  start(request: StartRequest, resolve: ResolveInput): Promise<Outcome<AdmissionReceipt>>;
  retry(id: string, request: RetryRequest): Promise<Outcome<RetryReceipt>>;
  decideReview(id: string, request: ParentReviewRequest): Promise<Outcome<ReviewReceipt>>;
};

const invalid = <T>(): Outcome<T> => failure(new DomainError("INVALID_REQUEST"));
const modelRequest = (request: unknown): boolean => Boolean(request && typeof request === "object" && (request as { actor?: { kind?: string } }).actor?.kind === "model");

export function createParentJobsService(authority: ParentAuthority, start: StartService, control: ControlService, review: ReviewService): ParentJobsService {
  return {
    async start(request, resolve) {
      if (!modelRequest(request)) return invalid();
      return start.start(request, resolve, authority);
    },
    async retry(id, request) {
      if (!modelRequest(request)) return invalid();
      return control.retry(id, request, authority);
    },
    async decideReview(id, request) {
      if (!request || typeof request !== "object" || "actor" in request) return invalid();
      return review.decideReview(id, request, authority);
    },
  };
}
