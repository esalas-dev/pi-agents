import type { JobRepository } from '../infrastructure/durable/repository.ts';
import type { ConsumeReceipt, ConsumeRequest } from '../domain/requests.ts';
import type { ResultAccess, ResultView } from '../domain/jobs.ts';
import { DomainError, failure, type Outcome } from '../domain/errors.ts';
import type { QueryService } from './query.ts';
import type { Clock } from '../domain/requests.ts';

export type ResultService = {
  getResult(id: string, access: ResultAccess): Promise<Outcome<ResultView>>;
  consumeResult(id: string, request: ConsumeRequest): Promise<Outcome<ConsumeReceipt>>;
};

export function createResultService(repository: JobRepository, query: Pick<QueryService, 'getJob'>, clock: Clock = Date.now): ResultService {
  const view = async (id: string): Promise<Outcome<ResultView>> => {
    const job = await repository.get(id);
    if (!job) return failure(new DomainError('JOB_NOT_FOUND'));
    const result = await repository.result(id);
    if (!result) return failure(new DomainError('RESULT_NOT_READY'));
    return { success: true, value: { job, queuePosition: await repository.queuedPosition(id), result } };
  };
  return {
    async getResult(id, access) {
      try {
        const queried = await query.getJob(id);
        if (!queried.success) return queried;
        if (!queried.value.hasResult || !['completed', 'failed', 'interrupted'].includes(queried.value.status)) throw new DomainError('RESULT_NOT_READY');
        if (access.mode === 'tool' && queried.value.reviewStatus === 'pending') throw new DomainError('RESULT_REVIEW_REQUIRED');
        if (access.mode === 'tool' && queried.value.reviewStatus === 'rejected') throw new DomainError('RESULT_REJECTED');
        if (access.operation === 'consume') {
          if (!access.requestId) throw new DomainError('INVALID_REQUEST');
          const consumed = await this.consumeResult(id, { requestId: access.requestId, actor: access.actor, consumer: access.actor.id ?? access.actor.kind });
          if (!consumed.success) return { success: false, error: consumed.error };
        }
        return await view(id);
      } catch (error) { return failure(error); }
    },
    async consumeResult(id, request) {
      try {
        if (!request.requestId || !request.consumer || !request.actor) throw new DomainError('INVALID_REQUEST');
        return { success: true, value: await repository.consume(id, request, clock()) };
      } catch (error) { return failure(error); }
    },
  };
}
