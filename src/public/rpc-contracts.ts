import type { JobQueryView, JobStatusPublic, ReviewState } from "../domain/jobs.ts";

export type RpcOperation = "ping" | "status" | "list" | "wait" | "result" | "spawn" | "control" | "review";
export type RpcParams = {
  ping: {}; status: { id: string }; list: { statuses?: JobStatusPublic[]; agent?: string; createdBefore?: number; createdAfter?: number; pendingReview?: boolean; limit?: number; cursor?: string };
  wait: { id: string; until?: JobStatusPublic | "terminal"; timeoutSeconds?: number };
  result: { id: string; operation: "peek" | "consume" }; spawn: { agent: string; task: string };
  control: { id: string; action: "pause" | "resume" | "cancel" | "retry"; reason?: string }; review: Record<string, unknown>;
};
export type RpcRequest<O extends RpcOperation = RpcOperation> = { protocolVersion: 1; requestId: string; correlationId: string; callerId: string; sessionId?: string; params: RpcParams[O] };
export type RpcJobDto = { id: string; status: JobStatusPublic; agent: string; model: { provider: string; modelId: string }; createdAt: number; updatedAt: number; startedAt?: number; finishedAt?: number; queuePosition?: number; durationMs?: number; hasResult: boolean; reviewStatus: ReviewState; consumption: { count: number; firstConsumedAt?: number; lastConsumedAt?: number } };
export type RpcDiscovery = { protocolVersion: 1; sessionId: string; implementationVersion: string; operations: RpcOperation[]; capabilities: { query: boolean; wait: boolean; result: boolean; spawn: boolean; control: boolean; rpcReview: false; activePause: false; activeCancel: { requiresHumanConfirmation: true; available: boolean } }; limits: { maxListPage: 100; maxWaitSeconds: 300; maxResultBytes: 65536; recentEventWindow: 1000; queryTimeoutMs: 5000; mutationTimeoutMs: 30000; maxIdBytes: 256; maxCorrelationLength: 128 } };
export type RpcData = { ping: RpcDiscovery; status: RpcJobDto; wait: RpcJobDto; list: { items: RpcJobDto[]; nextCursor?: string }; spawn: { jobId: string; status: "queued"; agent: string }; control: { jobId: string; requestId: string; action: RpcParams["control"]["action"]; previousStatus: JobStatusPublic; status: JobStatusPublic; replayed: boolean; appliedAt: number; retryJobId?: string; retryOf?: string; attemptNumber?: number }; result: { job: RpcJobDto; result: { text: string; totalBytes: number; sha256: string; truncated: boolean; durationMs: number; model: { provider: string; modelId: string }; status: "completed" | "failed" | "interrupted" } }; review: never };
export type RpcErrorCode = "JOB_NOT_FOUND" | "INVALID_REQUEST" | "AGENT_NOT_FOUND" | "UNSUPPORTED_TOOLS" | "MODEL_UNAVAILABLE" | "REQUEST_ID_CONFLICT" | "RUNTIME_CLOSING" | "MIGRATION_REQUIRED" | "MIGRATION_DECLINED" | "BACKUP_FAILED" | "STORAGE_VERSION_UNSUPPORTED" | "STORAGE_INCONSISTENT" | "STORAGE_BUSY" | "STORAGE_ERROR" | "INVALID_FILTER" | "WAIT_TIMEOUT" | "WAIT_ABORTED" | "RESULT_NOT_READY" | "RESULT_REVIEW_REQUIRED" | "RESULT_REJECTED" | "PAUSE_ACTIVE_UNSUPPORTED" | "CONTROL_INVALID_STATE" | "CONTROL_NOT_AUTHORIZED" | "RETRY_NOT_ALLOWED" | "PROTOCOL_UNSUPPORTED" | "SESSION_MISMATCH" | "CAPABILITY_UNAVAILABLE" | "RPC_SHUTTING_DOWN" | "RPC_REVIEW_FORBIDDEN" | "RPC_TIMEOUT";
export type RpcError = { code: RpcErrorCode; message: string; retryable: boolean; details: {} };
export type RpcResponse<O extends RpcOperation = RpcOperation> = { protocolVersion: 1; requestId: string; correlationId: string; sessionId?: string } & ({ success: true; data: RpcData[O] } | { success: false; error: RpcError });

export class RpcValidationError extends Error { readonly code: RpcErrorCode; constructor(code: RpcErrorCode = "INVALID_REQUEST") { super("La solicitud RPC no es válida."); this.name = "RpcValidationError"; this.code = code; } }

const operations: RpcOperation[] = ["ping", "status", "list", "wait", "result", "spawn", "control", "review"];
const statuses = new Set<JobStatusPublic>(["queued", "paused", "running", "cancelling", "completed", "failed", "interrupted", "cancelled"]);
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const fail = (): never => { throw new RpcValidationError(); };
function plain(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value); if (proto !== Object.prototype && proto !== null) return false;
  for (const key of Object.keys(value)) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !("value" in descriptor) || (descriptor.value !== undefined && !jsonValue(descriptor.value))) fail(); }
  return true;
}
function jsonValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(item => jsonValue(item));
  return plain(value);
}
function string(value: unknown, maxBytes = 256): value is string { return typeof value === "string" && value.length > 0 && Buffer.byteLength(value) <= maxBytes; }
function number(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function keys(value: Record<string, unknown>, allowed: string[]) { return Object.keys(value).every(key => allowed.includes(key)); }
function paramsFor(operation: RpcOperation, value: unknown): boolean {
  if (!plain(value)) return false;
  const p = value;
  if (operation === "ping") return Object.keys(p).length === 0;
  if (operation === "status") return keys(p, ["id"]) && string(p.id);
  if (operation === "spawn") return keys(p, ["agent", "task"]) && string(p.agent) && string(p.task);
  if (operation === "result") return keys(p, ["id", "operation"]) && string(p.id) && (p.operation === "peek" || p.operation === "consume");
  if (operation === "control") return keys(p, ["id", "action", "reason"]) && string(p.id) && ["pause", "resume", "cancel", "retry"].includes(String(p.action)) && (p.reason === undefined || (typeof p.reason === "string" && p.reason.length <= 2048));
  if (operation === "wait") return keys(p, ["id", "until", "timeoutSeconds"]) && string(p.id) && (p.until === undefined || p.until === "terminal" || statuses.has(p.until as JobStatusPublic)) && (p.timeoutSeconds === undefined || (number(p.timeoutSeconds) && p.timeoutSeconds >= 0 && p.timeoutSeconds <= 300));
  if (operation === "list") return keys(p, ["statuses", "agent", "createdBefore", "createdAfter", "pendingReview", "limit", "cursor"]) && (p.statuses === undefined || (Array.isArray(p.statuses) && p.statuses.length > 0 && p.statuses.every(s => statuses.has(s as JobStatusPublic)))) && (p.agent === undefined || string(p.agent)) && (p.createdBefore === undefined || number(p.createdBefore)) && (p.createdAfter === undefined || number(p.createdAfter)) && (p.pendingReview === undefined || typeof p.pendingReview === "boolean") && (p.limit === undefined || (Number.isInteger(p.limit) && Number(p.limit) >= 1 && Number(p.limit) <= 100)) && (p.cursor === undefined || string(p.cursor));
  return operation === "review";
}

export function parseRpcRequest<O extends RpcOperation>(operation: O, input: unknown): RpcRequest<O> {
  if (!operations.includes(operation) || !plain(input)) fail();
  const value = input as Record<string, unknown>;
  if (!keys(value, ["protocolVersion", "requestId", "correlationId", "callerId", "sessionId", "params"]) || value.protocolVersion !== 1 || !string(value.requestId) || !string(value.correlationId, 128) || !/^[A-Za-z0-9._-]{1,128}$/.test(value.correlationId) || !string(value.callerId) || (value.sessionId !== undefined && !string(value.sessionId)) || (operation !== "ping" && value.sessionId === undefined) || !paramsFor(operation, value.params)) fail();
  return value as RpcRequest<O>;
}

export function parseRpcResponse<O extends RpcOperation>(operation: O, input: unknown): RpcResponse<O> {
  if (!operations.includes(operation) || !plain(input)) fail();
  const value = input as Record<string, unknown>;
  if (!keys(value, ["protocolVersion", "requestId", "correlationId", "sessionId", "success", "data", "error"]) || value.protocolVersion !== 1 || !string(value.requestId) || !isSafeCorrelation(value.correlationId) || (value.sessionId !== undefined && !string(value.sessionId)) || typeof value.success !== "boolean") fail();
  if (value.success === true ? !own(value, "data") || own(value, "error") : own(value, "data") || !plain(value.error) || !keys(value.error, ["code", "message", "retryable", "details"]) || !string(value.error.message) || typeof value.error.retryable !== "boolean" || !plain(value.error.details)) fail();
  return value as RpcResponse<O>;
}
export function isSafeCorrelation(input: unknown): input is string { return typeof input === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(input); }
export function hasOversizedIds(input: unknown): boolean { return !!input && typeof input === "object" && ["requestId", "callerId", "sessionId"].some(key => { const d = Object.getOwnPropertyDescriptor(input, key); return !!d && "value" in d && typeof d.value === "string" && Buffer.byteLength(d.value) > 256; }); }
export function requestChannel(operation: RpcOperation): string { return `pi-durable-subagents:rpc:${operation}:request`; }
export function replyChannel(operation: RpcOperation, correlationId: string): string { return `pi-durable-subagents:rpc:${operation}:reply:${correlationId}`; }
export function eventChannel(type: string): string { return `pi-durable-subagents:event:${type}`; }

export function projectJob(view: JobQueryView): RpcJobDto {
  const result: RpcJobDto = { id: view.id, status: (view.status as string) === "provisioning" ? "running" : view.status, agent: view.agent.name, model: { provider: view.model.provider, modelId: view.model.modelId }, createdAt: view.createdAt, updatedAt: view.updatedAt, hasResult: view.hasResult, reviewStatus: view.reviewStatus, consumption: { count: view.consumption.count } };
  for (const key of ["startedAt", "finishedAt", "queuePosition", "durationMs"] as const) if (view[key] !== undefined) result[key] = view[key] as never;
  if (view.consumption.firstConsumedAt !== undefined) result.consumption.firstConsumedAt = view.consumption.firstConsumedAt;
  if (view.consumption.lastConsumedAt !== undefined) result.consumption.lastConsumedAt = view.consumption.lastConsumedAt;
  return result;
}
