import { createHash } from "node:crypto";
import * as path from "node:path";
import { DomainError } from "./errors.ts";

export type Actor = { kind: "human" | "model" | "extension" | "system"; id?: string };
export type StartIntent = { agent: string; task: string; cwd: string };
export type StartRequest = { requestId: string; actor: Actor; intent: StartIntent };

function jsonValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(jsonValue);
  if (typeof value === "object") {
    const object = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(value as object).sort()) object[key] = jsonValue((value as Record<string, unknown>)[key]);
    return object;
  }
  throw new DomainError("INVALID_REQUEST", "La solicitud contiene un valor no serializable.");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(jsonValue(value));
}

export function canonicalStart(request: StartRequest): { normalized: StartRequest; payloadHash: string; key: string } {
  if (!request || typeof request !== "object" || typeof request.requestId !== "string" || !request.requestId
    || !request.actor || typeof request.actor !== "object" || !["human", "model", "extension", "system"].includes(request.actor.kind)
    || !request.intent || typeof request.intent !== "object" || typeof request.intent.agent !== "string"
    || typeof request.intent.task !== "string" || !request.intent.task.trim() || typeof request.intent.cwd !== "string"
    || !path.isAbsolute(request.intent.cwd)) throw new DomainError("INVALID_REQUEST");
  const actor: Actor = { kind: request.actor.kind, ...(request.actor.id === undefined ? {} : { id: request.actor.id }) };
  const normalized: StartRequest = {
    requestId: request.requestId,
    actor,
    intent: { agent: request.intent.agent, task: request.intent.task.trim(), cwd: path.resolve(request.intent.cwd) },
  };
  const payload = canonicalJson({ version: 1, operation: "start", actor: normalized.actor, intent: normalized.intent });
  return {
    normalized,
    payloadHash: createHash("sha256").update(payload).digest("hex"),
    key: createHash("sha256").update(normalized.requestId).digest("hex"),
  };
}
