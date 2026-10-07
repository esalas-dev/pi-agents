import { createHash } from "node:crypto";
import { publicStatus, type JobListView, type JobQueryView, type JobResult, type JobStatus, type JobView, type ResultView } from "../../domain/jobs.ts";
import type { ReviewReceipt } from "../../domain/requests.ts";

const duration = (ms: number | undefined) => ms === undefined ? "—" : ms < 1000 ? `${ms} ms` : `${Math.round(ms / 100) / 10} s`;
export function briefSummary(result: JobResult | undefined, status: JobStatus, maxLength = 180): string {
  const source = result?.finalResponse || result?.error || status; const line = source.replace(/\s+/g, " ").trim(); return line.length <= maxLength ? line : `${line.slice(0, Math.max(0, maxLength - 1))}…`;
}
export function formatStatus(view: JobView): string {
  const job = view.job; const result = job.resultMeta;
  return [`ID: ${job.id}`, `Estado: ${publicStatus(job)}${view.queuePosition ? ` (posición ${view.queuePosition})` : ""}`, `Agente: ${job.agent.name} (${job.agent.source})`, `Modelo: ${result?.model.provider ?? job.model.provider}/${result?.model.modelId ?? job.model.modelId}`, `Directorio: ${job.cwd}`, ...(result ? [`Duración: ${duration(result.durationMs)}`] : []), ...(result?.error ? [`Error: ${result.error}`] : [])].join("\n");
}
export function formatResult(view: ResultView): string {
  const result = view.result; return `${formatStatus({ job: view.job, queuePosition: view.queuePosition })}\n\n${result ? `Respuesta final:\n${result.finalResponse || "(sin respuesta final)"}` : "El resultado todavía no está disponible."}`;
}

export function formatList(page: { items: readonly JobListView[]; nextCursor?: string }): string {
  const lines = page.items.map(item => `${item.id} · ${item.status} · ${item.agent.name} · ${item.createdAt}${item.reviewStatus === "pending" ? " · revisión pendiente" : ""}`);
  if (page.nextCursor) lines.push(`Siguiente cursor: ${page.nextCursor}`);
  return lines.join("\n") || "No hay trabajos.";
}

export function formatWait(view: JobQueryView): string {
  return `ID: ${view.id}\nEstado: ${view.status}\nAgente: ${view.agent.name}\nResultado: ${view.hasResult ? "disponible" : "pendiente"}`;
}

export function formatReview(receipt: Pick<ReviewReceipt, "jobId" | "status" | "decidedBy">): string {
  return `Trabajo ${receipt.jobId}: revisión ${receipt.status}${receipt.decidedBy ? ` por ${receipt.decidedBy}` : ""}`;
}

export type BoundedToolResult = { text: string; totalBytes: number; sha256: string; truncated: boolean };
export function truncateToolResult(result: string, maxBytes = 64 * 1024): BoundedToolResult {
  const body = String(result);
  const bytes = Buffer.from(body, "utf8");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength <= maxBytes) return { text: body, totalBytes: bytes.byteLength, sha256, truncated: false };
  let end = Math.max(0, maxBytes);
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return { text: bytes.subarray(0, end).toString("utf8"), totalBytes: bytes.byteLength, sha256, truncated: true };
}
