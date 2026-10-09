import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import {
  isSafeCorrelation, parseRpcRequest, parseRpcResponse, replyChannel, requestChannel,
  type RpcOperation, type RpcParams, type RpcResponse,
} from "./rpc-contracts.ts";
import type { EventBusLike, TimerApi } from "./job-events.ts";

export type RpcClientErrorCode = "RPC_CLIENT_TIMEOUT" | "RPC_CLIENT_CLOSED" | "RPC_CLIENT_TRANSPORT" | "RPC_CLIENT_SESSION_REQUIRED" | "RPC_CLIENT_INVALID_OPTIONS";
export class RpcClientError extends Error {
  readonly code: RpcClientErrorCode;
  constructor(code: RpcClientErrorCode, message: string) { super(message); this.name = "RpcClientError"; this.code = code; }
}

type RpcClientOptions = {
  bus: EventBusLike;
  callerId: string;
  sessionId?: string;
  timers?: TimerApi;
  createCorrelationId?: () => string;
};
type RpcCallOptions = { requestId: string; timeoutMs?: number };
type PendingCall = { finish(error?: Error, response?: RpcResponse): void };

const queryTimeoutMs = 6000;
const mutationTimeoutMs = 31000;
const timersDefault: TimerApi = { setTimeout, clearTimeout };

function defaultTimeout(operation: RpcOperation, params: RpcParams[RpcOperation]): number {
  if (operation === "wait") return (((params as RpcParams["wait"]).timeoutSeconds ?? 300) * 1000) + 1000;
  if (operation === "spawn" || operation === "control" || (operation === "result" && (params as RpcParams["result"]).operation === "consume")) return mutationTimeoutMs;
  return queryTimeoutMs;
}

export function createRpcClient(options: RpcClientOptions): {
  call<O extends RpcOperation>(operation: O, params: RpcParams[O], callOptions: RpcCallOptions): Promise<RpcResponse<O>>;
  close(): void;
} {
  if (!options.callerId || Buffer.byteLength(options.callerId, "utf8") > 256) throw new RpcClientError("RPC_CLIENT_INVALID_OPTIONS", "callerId no es válido.");
  if (options.sessionId !== undefined && (!options.sessionId || Buffer.byteLength(options.sessionId, "utf8") > 256)) throw new RpcClientError("RPC_CLIENT_INVALID_OPTIONS", "sessionId no es válido.");

  const timers = options.timers ?? timersDefault;
  const makeCorrelationId = options.createCorrelationId ?? randomUUID;
  const pending = new Map<string, PendingCall>();
  let sessionId = options.sessionId;
  let closed = false;

  const call = async <O extends RpcOperation>(operation: O, params: RpcParams[O], callOptions: RpcCallOptions): Promise<RpcResponse<O>> => {
    if (closed) throw new RpcClientError("RPC_CLIENT_CLOSED", "El cliente RPC está cerrado.");
    if (operation !== "ping" && !sessionId) throw new RpcClientError("RPC_CLIENT_SESSION_REQUIRED", "Ejecuta ping antes de usar el cliente RPC.");
    const correlationId = makeCorrelationId();
    if (!isSafeCorrelation(correlationId) || pending.has(correlationId)) throw new RpcClientError("RPC_CLIENT_INVALID_OPTIONS", "correlationId no es válido o ya está en uso.");
    const request = {
      protocolVersion: 1 as const,
      requestId: callOptions.requestId,
      correlationId,
      callerId: options.callerId,
      ...(sessionId === undefined ? {} : { sessionId }),
      params,
    };
    parseRpcRequest(operation, request);
    const timeoutMs = callOptions.timeoutMs ?? defaultTimeout(operation, params);
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new RpcClientError("RPC_CLIENT_INVALID_OPTIONS", "timeoutMs no es válido.");

    return await new Promise<RpcResponse<O>>((resolve, reject) => {
      let timer: ReturnType<TimerApi["setTimeout"]> | undefined;
      let unsubscribe: (() => void) | undefined;
      let settled = false;
      const finish = (error?: Error, response?: RpcResponse) => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) timers.clearTimeout(timer);
        try { unsubscribe?.(); } catch { /* listener cleanup is best-effort after transport failure */ }
        pending.delete(correlationId);
        if (error) reject(error);
        else resolve(response as RpcResponse<O>);
      };
      pending.set(correlationId, { finish });
      try {
        unsubscribe = options.bus.on(replyChannel(operation, correlationId), value => {
          let response: RpcResponse<O>;
          try { response = parseRpcResponse(operation, value); } catch { return; }
          if (response.correlationId !== correlationId || response.requestId !== request.requestId) return;
          if (sessionId !== undefined && response.sessionId !== sessionId && (response.success || response.error.code !== "SESSION_MISMATCH")) return;
          if (operation === "ping" && response.success) {
            const discovery = (response as Extract<RpcResponse<"ping">, { success: true }>).data;
            if (discovery.sessionId !== response.sessionId) return;
            sessionId = discovery.sessionId;
          }
          finish(undefined, response);
        });
        timer = timers.setTimeout(() => finish(new RpcClientError("RPC_CLIENT_TIMEOUT", "La llamada RPC excedió su timeout local.")), timeoutMs);
        options.bus.emit(requestChannel(operation), request);
      } catch {
        finish(new RpcClientError("RPC_CLIENT_TRANSPORT", "No se pudo enviar o suscribir la llamada RPC."));
      }
    });
  };

  return {
    call,
    close() {
      if (closed) return;
      closed = true;
      for (const { finish } of [...pending.values()]) finish(new RpcClientError("RPC_CLIENT_CLOSED", "El cliente RPC está cerrado."));
    },
  };
}
