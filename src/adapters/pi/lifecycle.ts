import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { DomainError } from "../../domain/errors.ts";
import { createMaintenanceService } from "../../application/maintenance.ts";
import { openSessionRuntime, type RuntimeOptions, type SessionRuntime } from "../../runtime/session.ts";
import { createGeneration, type GenerationScope } from "../../runtime/generation.ts";
import type { PiBindings } from "./resolve.ts";

export type PiSessionState = { sessionId: string; runtime: SessionRuntime; models: ModelRuntime; context: ExtensionContext; generation: GenerationScope };
export type LifecycleBindings = PiBindings & { openRuntime?: typeof openSessionRuntime };

export function createPiLifecycle(pi: ExtensionAPI, bindings: LifecycleBindings, hooks: { onOpen(state: PiSessionState): Promise<() => Promise<void>> }): { ensure(ctx: ExtensionContext): Promise<PiSessionState>; close(): Promise<void> } {
  let generation: GenerationScope | undefined;
  let opening: Promise<PiSessionState | undefined> | undefined;
  let state: PiSessionState | undefined;
  let cleanup: (() => Promise<void>) | undefined;
  let shuttingDown = false;

  const report = (error: unknown) => {
    try { pi.appendEntry("pi-agents-output", { title: "subagents", text: error instanceof Error ? error.message : String(error), level: "error" }); } catch {}
  };
  const closeResources = async (runtime: SessionRuntime, currentGeneration: GenerationScope, dispose?: () => Promise<void>) => {
    try { await dispose?.(); } catch (error) { report(error); }
    try { await runtime.close(); } catch (error) { report(error); }
    currentGeneration.close();
  };
  const invalidate = (): Promise<void> => {
    const previousGeneration = generation;
    const previousState = state;
    const previousCleanup = cleanup;
    generation = undefined; state = undefined; cleanup = undefined;
    previousGeneration?.seal();
    previousState?.runtime.seal();
    if (!previousState) return Promise.resolve();
    return closeResources(previousState.runtime, previousState.generation, previousCleanup);
  };
  const current = (candidate: GenerationScope, ctx: ExtensionContext) => generation === candidate && !candidate.signal.aborted && !shuttingDown && ctx.sessionManager.getSessionId() === candidate.sessionId;

  const beginOpen = (ctx: ExtensionContext): Promise<PiSessionState | undefined> => {
    shuttingDown = false;
    const previousOpening = opening;
    const priorClose = invalidate();
    const id = ctx.sessionManager.getSessionId();
    const next = createGeneration(id);
    generation = next;
    const openRuntime = bindings.openRuntime ?? openSessionRuntime;
    const run = async (): Promise<PiSessionState | undefined> => {
      let runtime: SessionRuntime | undefined;
      try {
        await priorClose;
        await previousOpening?.catch(() => undefined);
        if (!current(next, ctx)) return undefined;
        const models = await bindings.createModels({ authPath: path.join(bindings.getAgentDir(), "auth.json"), modelsPath: path.join(bindings.getAgentDir(), "models.json"), refreshOnCreate: false });
        if (!current(next, ctx)) return undefined;
        for (const providerId of new Set(ctx.modelRegistry.getAll().map(model => model.provider))) { const provider = ctx.modelRegistry.getProvider(providerId); if (provider) models.registerNativeProvider(provider); }
        const database = path.join(process.env.PI_AGENTS_STATE_DIR?.trim() || path.join(bindings.getAgentDir(), "pi-agents", "sessions"), `${id.replace(/[^a-zA-Z0-9._-]/g, "_")}.sqlite`);
        const options: RuntimeOptions = {
          storagePath: database, models, context: BACKGROUND_CONTEXT, defaultCwd: ctx.cwd, sessionId: id,
          maxConcurrency: Math.max(1, Math.min(16, Number(process.env.PI_AGENTS_CONCURRENCY) || 4)),
          onReport: error => { if (current(next, ctx)) report(error); },
          onSettled: async () => { if (!current(next, ctx)) return; },
        };
        const open = async () => openRuntime(options);
        try { runtime = await open(); }
        catch (error) {
          if (!(error instanceof DomainError) || error.error.code !== "MIGRATION_REQUIRED" || ctx.mode !== "tui" || !ctx.hasUI) throw error;
          const maintenance = createMaintenanceService(BACKGROUND_CONTEXT);
          while (current(next, ctx)) {
            const migration = await maintenance.migrate({ dbPath: database, clock: Date.now, confirm: async info => {
              if (!current(next, ctx)) return undefined;
              const accepted = await ctx.ui.confirm("Migrar almacenamiento de subagents", `Se migrarán ${info.jobs} trabajos y se creará un backup.`);
              if (!accepted || !current(next, ctx)) return undefined;
              return { requestId: `migration:${id}:${Date.now()}`, actor: { kind: "human", id: "tui" }, dbPath: info.dbPath, sourceHash: info.sourceHash, approvedAt: Date.now() };
            } });
            if (!current(next, ctx)) return undefined;
            if (!migration.success) throw new DomainError(migration.error.code);
            if (migration.value.schemaVersion === 5) break;
          }
          if (!current(next, ctx)) return undefined;
          runtime = await openRuntime(options);
        }
        if (!current(next, ctx)) {
          runtime.seal();
          await runtime.close();
          return undefined;
        }
        const opened: PiSessionState = { sessionId: id, runtime, models, context: ctx, generation: next };
        next.activate();
        state = opened;
        const dispose = await hooks.onOpen(opened);
        let disposed = false;
        const once = async () => { if (disposed) return; disposed = true; await dispose(); };
        if (!current(next, ctx)) {
          next.seal(); runtime.seal();
          await closeResources(runtime, next, once);
          return undefined;
        }
        cleanup = once;
        return opened;
      } catch (error) {
        if (generation === next) {
          next.seal();
          if (state?.generation === next) { state = undefined; cleanup = undefined; }
        }
        if (runtime) await closeResources(runtime, next);
        else next.close();
        if (generation === next && !shuttingDown) report(error);
        throw error;
      }
    };
    opening = run();
    return opening;
  };

  const ensure = async (ctx: ExtensionContext): Promise<PiSessionState> => {
    if (shuttingDown) throw new Error("No se pudo iniciar pi-agents.");
    const id = ctx.sessionManager.getSessionId();
    if (!generation) {
      if (opening) throw new Error("No se pudo iniciar pi-agents.");
      await beginOpen(ctx);
    } else if (generation.sessionId !== id) throw new Error("No se pudo iniciar pi-agents.");
    else if (!generation.isActive()) await opening;
    if (!state || state.generation !== generation || !state.generation.isActive()) throw new Error("No se pudo iniciar pi-agents.");
    return state;
  };
  const close = async () => { shuttingDown = true; await invalidate(); };

  pi.on("session_start", async (_event, ctx) => {
    try { await beginOpen(ctx); } catch {}
  });
  pi.on("session_shutdown", async () => { await close(); });
  return { ensure, close };
}
