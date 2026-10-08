import * as path from "node:path";
import { Buffer } from "node:buffer";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { DomainError } from "../../domain/errors.ts";
import { createMaintenanceService } from "../../application/maintenance.ts";
import { openSessionRuntime, type SessionRuntime } from "../../runtime/session.ts";
import { parsePiAgentsCommand, CommandSyntaxError } from "../../command.ts";
import type { JobRecord, JobResult } from "../../domain/jobs.ts";
import type { StartRequest } from "../../domain/requests.ts";
import { resolveInput, type PiBindings } from "./resolve.ts";
import { formatControl, formatList, formatResult, formatReview, formatStatus, formatWait, briefSummary, truncateToolResult } from "./display.ts";
import { discoverAgents } from "../../agents.ts";

const NOTICE = "pi-agents-notice"; const OUTPUT = "pi-agents-output"; const MAX_CONCURRENCY = 16;
const fileName = (id: string) => id.replace(/[^a-zA-Z0-9._-]/g, "_");
const statePath = (id: string, dir: string) => path.join(process.env.PI_AGENTS_STATE_DIR?.trim() || path.join(dir, "pi-agents", "sessions"), `${fileName(id)}.sqlite`);
const display = (value: unknown): value is { title: string; text: string; level: "info" | "success" | "error"; jobId?: string } => Boolean(value && typeof value === "object" && typeof (value as any).title === "string" && typeof (value as any).text === "string");
const toolReply = (outcome: any, text: (value: any) => string) => outcome.success ? { content: [{ type: "text", text: text(outcome.value) }] } : { content: [{ type: "text", text: outcome.error.message }], details: outcome.error, isError: true };
const boundedText = (value: string) => { const full = truncateToolResult(value); const prefix = `totalBytes=${full.totalBytes} sha256=${full.sha256} truncated=`; const body = truncateToolResult(value, Math.max(0, 64 * 1024 - Buffer.byteLength(prefix) - 20)); return `${prefix}${body.truncated}\n${body.text}`; };
export function formatToolResultResponse(value: any) {
  const full = typeof value?.result?.finalResponse === "string" ? value.result.finalResponse : "";
  const metadata = truncateToolResult(full);
  return {
    content: [{ type: "text", text: boundedText(full) }],
    details: { jobId: value?.job?.id, status: value?.job?.status, result: { totalBytes: metadata.totalBytes, sha256: metadata.sha256, truncated: metadata.truncated } },
  };
}

export function canConfirmMigration(ctx: Pick<ExtensionContext, "mode" | "hasUI">): boolean { return ctx.mode === "tui" && ctx.hasUI; }

export function registerPiAgents(pi: ExtensionAPI, bindings: PiBindings): void {
  type State = { sessionId: string; runtime: SessionRuntime; models: ModelRuntime; context: ExtensionContext };
  let state: State | undefined; let lifecycle = Promise.resolve(); let agents: ReturnType<typeof discoverAgents>["agents"] = [];
  const report = (error: unknown) => { try { pi.appendEntry(OUTPUT, { title: "subagents", text: error instanceof Error ? error.message : String(error), level: "error" }); } catch {} };
  const completion = (ctx: ExtensionContext) => agents = discoverAgents({ cwd: ctx.cwd, agentDir: bindings.getAgentDir(), projectTrusted: ctx.isProjectTrusted() }).agents;
  const notify = async (job: JobRecord, result: JobResult, current: State) => {
    if (state !== current) return;
    const summary = briefSummary(result, job.status); pi.appendEntry(NOTICE, { title: `${job.status === "completed" ? "Subagente completado" : "Subagente finalizado"} · ${job.id}`, text: `${job.agent.name}: ${summary}`, level: job.status === "completed" ? "success" : "error", jobId: job.id });
    current.context.ui.notify(`${job.id}: ${summary}`, job.status === "completed" ? "info" : "error"); await current.runtime.jobs.markNotified(job.id);
  };
  const open = async (ctx: ExtensionContext) => {
    const id = ctx.sessionManager.getSessionId(); if (state?.sessionId === id) return;
    if (state) { await state.runtime.close(); state = undefined; }
    const models = await bindings.createModels({ authPath: path.join(bindings.getAgentDir(), "auth.json"), modelsPath: path.join(bindings.getAgentDir(), "models.json"), refreshOnCreate: false });
    for (const providerId of new Set(ctx.modelRegistry.getAll().map(model => model.provider))) { const provider = ctx.modelRegistry.getProvider(providerId); if (provider) models.registerNativeProvider(provider); }
    const database = statePath(id, bindings.getAgentDir());
    const runtimeOptions = { storagePath: database, models, context: BACKGROUND_CONTEXT, defaultCwd: ctx.cwd, sessionId: id, maxConcurrency: Math.max(1, Math.min(MAX_CONCURRENCY, Number(process.env.PI_AGENTS_CONCURRENCY) || 4)), onReport: report, onSettled: async (job: JobRecord, result: JobResult) => { const current = state; if (current?.sessionId === id) await notify(job, result, current); } };
    let runtime: SessionRuntime;
    try { runtime = await openSessionRuntime(runtimeOptions); }
    catch (error) {
      if (!(error instanceof DomainError) || error.error.code !== "MIGRATION_REQUIRED" || !canConfirmMigration(ctx)) throw error;
      const maintenance = createMaintenanceService(BACKGROUND_CONTEXT);
      while (true) {
        const migration = await maintenance.migrate({ dbPath: database, clock: Date.now, confirm: async info => {
          if (ctx.sessionManager.getSessionId() !== id) return undefined;
          const accepted = await ctx.ui.confirm("Migrar almacenamiento de subagents", `Se migrarán ${info.jobs} trabajos y se creará un backup.`);
          if (!accepted || ctx.sessionManager.getSessionId() !== id) return undefined;
          return { requestId: `migration:${id}:${Date.now()}`, actor: { kind: "human", id: "tui" }, dbPath: info.dbPath, sourceHash: info.sourceHash, approvedAt: Date.now() };
        } });
        if (!migration.success) throw new DomainError(migration.error.code);
        if (migration.value.schemaVersion === 5) break;
      }
      runtime = await openSessionRuntime(runtimeOptions);
    }
    state = { sessionId: id, runtime, models, context: ctx }; completion(ctx);
    const pending = await runtime.jobs.unnotified(); if (pending.success) for (const job of pending.value) { const view = await runtime.jobs.result(job.id); if (view.success && view.value.result) await notify(job, view.value.result, state); }
    return;
  };
  const ensure = async (ctx: ExtensionContext) => { const id = ctx.sessionManager.getSessionId(); if (state?.sessionId === id) return state; lifecycle = lifecycle.then(() => open(ctx)); await lifecycle; if (!state || state.sessionId !== id) throw new Error("No se pudo iniciar pi-agents."); return state; };
  const start = async (ctx: ExtensionContext, agent: string, task: string, requestId: string, actor: StartRequest["actor"]) => { const current = await ensure(ctx); return current.runtime.jobs.start({ requestId, actor, intent: { agent, task, cwd: ctx.cwd } }, intent => resolveInput(ctx, current.models, intent, bindings)); };
  const render = (entry: unknown, theme: any) => { if (!display(entry)) return undefined; const color = entry.level === "error" ? "error" : entry.level === "success" ? "success" : "accent"; return bindings.text(`${theme.fg(color, theme.bold(entry.title))}\n${entry.text}`) as Component; };
  pi.registerEntryRenderer(NOTICE, (entry: any, _options: any, theme: any) => render(entry.data, theme)); pi.registerEntryRenderer(OUTPUT, (entry: any, _options: any, theme: any) => render(entry.data, theme));
  pi.on("session_start", async (_event, ctx) => { lifecycle = lifecycle.then(async () => { try { await open(ctx); } catch (error) { report(error); } }); await lifecycle; });
  pi.on("session_shutdown", async () => { lifecycle = lifecycle.then(async () => { const current = state; state = undefined; if (current) await current.runtime.close(); }); await lifecycle; });
  const Type = bindings.Type as any;
  const textType = () => Type.String();
  const registerQueryTool = (tool: any) => pi.registerTool(tool);
  pi.registerTool(({ name: "pi_agents", label: "Pi Agents", description: "Inicia un agente durable en segundo plano.", parameters: Type.Object({ agent: textType(), task: textType() }), async execute(toolCallId: string, params: { agent: string; task: string }, _signal: AbortSignal, _onUpdate: unknown, ctx: ExtensionContext) { const outcome = await start(ctx, params.agent, params.task, `tool:${toolCallId}`, { kind: "model", id: toolCallId }); if (!outcome.success) return { content: [{ type: "text", text: outcome.error.message }], details: outcome.error, isError: true }; return { content: [{ type: "text", text: `Trabajo ${outcome.value.jobId} encolado para ${outcome.value.agent}.` }], details: outcome.value }; } } as any));
  registerQueryTool(({ name: "pi_agents_status", label: "Pi Agents status", description: "Consulta el estado durable de un trabajo.", parameters: Type.Object({ id: textType() }), async execute(_toolCallId: string, params: { id: string }, _signal: AbortSignal, _onUpdate: unknown, ctx: ExtensionContext) { const current = await ensure(ctx); return toolReply(await current.runtime.jobs.getJob(params.id, { includeTask: false }), formatWait); } } as any));
  registerQueryTool(({ name: "pi_agents_list", label: "Pi Agents list", description: "Lista trabajos de la sesión.", parameters: Type.Object({ statuses: Type.Optional?.(Type.Array?.(textType()) ?? textType()) ?? textType(), agent: Type.Optional?.(textType()) ?? textType(), limit: Type.Optional?.(Type.Number?.() ?? textType()) ?? textType(), cursor: Type.Optional?.(textType()) ?? textType(), pending_review: Type.Optional?.(Type.Boolean?.() ?? textType()) ?? textType() }), async execute(_toolCallId: string, params: any, _signal: AbortSignal, _onUpdate: unknown, ctx: ExtensionContext) { const current = await ensure(ctx); return toolReply(await current.runtime.jobs.listJobs({ statuses: params.statuses, agent: params.agent, limit: params.limit, cursor: params.cursor, pendingReview: params.pending_review }), formatList); } } as any));
  registerQueryTool(({ name: "pi_agents_wait", label: "Pi Agents wait", description: "Espera sin cancelar el trabajo.", parameters: Type.Object({ id: textType(), until: textType(), timeout_seconds: textType() }), async execute(_toolCallId: string, params: any, signal: AbortSignal, _onUpdate: unknown, ctx: ExtensionContext) { const current = await ensure(ctx); return toolReply(await current.runtime.jobs.waitForJob(params.id, { until: params.until, timeoutSeconds: params.timeout_seconds, signal }), formatWait); } } as any));
  registerQueryTool(({ name: "pi_agents_result", label: "Pi Agents result", description: "Recupera un resultado autorizado.", parameters: Type.Object({ id: textType(), consume: textType(), request_id: textType() }), async execute(toolCallId: string, params: any, _signal: AbortSignal, _onUpdate: unknown, ctx: ExtensionContext) { const current = await ensure(ctx); if (params.consume && !params.request_id) return { content: [{ type: "text", text: "consume requiere request_id." }], isError: true }; const outcome = await current.runtime.jobs.getResult(params.id, { mode: "tool", operation: params.consume ? "consume" : "peek", actor: { kind: "model", id: toolCallId }, ...(params.request_id ? { requestId: params.request_id } : {}) }); if (!outcome.success) return toolReply(outcome, value => value); return formatToolResultResponse(outcome.value); } } as any));
  registerQueryTool(({ name: "pi_agents_control", label: "Pi Agents control", description: "Controla un trabajo durable con autorización del actor.", parameters: Type.Object({ id: textType(), action: textType(), request_id: textType(), reason: textType() }), async execute(toolCallId: string, params: any, _signal: AbortSignal, _onUpdate: unknown, ctx: ExtensionContext) {
    if (!params.request_id) return { content: [{ type: "text", text: "control requiere request_id." }], isError: true };
    const current = await ensure(ctx); const status = await current.runtime.jobs.status(params.id);
    if (!status.success) return toolReply(status, value => value);
    let activeCancellationConfirmed = params.action !== "cancel";
    if (params.action === "cancel") {
      if (!canConfirmMigration(ctx)) return { content: [{ type: "text", text: "La cancelación requiere la TUI con UI activa." }], isError: true };
      if (!await ctx.ui.confirm("Cancelar trabajo", `¿Cancelar ${params.id}?`)) return { content: [{ type: "text", text: "Cancelación no autorizada." }], isError: true };
      activeCancellationConfirmed = true;
    }
    const request = { requestId: params.request_id, action: params.action, actor: { kind: "model", id: toolCallId }, ...(params.reason === undefined ? {} : { reason: params.reason }) } as any;
    const admission = { requireActiveConfirmation: true, activeCancellationConfirmed };
    const outcome = params.action === "retry" ? await current.runtime.jobs.retry(params.id, request) : await current.runtime.jobs.control(params.id, request, admission);
    return toolReply(outcome, formatControl);
  } } as any));
  pi.registerCommand("subagents", { description: "Inicia o consulta un subagente durable", handler: async (args, ctx) => {
    try {
      const command = parsePiAgentsCommand(args); const current = await ensure(ctx); const requestId = `command:${ctx.sessionManager.getSessionId()}:${Date.now()}`;
      if (command.action === "start") { const outcome = await start(ctx, command.agent, command.task, requestId, { kind: "human" }); if (!outcome.success) throw new Error(outcome.error.message); pi.appendEntry(OUTPUT, { title: `Subagente encolado · ${outcome.value.jobId}`, text: `${outcome.value.agent}`, level: "info", jobId: outcome.value.jobId }); return; }
      if (command.action === "status" || command.action === "result") { const view = command.action === "status" ? await current.runtime.jobs.status(command.id) : await current.runtime.jobs.getResult(command.id, { mode: "human", operation: "peek", actor: { kind: "human", id: "tui" } }); if (!view.success) throw new Error(view.error.message); pi.appendEntry(OUTPUT, { title: `${command.action === "status" ? "Estado" : "Resultado"} · ${command.id}`, text: command.action === "status" ? formatStatus(view.value) : formatResult(view.value), level: "info", jobId: command.id }); return; }
      if (command.action === "list") { const page = await current.runtime.jobs.listJobs({ statuses: command.statuses as any, limit: command.limit, cursor: command.cursor, pendingReview: command.pendingReview }); if (!page.success) throw new Error(page.error.message); pi.appendEntry(OUTPUT, { title: "Trabajos", text: formatList(page.value), level: "info" }); return; }
      if (command.action === "wait") { const waited = await current.runtime.jobs.waitForJob(command.id, { until: command.until as any, timeoutSeconds: command.timeoutSeconds }); if (!waited.success) throw new Error(waited.error.message); pi.appendEntry(OUTPUT, { title: `Espera · ${command.id}`, text: formatWait(waited.value), level: "info", jobId: command.id }); return; }
      if (["cancel", "pause", "resume", "retry"].includes(command.action)) {
        const status = await current.runtime.jobs.status(command.id); if (!status.success) throw new Error(status.error.message);
        let activeCancellationConfirmed = command.action !== "cancel";
        if (command.action === "cancel") {
          if (!canConfirmMigration(ctx)) throw new Error("La cancelación requiere la TUI con UI activa.");
          if (!command.yes && !await ctx.ui.confirm("Cancelar trabajo", `¿Cancelar ${command.id}?`)) throw new Error("Cancelación no autorizada.");
          activeCancellationConfirmed = true;
        }
        const request = { requestId, action: command.action, actor: { kind: "human", id: "tui" }, ...(command.reason === undefined ? {} : { reason: command.reason }) } as any;
        const admission = { requireActiveConfirmation: true, activeCancellationConfirmed };
        const outcome = command.action === "retry" ? await current.runtime.jobs.retry(command.id, request) : await current.runtime.jobs.control(command.id, request, admission);
        if (!outcome.success) throw new Error(outcome.error.message); pi.appendEntry(OUTPUT, { title: `Control · ${command.id}`, text: formatControl(outcome.value), level: "info", jobId: command.id }); return;
      }
      if (!canConfirmMigration(ctx)) throw new Error("La revisión requiere la TUI con UI activa.");
      const review = await current.runtime.jobs.decideReview(command.id, { requestId, status: command.action === "approve" ? "approved" : "rejected", actor: { kind: "human", id: "tui" }, ...(command.reason === undefined ? {} : { reason: command.reason }) });
      if (!review.success) throw new Error(review.error.message); pi.appendEntry(OUTPUT, { title: "Revisión", text: formatReview(review.value), level: "info", jobId: command.id });
    } catch (error) { const message = error instanceof CommandSyntaxError || error instanceof Error ? error.message : String(error); ctx.ui.notify(message, "error"); report(message); }
  } });
}
