import { publicStatus, type JobResult, type JobStatus, type JobView, type ResultView } from "../../domain/jobs.ts";

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
