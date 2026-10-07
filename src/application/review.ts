import type { Clock, ReviewReceipt } from '../domain/requests.ts';
import type { ReviewDecision } from '../domain/jobs.ts';
import { DomainError, failure, type Outcome } from '../domain/errors.ts';
import type { JobRepository } from '../infrastructure/durable/repository.ts';

export type ReviewService = {
  decideReview(id: string, decision: ReviewDecision): Promise<Outcome<ReviewReceipt>>;
};

export function createReviewService(repository: JobRepository, clock: Clock): ReviewService {
  return {
    async decideReview(id, decision) {
      try {
        if (!id || !decision.requestId || decision.actor.kind !== 'human') throw new DomainError('INVALID_REQUEST');
        return { success: true, value: await repository.decideReview(id, decision, clock()) };
      } catch (error) { return failure(error); }
    },
  };
}
