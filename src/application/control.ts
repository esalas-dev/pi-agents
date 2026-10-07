import type { JobRepository } from "../infrastructure/durable/repository.ts";
import type { ControlPolicy, ControlReceipt, ControlRequest, Clock, RetryReceipt, RetryRequest } from "../domain/requests.ts";
import { failure, type Outcome, DomainError } from "../domain/errors.ts";

export type ControlService = {
  control(id: string, request: ControlRequest): Promise<Outcome<ControlReceipt>>;
  retry(id: string, request: RetryRequest): Promise<Outcome<RetryReceipt>>;
};

export function defaultControlPolicy(job: { createdBy?: { kind: string; id?: string } }, request: ControlRequest): boolean {
  if (request.actor.kind === "human" || request.actor.kind === "system") return true;
  return job.createdBy?.kind === request.actor.kind && job.createdBy.id === request.actor.id;
}

export function createControlService(repository: JobRepository, clock: Clock = Date.now, policy: ControlPolicy = defaultControlPolicy): ControlService {
  return {
    async control(id, request) {
      try {
        const job = await repository.get(id);
        if (!job) throw new DomainError("JOB_NOT_FOUND");
        if (!policy(job, request)) throw new DomainError("CONTROL_NOT_AUTHORIZED");
        return { success: true, value: await repository.applyControl(id, request, clock()) };
      } catch (error) {
        return failure(error);
      }
    },
    async retry(id, request) {
      try {
        const job = await repository.get(id);
        if (!job) throw new DomainError("JOB_NOT_FOUND");
        if (!policy(job, request)) throw new DomainError("CONTROL_NOT_AUTHORIZED");
        return { success: true, value: await repository.retry(id, request, clock()) };
      } catch (error) {
        return failure(error);
      }
    },
  };
}
