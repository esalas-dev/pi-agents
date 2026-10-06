import * as path from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Type, type ModelThinkingLevel } from "@earendil-works/pi-ai";
import {
  getAgentDir,
  ModelRuntime,
  resolveCliModel,
  VERSION,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { discoverAgents, SUPPORTED_TOOLS, unsupportedTools, type AgentDefinition } from "./src/agents.ts";
import { CommandSyntaxError, parsePiAgentsCommand } from "./src/command.ts";
import {
  JobManager,
  briefSummary,
  publicStatus,
  type JobAgentSnapshot,
  type JobRecord,
  type StartJobInput,
} from "./src/jobs.ts";

const NOTICE_ENTRY = "pi-agents-notice";
const OUTPUT_ENTRY = "pi-agents-output";
const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 16;

interface RuntimeState {
  sessionId: string;
  manager: JobManager;
  models: ModelRuntime;
  context: ExtensionContext;
}

interface DisplayEntry {
  title: string;
  text: string;
  level: "info" | "success" | "error";
  jobId?: string;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? Math.min(parsed, MAX_CONCURRENCY) : fallback;
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function storagePath(sessionId: string): string {
  const base = process.env.PI_AGENTS_STATE_DIR?.trim()
    || path.join(getAgentDir(), "pi-agents", "sessions");
  return path.join(base, `${safeFileName(sessionId)}.sqlite`);
}

function isDisplayEntry(value: unknown): value is DisplayEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<DisplayEntry>;
  return typeof entry.title === "string" && typeof entry.text === "string"
    && (entry.level === "info" || entry.level === "success" || entry.level === "error");
}

function duration(ms: number | undefined): string {
  if (ms === undefined) return "—";
  if (ms < 1_000) return `${ms} ms`;
  const seconds = Math.round(ms / 100) / 10;
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${Math.round(seconds % 60)} s`;
}

function statusText(job: JobRecord, queuePosition?: number): string {
  const lines = [
    `ID: ${job.id}`,
    `Estado: ${publicStatus(job)}${queuePosition ? ` (posición ${queuePosition})` : ""}`,
    `Agente: ${job.agent.name} (${job.agent.source})`,
    `Modelo: ${job.result?.model.provider ?? job.model.provider}/${job.result?.model.modelId ?? job.model.modelId}`,
    `Directorio: ${job.cwd}`,
  ];
  if (job.result) lines.push(`Duración: ${duration(job.result.durationMs)}`);
  if (job.result?.error) lines.push(`Error: ${job.result.error}`);
  return lines.join("\n");
}

function resultText(job: JobRecord): string {
  if (!job.result) return `${statusText(job)}\n\nEl resultado todavía no está disponible.`;
  const header = statusText(job);
  const body = job.result.finalResponse || "(sin respuesta final)";
  return `${header}\n\nRespuesta final:\n${body}`;
}

function noticeExists(ctx: ExtensionContext, id: string): boolean {
  return ctx.sessionManager.getBranch().some((entry) => {
    if (entry.type !== "custom" || entry.customType !== NOTICE_ENTRY) return false;
    const data = entry.data as { jobId?: unknown } | undefined;
    return data?.jobId === id;
  });
}

function appendDisplay(pi: ExtensionAPI, type: typeof NOTICE_ENTRY | typeof OUTPUT_ENTRY, data: DisplayEntry): void {
  pi.appendEntry(type, data);
}

async function synchronizeProviders(runtime: ModelRuntime, ctx: ExtensionContext): Promise<void> {
  const providerIds = new Set(ctx.modelRegistry.getAll().map((model) => model.provider));
  for (const providerId of providerIds) {
    const provider = ctx.modelRegistry.getProvider(providerId);
    if (provider) runtime.registerNativeProvider(provider);
  }
}

function selectedAgent(ctx: ExtensionContext, name: string): { agent: AgentDefinition; ignored: boolean } {
  const discovery = discoverAgents({
    cwd: ctx.cwd,
    agentDir: getAgentDir(),
    projectTrusted: ctx.isProjectTrusted(),
  });
  const agent = discovery.agents.find((candidate) => candidate.name === name);
  if (!agent) {
    const available = discovery.agents.map((candidate) => candidate.name).join(", ") || "ninguno";
    const trust = discovery.projectAgentsIgnored
      ? " Los agentes del proyecto están omitidos porque el proyecto no está confiado; usa /trust si corresponde."
      : "";
    throw new Error(`Agente desconocido: ${name}. Disponibles: ${available}.${trust}`);
  }
  return { agent, ignored: discovery.projectAgentsIgnored };
}

async function buildStartInput(
  runtime: RuntimeState,
  ctx: ExtensionContext,
  agentName: string,
  task: string,
): Promise<StartJobInput> {
  if (!task.trim()) throw new Error("La tarea no puede estar vacía.");
  await synchronizeProviders(runtime.models, ctx);
  const { agent } = selectedAgent(ctx, agentName);
  const unsupported = unsupportedTools(agent);
  if (unsupported.length > 0) {
    throw new Error(
      `El agente ${agent.name} solicita herramientas no soportadas: ${unsupported.join(", ")}. `
      + `Esta versión admite únicamente: ${SUPPORTED_TOOLS.join(", ")}.`,
    );
  }

  let model = ctx.model;
  let thinkingLevel = ctx.thinkingLevel as ModelThinkingLevel | undefined;
  if (agent.model) {
    const resolved = resolveCliModel({ cliModel: agent.model, modelRuntime: runtime.models });
    if (!resolved.model) throw new Error(resolved.error ?? `No se pudo resolver el modelo ${agent.model}.`);
    model = resolved.model;
    thinkingLevel = (resolved.thinkingLevel ?? thinkingLevel) as ModelThinkingLevel | undefined;
  } else if (model && !runtime.models.getModel(model.provider, model.id)) {
    throw new Error(
      `El modelo actual ${model.provider}/${model.id} no está disponible en el runtime durable. `
      + "Los modelos virtuales que no exponen su definición no son compatibles.",
    );
  }
  if (!model) throw new Error("No hay un modelo seleccionado para el subagente.");

  const tools = agent.tools ?? [...SUPPORTED_TOOLS];
  const snapshot: JobAgentSnapshot = {
    name: agent.name,
    description: agent.description,
    systemPrompt: agent.systemPrompt,
    source: agent.source,
    filePath: agent.filePath,
    tools,
  };
  return {
    task: task.trim(),
    cwd: ctx.cwd,
    agent: snapshot,
    model: { provider: model.provider, modelId: model.id },
    thinkingLevel: thinkingLevel ?? "off",
  };
}

export default function piAgentsExtension(pi: ExtensionAPI): void {
  let active: RuntimeState | undefined;
  let lifecycle: Promise<void> = Promise.resolve();
  let completionAgents: AgentDefinition[] = [];

  const report = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    try { pi.appendEntry(OUTPUT_ENTRY, { title: "pi-agents", text: message, level: "error" } satisfies DisplayEntry); }
    catch { /* The extension runtime may already be invalidated. */ }
  };

  const notifySettled = async (job: JobRecord, state: RuntimeState): Promise<void> => {
    if (active !== state) return;
    if (noticeExists(state.context, job.id)) {
      await state.manager.markNotified(job.id);
      return;
    }
    const succeeded = job.status === "completed";
    const summary = briefSummary(job);
    appendDisplay(pi, NOTICE_ENTRY, {
      title: `${succeeded ? "Subagente completado" : "Subagente finalizado con error"} · ${job.id}`,
      text: `${job.agent.name}: ${summary}`,
      level: succeeded ? "success" : "error",
      jobId: job.id,
    });
    state.context.ui.notify(
      `${job.id}: ${summary}`,
      succeeded ? "info" : "error",
    );
    await state.manager.markNotified(job.id);
  };

  const openFor = async (ctx: ExtensionContext): Promise<RuntimeState> => {
    const sessionId = ctx.sessionManager.getSessionId();
    if (active?.sessionId === sessionId) return active;
    if (active) {
      await active.manager.close();
      active = undefined;
    }

    const models = await ModelRuntime.create({
      authPath: path.join(getAgentDir(), "auth.json"),
      modelsPath: path.join(getAgentDir(), "models.json"),
      refreshOnCreate: false,
    });
    await synchronizeProviders(models, ctx);
    const manager = await JobManager.open({
      storagePath: storagePath(sessionId),
      models,
      context: BACKGROUND_CONTEXT,
      defaultCwd: ctx.cwd,
      maxConcurrency: positiveInteger(process.env.PI_AGENTS_CONCURRENCY, DEFAULT_CONCURRENCY),
      onReport: report,
      onSettled: async (job) => {
        const current = active;
        if (current?.sessionId === sessionId) await notifySettled(job, current);
      },
    });
    const state: RuntimeState = { sessionId, manager, models, context: ctx };
    active = state;

    const discovery = discoverAgents({ cwd: ctx.cwd, agentDir: getAgentDir(), projectTrusted: ctx.isProjectTrusted() });
    completionAgents = discovery.agents;
    for (const diagnostic of discovery.diagnostics) report(diagnostic);
    for (const job of await manager.unnotifiedTerminalJobs()) await notifySettled(job, state);
    if (VERSION !== "1.0.1") {
      ctx.ui.notify(`pi-agents fue validado con Pi 1.0.1; versión actual: ${VERSION}.`, "warning");
    }
    return state;
  };

  const ensureRuntime = async (ctx: ExtensionContext): Promise<RuntimeState> => {
    const sessionId = ctx.sessionManager.getSessionId();
    if (active?.sessionId === sessionId) return active;
    lifecycle = lifecycle.then(async () => { await openFor(ctx); });
    await lifecycle;
    if (!active || active.sessionId !== sessionId) throw new Error("No se pudo iniciar pi-agents.");
    return active;
  };

  const start = async (ctx: ExtensionContext, agent: string, task: string): Promise<JobRecord> => {
    const runtime = await ensureRuntime(ctx);
    const input = await buildStartInput(runtime, ctx, agent, task);
    return runtime.manager.start(input);
  };

  pi.registerEntryRenderer<DisplayEntry>(NOTICE_ENTRY, (entry, _options, theme) => {
    if (!isDisplayEntry(entry.data)) return undefined;
    const color = entry.data.level === "error" ? "error" : entry.data.level === "success" ? "success" : "accent";
    return new Text(`${theme.fg(color, theme.bold(entry.data.title))}\n${entry.data.text}`, 0, 0);
  });
  pi.registerEntryRenderer<DisplayEntry>(OUTPUT_ENTRY, (entry, _options, theme) => {
    if (!isDisplayEntry(entry.data)) return undefined;
    const color = entry.data.level === "error" ? "error" : entry.data.level === "success" ? "success" : "accent";
    return new Text(`${theme.fg(color, theme.bold(entry.data.title))}\n${entry.data.text}`, 0, 0);
  });

  pi.on("session_start", async (_event, ctx) => {
    lifecycle = lifecycle.then(async () => { await openFor(ctx); });
    await lifecycle;
  });

  pi.on("session_shutdown", async () => {
    lifecycle = lifecycle.then(async () => {
      const state = active;
      active = undefined;
      completionAgents = [];
      if (state) await state.manager.close();
    });
    await lifecycle;
  });

  pi.registerTool({
    name: "pi_agents",
    label: "Pi Agents",
    description:
      "Start exactly one named personal or trusted-project agent as an isolated durable background job. "
      + "Returns immediately with a job ID. The user is notified when it finishes. "
      + "Only read, write, edit, and bash agents are supported.",
    parameters: Type.Object({
      agent: Type.String({ description: "Agent name from the personal or trusted project agents directory" }),
      task: Type.String({ description: "One self-contained task for the agent" }),
    }),
    annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        const job = await start(ctx, params.agent, params.task);
        return {
          content: [{ type: "text", text: `Trabajo ${job.id} encolado para ${job.agent.name}.` }],
          details: { jobId: job.id, status: "queued", agent: job.agent.name },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: message }],
          details: { status: "failed", error: message },
          isError: true,
        };
      }
    },
  });

  pi.registerCommand("pi-agents", {
    description: "Inicia o consulta un subagente durable en segundo plano",
    getArgumentCompletions: (prefix) => {
      if (!prefix.includes(" ")) {
        const values = [
          { value: "status", label: "status", description: "Consultar el estado de un trabajo" },
          { value: "result", label: "result", description: "Mostrar el resultado de un trabajo" },
          ...completionAgents.map((agent) => ({ value: agent.name, label: agent.name, description: agent.description })),
        ];
        return values.filter((item) => item.value.startsWith(prefix));
      }
      return null;
    },
    handler: async (args, ctx) => {
      try {
        const command = parsePiAgentsCommand(args);
        const runtime = await ensureRuntime(ctx);
        if (command.action === "start") {
          const job = await start(ctx, command.agent, command.task);
          appendDisplay(pi, OUTPUT_ENTRY, {
            title: `Subagente encolado · ${job.id}`,
            text: `${job.agent.name}: ${job.task}`,
            level: "info",
            jobId: job.id,
          });
          return;
        }

        const job = await runtime.manager.get(command.id);
        if (!job) throw new Error(`No existe el trabajo ${command.id} en esta sesión.`);
        if (command.action === "status") {
          appendDisplay(pi, OUTPUT_ENTRY, {
            title: `Estado · ${job.id}`,
            text: statusText(job, await runtime.manager.queuedPosition(job.id)),
            level: job.status === "failed" || job.status === "interrupted" ? "error" : "info",
            jobId: job.id,
          });
        } else {
          appendDisplay(pi, OUTPUT_ENTRY, {
            title: `Resultado · ${job.id}`,
            text: resultText(job),
            level: job.status === "completed" ? "success" : job.result ? "error" : "info",
            jobId: job.id,
          });
        }
      } catch (error) {
        const message = error instanceof CommandSyntaxError || error instanceof Error ? error.message : String(error);
        ctx.ui.notify(message, "error");
        appendDisplay(pi, OUTPUT_ENTRY, { title: "pi-agents", text: message, level: "error" });
      }
    },
  });
}
