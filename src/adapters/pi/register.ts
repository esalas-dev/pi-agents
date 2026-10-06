import * as path from "node:path";
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
import { formatResult, formatStatus, briefSummary } from "./display.ts";
import { discoverAgents } from "../../agents.ts";

const NOTICE = "pi-agents-notice"; const OUTPUT = "pi-agents-output"; const MAX_CONCURRENCY = 16;
const fileName = (id: string) => id.replace(/[^a-zA-Z0-9._-]/g, "_");
const statePath = (id: string, dir: string) => path.join(process.env.PI_AGENTS_STATE_DIR?.trim() || path.join(dir, "pi-agents", "sessions"), `${fileName(id)}.sqlite`);
const display = (value: unknown): value is { title: string; text: string; level: "info" | "success" | "error"; jobId?: string } => Boolean(value && typeof value === "object" && typeof (value as any).title === "string" && typeof (value as any).text === "string");

export function canConfirmMigration(ctx: Pick<ExtensionContext, "mode" | "hasUI">): boolean { return ctx.mode === "tui" && ctx.hasUI; }

export function registerPiAgents(pi: ExtensionAPI, bindings: PiBindings): void {
  type State = { sessionId: string; runtime: SessionRuntime; models: ModelRuntime; context: ExtensionContext };
  let state: State | undefined; let lifecycle = Promise.resolve(); let agents: ReturnType<typeof discoverAgents>["agents"] = [];
  const report = (error: unknown) => { try { pi.appendEntry(OUTPUT, { title: "pi-agents", text: error instanceof Error ? error.message : String(error), level: "error" }); } catch {} };
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
    const runtimeOptions = { storagePath: database, models, context: BACKGROUND_CONTEXT, defaultCwd: ctx.cwd, maxConcurrency: Math.max(1, Math.min(MAX_CONCURRENCY, Number(process.env.PI_AGENTS_CONCURRENCY) || 4)), onReport: report, onSettled: async (job: JobRecord, result: JobResult) => { const current = state; if (current?.sessionId === id) await notify(job, result, current); } };
    let runtime: SessionRuntime;
    try { runtime = await openSessionRuntime(runtimeOptions); }
    catch (error) {
      if (!(error instanceof DomainError) || error.error.code !== "MIGRATION_REQUIRED" || !canConfirmMigration(ctx)) throw error;
      const migration = await createMaintenanceService(BACKGROUND_CONTEXT).migrate({ dbPath: database, clock: Date.now, confirm: async info => {
        if (ctx.sessionManager.getSessionId() !== id) return undefined;
        const accepted = await ctx.ui.confirm("Migrar almacenamiento de pi-agents", `Se migrarán ${info.jobs} trabajos y se creará un backup.`);
        if (!accepted || ctx.sessionManager.getSessionId() !== id) return undefined;
        return { requestId: `migration:${id}:${Date.now()}`, actor: { kind: "human", id: "tui" }, dbPath: info.dbPath, sourceHash: info.sourceHash, approvedAt: Date.now() };
      } });
      if (!migration.success) throw new DomainError(migration.error.code);
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
  pi.registerTool(({ name: "pi_agents", label: "Pi Agents", description: "Inicia un agente durable en segundo plano.", parameters: (bindings.Type as any).Object({ agent: (bindings.Type as any).String(), task: (bindings.Type as any).String() }), async execute(toolCallId: string, params: { agent: string; task: string }, _signal: AbortSignal, _onUpdate: unknown, ctx: ExtensionContext) { const outcome = await start(ctx, params.agent, params.task, `tool:${toolCallId}`, { kind: "model", id: toolCallId }); if (!outcome.success) return { content: [{ type: "text", text: outcome.error.message }], details: outcome.error, isError: true }; return { content: [{ type: "text", text: `Trabajo ${outcome.value.jobId} encolado para ${outcome.value.agent}.` }], details: outcome.value }; } } as any));
  pi.registerCommand("pi-agents", { description: "Inicia o consulta un subagente durable", handler: async (args, ctx) => { try { const command = parsePiAgentsCommand(args); const current = await ensure(ctx); if (command.action === "start") { const outcome = await start(ctx, command.agent, command.task, `command:${ctx.sessionManager.getSessionId()}:${Date.now()}`, { kind: "human" }); if (!outcome.success) throw new Error(outcome.error.message); pi.appendEntry(OUTPUT, { title: `Subagente encolado · ${outcome.value.jobId}`, text: `${outcome.value.agent}`, level: "info", jobId: outcome.value.jobId }); return; } const view = command.action === "status" ? await current.runtime.jobs.status(command.id) : await current.runtime.jobs.result(command.id); if (!view.success) throw new Error(view.error.message); pi.appendEntry(OUTPUT, { title: `${command.action === "status" ? "Estado" : "Resultado"} · ${command.id}`, text: command.action === "status" ? formatStatus(view.value) : formatResult(view.value), level: "info", jobId: command.id }); } catch (error) { const message = error instanceof CommandSyntaxError || error instanceof Error ? error.message : String(error); ctx.ui.notify(message, "error"); report(message); } } });
}
