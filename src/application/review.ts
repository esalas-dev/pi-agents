import type { Clock, ParentAuthority, ReviewReceipt } from '../domain/requests.ts';
import type { ParentReviewDecision, ReviewDecision } from '../domain/jobs.ts';
import { DomainError, failure, type Outcome } from '../domain/errors.ts';
import type { JobRepository } from '../infrastructure/durable/repository.ts';

export type ReviewService = {
  decideReview(id: string, decision: ReviewDecision | ParentReviewDecision, parent?: ParentAuthority): Promise<Outcome<ReviewReceipt>>;
};

function validDecision(decision: ReviewDecision | ParentReviewDecision): boolean {
  return Boolean(decision && typeof decision === 'object' && typeof decision.requestId === 'string' && decision.requestId
    && (decision.status === 'approved' || decision.status === 'rejected')
    && (decision.reason === undefined || (typeof decision.reason === 'string' && decision.reason.length <= 2048)));
}

export function createReviewService(repository: JobRepository, clock: Clock): ReviewService {
  return {
    async decideReview(id, decision, parent) {
      try {
        if (!id || !validDecision(decision)) throw new DomainError('INVALID_REQUEST');
        const parental = parent !== undefined;
        if (parental && 'actor' in decision) throw new DomainError('INVALID_REQUEST');
        if (!parental && (!('actor' in decision) || decision.actor.kind !== 'human')) throw new DomainError('INVALID_REQUEST');
        const normalized = (parental
          ? { ...decision, actor: { kind: 'model' as const, id: `parent:${parent.sessionId}` } }
          : decision) as unknown as ReviewDecision;
        return { success: true, value: await repository.decideReview(id, normalized, clock(), parent) };
      } catch (error) { return failure(error); }
    },
  };
}
