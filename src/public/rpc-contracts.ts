import type { JobQueryView, JobStatusPublic, ReviewState } from "../domain/jobs.ts";
import type { ErrorCode } from "../domain/errors.ts";

export type RpcOperation = "ping" | "status" | "list" | "wait" | "result" | "spawn" | "control" | "review";
export type RpcParams = {
  ping: {}; status: { id: string }; list: { statuses?: JobStatusPublic[]; agent?: string; createdBefore?: number; createdAfter?: number; pendingReview?: boolean; limit?: number; cursor?: string };
  wait: { id: string; until?: JobStatusPublic | "terminal"; timeoutSeconds?: number };
  result: { id: string; operation: "peek" | "consume" }; spawn: { agent: string; task: string };
  control: { id: string; action: "pause" | "resume" | "cancel" | "retry"; reason?: string }; review: Record<string, unknown>;
};
export type RpcRequest<O extends RpcOperation = RpcOperation> = { protocolVersion: 1; requestId: string; correlationId: string; callerId: string; params: RpcParams[O] } & (O extends "ping" ? { sessionId?: string } : { sessionId: string });
export type RpcJobDto = { id: string; status: JobStatusPublic; agent: string; model: { provider: string; modelId: string }; createdAt: number; updatedAt: number; startedAt?: number; finishedAt?: number; queuePosition?: number; durationMs?: number; hasResult: boolean; reviewStatus: ReviewState; consumption: { count: number; firstConsumedAt?: number; lastConsumedAt?: number } };
export type RpcDiscovery = { protocolVersion: 1; sessionId: string; implementationVersion: string; operations: RpcOperation[]; capabilities: { query: boolean; wait: boolean; result: boolean; spawn: boolean; control: boolean; rpcReview: false; activePause: false; activeCancel: { requiresHumanConfirmation: true; available: boolean } }; limits: { maxListPage: 100; maxWaitSeconds: 300; maxResultBytes: 65536; recentEventWindow: 1000; queryTimeoutMs: 5000; mutationTimeoutMs: 30000; maxIdBytes: 256; maxCorrelationLength: 128 } };
export type RpcData = { ping: RpcDiscovery; status: RpcJobDto; wait: RpcJobDto; list: { items: RpcJobDto[]; nextCursor?: string }; spawn: { jobId: string; status: "queued"; agent: string }; control: { jobId: string; requestId: string; action: RpcParams["control"]["action"]; previousStatus: JobStatusPublic; status: JobStatusPublic; replayed: boolean; appliedAt: number; retryJobId?: string; retryOf?: string; attemptNumber?: number }; result: { job: RpcJobDto; result: { text: string; totalBytes: number; sha256: string; truncated: boolean; durationMs: number; model: { provider: string; modelId: string }; status: "completed" | "failed" | "interrupted" } }; review: never };
export type RpcErrorCode = Exclude<ErrorCode, "CONTROL_CONFLICT" | "ACTIVE_CANCEL_CONFIRMATION_REQUIRED"> | "PROTOCOL_UNSUPPORTED" | "SESSION_MISMATCH" | "CAPABILITY_UNAVAILABLE" | "RPC_SHUTTING_DOWN" | "RPC_REVIEW_FORBIDDEN" | "RPC_TIMEOUT";
export type RpcError = { code: RpcErrorCode; message: string; retryable: boolean; details: {} };
export type RpcResponse<O extends RpcOperation = RpcOperation> = { protocolVersion: 1; requestId: string; correlationId: string; sessionId: string } & ({ success: true; data: RpcData[O] } | { success: false; error: RpcError });
export class RpcValidationError extends Error { readonly code: RpcErrorCode; constructor(code: RpcErrorCode = "INVALID_REQUEST") { super("La solicitud RPC no es válida."); this.name = "RpcValidationError"; this.code = code; } }

const operations: RpcOperation[] = ["ping", "status", "list", "wait", "result", "spawn", "control", "review"];
const statuses = new Set<JobStatusPublic>(["queued", "paused", "running", "cancelling", "completed", "failed", "interrupted", "cancelled"]);
const errorCodes = new Set<string>(["JOB_NOT_FOUND", "INVALID_REQUEST", "AGENT_NOT_FOUND", "UNSUPPORTED_TOOLS", "MODEL_UNAVAILABLE", "REQUEST_ID_CONFLICT", "RUNTIME_CLOSING", "MIGRATION_REQUIRED", "MIGRATION_DECLINED", "BACKUP_FAILED", "STORAGE_VERSION_UNSUPPORTED", "STORAGE_INCONSISTENT", "STORAGE_BUSY", "STORAGE_ERROR", "INVALID_FILTER", "WAIT_TIMEOUT", "WAIT_ABORTED", "RESULT_NOT_READY", "RESULT_REVIEW_REQUIRED", "RESULT_REJECTED", "PAUSE_ACTIVE_UNSUPPORTED", "CONTROL_INVALID_STATE", "CONTROL_NOT_AUTHORIZED", "RETRY_NOT_ALLOWED", "PROTOCOL_UNSUPPORTED", "SESSION_MISMATCH", "CAPABILITY_UNAVAILABLE", "RPC_SHUTTING_DOWN", "RPC_REVIEW_FORBIDDEN", "RPC_TIMEOUT"]);
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const fail = (code: RpcErrorCode = "INVALID_REQUEST"): never => { throw new RpcValidationError(code); };

function jsonGraph(value: unknown, active = new WeakSet<object>(), allowUndefined = true): boolean {
  if (value === undefined) return allowUndefined;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || typeof value === "function" || typeof value === "bigint") return false;
  if (active.has(value)) return false;
  active.add(value);
  const proto = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (proto !== Array.prototype) { active.delete(value); return false; }
  } else if (proto !== Object.prototype && proto !== null) { active.delete(value); return false; }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") { active.delete(value); return false; }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !jsonGraph(descriptor.value, active, Array.isArray(value) ? false : true)) { active.delete(value); return false; }
  }
  active.delete(value);
  return true;
}
function plain(value: unknown): value is Record<string, unknown> { return jsonGraph(value) && !!value && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
function string(value: unknown, maxBytes = 256): value is string { return typeof value === "string" && value.length > 0 && Buffer.byteLength(value) <= maxBytes; }
function number(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function keys(value: Record<string, unknown>, allowed: string[]) { return Object.keys(value).every(key => allowed.includes(key)); }
function requiredKeys(value: Record<string, unknown>, required: string[]) { return required.every(key => own(value, key)); }
function validStatus(value: unknown): value is JobStatusPublic { return typeof value === "string" && statuses.has(value as JobStatusPublic); }
function validJob(value: unknown): value is RpcJobDto {
  if (!plain(value) || !keys(value, ["id", "status", "agent", "model", "createdAt", "updatedAt", "startedAt", "finishedAt", "queuePosition", "durationMs", "hasResult", "reviewStatus", "consumption"]) || !requiredKeys(value, ["id", "status", "agent", "model", "createdAt", "updatedAt", "hasResult", "reviewStatus", "consumption"])) return false;
  const model = value.model as Record<string, unknown>; const consumption = value.consumption as Record<string, unknown>;
  return string(value.id) && validStatus(value.status) && string(value.agent) && plain(model) && keys(model, ["provider", "modelId"]) && requiredKeys(model, ["provider", "modelId"]) && string(model.provider) && string(model.modelId)
    && number(value.createdAt) && number(value.updatedAt) && (value.startedAt === undefined || number(value.startedAt)) && (value.finishedAt === undefined || number(value.finishedAt))
    && (value.queuePosition === undefined || (Number.isInteger(value.queuePosition) && (value.queuePosition as number) >= 0)) && (value.durationMs === undefined || number(value.durationMs)) && typeof value.hasResult === "boolean"
    && ["not_required", "pending", "approved", "rejected"].includes(String(value.reviewStatus)) && plain(consumption) && keys(consumption, ["count", "firstConsumedAt", "lastConsumedAt"]) && requiredKeys(consumption, ["count"]) && Number.isInteger(consumption.count) && (consumption.count as number) >= 0
    && (consumption.firstConsumedAt === undefined || number(consumption.firstConsumedAt)) && (consumption.lastConsumedAt === undefined || number(consumption.lastConsumedAt));
}
function paramsFor(operation: RpcOperation, value: unknown): boolean {
  if (!plain(value)) return false;
  const p = value;
  if (operation === "ping") return Object.keys(p).length === 0;
  if (operation === "status") return keys(p, ["id"]) && requiredKeys(p, ["id"]) && string(p.id);
  if (operation === "spawn") return keys(p, ["agent", "task"]) && requiredKeys(p, ["agent", "task"]) && string(p.agent) && string(p.task, Number.MAX_SAFE_INTEGER);
  if (operation === "result") return keys(p, ["id", "operation"]) && requiredKeys(p, ["id", "operation"]) && string(p.id) && (p.operation === "peek" || p.operation === "consume");
  if (operation === "control") return keys(p, ["id", "action", "reason"]) && requiredKeys(p, ["id", "action"]) && string(p.id) && ["pause", "resume", "cancel", "retry"].includes(String(p.action)) && (p.reason === undefined || (typeof p.reason === "string" && p.reason.length <= 2048));
  if (operation === "wait") return keys(p, ["id", "until", "timeoutSeconds"]) && requiredKeys(p, ["id"]) && string(p.id) && (p.until === undefined || p.until === "terminal" || validStatus(p.until)) && (p.timeoutSeconds === undefined || (number(p.timeoutSeconds) && p.timeoutSeconds >= 0 && p.timeoutSeconds <= 300));
  if (operation === "list") return keys(p, ["statuses", "agent", "createdBefore", "createdAfter", "pendingReview", "limit", "cursor"]) && (p.statuses === undefined || (Array.isArray(p.statuses) && p.statuses.length > 0 && p.statuses.every(validStatus))) && (p.agent === undefined || string(p.agent)) && (p.createdBefore === undefined || number(p.createdBefore)) && (p.createdAfter === undefined || number(p.createdAfter)) && (p.pendingReview === undefined || typeof p.pendingReview === "boolean") && (p.limit === undefined || (Number.isInteger(p.limit) && (p.limit as number) >= 1 && (p.limit as number) <= 100)) && (p.cursor === undefined || string(p.cursor));
  return operation === "review";
}

export function parseRpcRequest<O extends RpcOperation>(operation: O, input: unknown): RpcRequest<O> {
  if (!operations.includes(operation) || !plain(input)) fail();
  const value = input as Record<string, unknown>;
  if (value.protocolVersion !== 1) fail("PROTOCOL_UNSUPPORTED");
  if (!keys(value, ["protocolVersion", "requestId", "correlationId", "callerId", "sessionId", "params"]) || !requiredKeys(value, ["protocolVersion", "requestId", "correlationId", "callerId", "params"]) || !string(value.requestId) || !isSafeCorrelation(value.correlationId) || !string(value.callerId) || (value.sessionId !== undefined && !string(value.sessionId)) || (operation !== "ping" && !string(value.sessionId)) || !paramsFor(operation, value.params)) fail();
  return value as RpcRequest<O>;
}
function validDiscovery(value: unknown): value is RpcDiscovery {
  if (!plain(value) || !keys(value, ["protocolVersion", "sessionId", "implementationVersion", "operations", "capabilities", "limits"]) || !requiredKeys(value, ["protocolVersion", "sessionId", "implementationVersion", "operations", "capabilities", "limits"])) return false;
  const c = value.capabilities as Record<string, unknown>; const a = c?.activeCancel as Record<string, unknown>; const l = value.limits as Record<string, unknown>;
  return value.protocolVersion === 1 && string(value.sessionId) && string(value.implementationVersion) && Array.isArray(value.operations) && value.operations.length === operations.length && value.operations.every(op => operations.includes(op as RpcOperation)) && plain(c) && keys(c, ["query", "wait", "result", "spawn", "control", "rpcReview", "activePause", "activeCancel"]) && typeof c.query === "boolean" && typeof c.wait === "boolean" && typeof c.result === "boolean" && typeof c.spawn === "boolean" && typeof c.control === "boolean" && c.rpcReview === false && c.activePause === false && plain(a) && keys(a, ["requiresHumanConfirmation", "available"]) && a.requiresHumanConfirmation === true && typeof a.available === "boolean" && plain(l) && keys(l, ["maxListPage", "maxWaitSeconds", "maxResultBytes", "recentEventWindow", "queryTimeoutMs", "mutationTimeoutMs", "maxIdBytes", "maxCorrelationLength"]) && Object.entries({ maxListPage: 100, maxWaitSeconds: 300, maxResultBytes: 65536, recentEventWindow: 1000, queryTimeoutMs: 5000, mutationTimeoutMs: 30000, maxIdBytes: 256, maxCorrelationLength: 128 }).every(([k, v]) => l[k] === v);
}
function validData(operation: RpcOperation, value: unknown): boolean {
  if (operation === "ping") return validDiscovery(value);
  if (operation === "status" || operation === "wait") return validJob(value);
  if (operation === "list") return plain(value) && keys(value, ["items", "nextCursor"]) && requiredKeys(value, ["items"]) && Array.isArray(value.items) && value.items.every(validJob) && (value.nextCursor === undefined || string(value.nextCursor));
  if (operation === "spawn") return plain(value) && keys(value, ["jobId", "status", "agent"]) && requiredKeys(value, ["jobId", "status", "agent"]) && string(value.jobId) && value.status === "queued" && string(value.agent);
  if (operation === "control") return plain(value) && keys(value, ["jobId", "requestId", "action", "previousStatus", "status", "replayed", "appliedAt", "retryJobId", "retryOf", "attemptNumber"]) && requiredKeys(value, ["jobId", "requestId", "action", "previousStatus", "status", "replayed", "appliedAt"]) && string(value.jobId) && string(value.requestId) && ["pause", "resume", "cancel", "retry"].includes(String(value.action)) && validStatus(value.previousStatus) && validStatus(value.status) && typeof value.replayed === "boolean" && number(value.appliedAt);
  if (operation === "result") { const r = (value as Record<string, unknown>)?.result as Record<string, unknown>; return plain(value) && keys(value, ["job", "result"]) && requiredKeys(value, ["job", "result"]) && validJob(value.job) && plain(r) && keys(r, ["text", "totalBytes", "sha256", "truncated", "durationMs", "model", "status"]) && requiredKeys(r, ["text", "totalBytes", "sha256", "truncated", "durationMs", "model", "status"]) && typeof r.text === "string" && Number.isInteger(r.totalBytes) && (r.totalBytes as number) >= 0 && string(r.sha256) && typeof r.truncated === "boolean" && number(r.durationMs) && plain(r.model) && string(r.model.provider) && string(r.model.modelId) && ["completed", "failed", "interrupted"].includes(String(r.status)); }
  return false;
}
export function parseRpcResponse<O extends RpcOperation>(operation: O, input: unknown): RpcResponse<O> {
  if (!operations.includes(operation) || !plain(input)) fail();
  const value = input as Record<string, unknown>;
  if (value.protocolVersion !== 1) fail("PROTOCOL_UNSUPPORTED");
  if (!requiredKeys(value, ["protocolVersion", "requestId", "correlationId", "sessionId", "success"]) || !string(value.requestId) || !isSafeCorrelation(value.correlationId) || !string(value.sessionId) || typeof value.success !== "boolean") fail();
  if (value.success === true ? (!own(value, "data") || own(value, "error") || !validData(operation, value.data)) : (own(value, "data") || !plain(value.error) || !keys(value.error, ["code", "message", "retryable", "details"]) || !requiredKeys(value.error, ["code", "message", "retryable", "details"]) || !errorCodes.has(String(value.error.code)) || !string(value.error.message) || typeof value.error.retryable !== "boolean" || !plain(value.error.details))) fail(operation === "review" && value.success === true ? "RPC_REVIEW_FORBIDDEN" : "INVALID_REQUEST");
  if (operation === "review" && value.success === true) fail("RPC_REVIEW_FORBIDDEN");
  return value as RpcResponse<O>;
}
export function isSafeCorrelation(input: unknown): input is string { return typeof input === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(input); }
export function hasOversizedIds(input: unknown): boolean { return !!input && typeof input === "object" && ["requestId", "callerId", "sessionId"].some(key => { const d = Object.getOwnPropertyDescriptor(input, key); return !!d && "value" in d && typeof d.value === "string" && Buffer.byteLength(d.value) > 256; }); }
export function requestChannel(operation: RpcOperation): string { return `pi-durable-subagents:rpc:${operation}`; }
export function replyChannel(operation: RpcOperation, correlationId: string): string { return `pi-durable-subagents:rpc:${operation}:reply:${correlationId}`; }
export { eventChannel } from "./job-events.ts";
export function projectJob(view: JobQueryView): RpcJobDto { const result: RpcJobDto = { id: view.id, status: (view.status as string) === "provisioning" ? "running" : view.status, agent: view.agent.name, model: { provider: view.model.provider, modelId: view.model.modelId }, createdAt: view.createdAt, updatedAt: view.updatedAt, hasResult: view.hasResult, reviewStatus: view.reviewStatus, consumption: { count: view.consumption.count } }; for (const key of ["startedAt", "finishedAt", "queuePosition", "durationMs"] as const) if (view[key] !== undefined) result[key] = view[key] as never; if (view.consumption.firstConsumedAt !== undefined) result.consumption.firstConsumedAt = view.consumption.firstConsumedAt; if (view.consumption.lastConsumedAt !== undefined) result.consumption.lastConsumedAt = view.consumption.lastConsumedAt; return result; }
