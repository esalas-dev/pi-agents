import type { JobRepository } from '../infrastructure/durable/repository.ts';
import type { ConsumeReceipt, ConsumeRequest } from '../domain/requests.ts';
import type { ResultAccess, ResultView } from '../domain/jobs.ts';
import { DomainError, failure, type Outcome } from '../domain/errors.ts';
import type { Clock } from '../domain/requests.ts';

export type ResultService = {
  getResult(id: string, access: ResultAccess): Promise<Outcome<ResultView>>;
  consumeResult(id: string, request: ConsumeRequest): Promise<Outcome<ConsumeReceipt>>;
};

export function createResultService(repository: JobRepository, _query: unknown, clock: Clock = Date.now): ResultService {
  return {
    async getResult(id, access) {
      try {
        if (access.operation === 'consume') {
          if (!access.requestId) throw new DomainError('INVALID_REQUEST');
          const consumed = await this.consumeResult(id, { requestId: access.requestId, actor: access.actor, consumer: access.actor.id ?? access.actor.kind });
          if (!consumed.success) return consumed;
        }
        return { success: true, value: await repository.readAuthorizedResult(id, access) };
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
