import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { Actor } from "./requests.ts";
import { DomainError } from "./errors.ts";

export type JobStatus = "queued" | "provisioning" | "running" | "completed" | "failed" | "interrupted";
export type JobStatusPublic = Exclude<JobStatus, "provisioning">;
export type JobAgentSnapshot = { name: string; description: string; systemPrompt: string; source: "personal" | "project"; filePath: string; tools: string[] };
export type JobModel = { provider: string; modelId: string };
export type JobResult = { finalResponse: string; durationMs: number; model: JobModel; status: "completed" | "failed" | "interrupted"; error?: string };
export type JobRecord = {
  id: string; status: JobStatus; task: string; cwd: string; createdAt: number; updatedAt: number; startedAt?: number; finishedAt?: number;
  agent: JobAgentSnapshot; model: JobModel; thinkingLevel: ModelThinkingLevel; conversationId?: number; submissionId?: number;
  result?: JobResult; resultMeta?: Omit<JobResult, "finalResponse">; createdBy?: Actor; notified: boolean;
};

const terminal = new Set<JobStatus>(["completed", "failed", "interrupted"]);
const tools = new Set(["read", "write", "edit", "bash"]);
const finite = (value: number) => Number.isFinite(value) && value >= 0;

export function publicStatus(job: Pick<JobRecord, "status">): JobStatusPublic {
  return job.status === "provisioning" ? "running" : job.status;
}

export function assertJob(job: JobRecord): void {
  if (!job || typeof job.id !== "string" || typeof job.task !== "string" || !job.task.trim() || !pathAbsolute(job.cwd)
    || !finite(job.createdAt) || !finite(job.updatedAt) || !job.agent || !Array.isArray(job.agent.tools)
    || job.agent.tools.some(tool => !tools.has(tool)) || !job.model?.provider || !job.model?.modelId
    || !["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(job.thinkingLevel)
    || typeof job.notified !== "boolean") throw new DomainError("STORAGE_INCONSISTENT");
  if (job.status === "provisioning" && job.conversationId === undefined) throw new DomainError("STORAGE_INCONSISTENT");
  if (job.status === "running" && (job.conversationId === undefined || job.submissionId === undefined)) throw new DomainError("STORAGE_INCONSISTENT");
  if (terminal.has(job.status) && !job.result) throw new DomainError("STORAGE_INCONSISTENT");
}

function pathAbsolute(value: string): boolean { return typeof value === "string" && value.startsWith("/"); }

export function assertResult(result: JobResult): void {
  if (!result || typeof result.finalResponse !== "string" || !finite(result.durationMs) || !result.model?.provider || !result.model?.modelId
    || !["completed", "failed", "interrupted"].includes(result.status)) throw new DomainError("STORAGE_INCONSISTENT");
}

export function transition(job: JobRecord, next: JobStatus, at: number): JobRecord {
  assertJob(job);
  if (!finite(at) || terminal.has(job.status)) throw new DomainError("STORAGE_INCONSISTENT");
  const valid = (job.status === "queued" && next === "provisioning") || (job.status === "provisioning" && next === "running")
    || (!terminal.has(job.status) && next === "failed") || (job.status === "running" && next === "completed");
  if (!valid) throw new DomainError("STORAGE_INCONSISTENT");
  const changed = structuredClone(job);
  changed.status = next; changed.updatedAt = at;
  return changed;
}
