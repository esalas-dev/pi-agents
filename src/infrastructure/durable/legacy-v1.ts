import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import * as path from "node:path";
import type { Context } from "@earendil-works/chord";
import type { Models, ModelThinkingLevel } from "@earendil-works/pi-ai";
import {
  AssistantEntry,
  configure,
  createRegistry,
  defineDoc,
  Harness,
  type ConversationId,
  type SubmissionId,
  type ToolRegistration,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";

export type JobStatus = "queued" | "provisioning" | "running" | "completed" | "failed" | "interrupted";

export type JobAgentSnapshot = {
  name: string;
  description: string;
  systemPrompt: string;
  source: "personal" | "project";
  filePath: string;
  tools: string[];
};

export type JobModel = {
  provider: string;
  modelId: string;
};

export type JobResult = {
  finalResponse: string;
  durationMs: number;
  model: JobModel;
  status: "completed" | "failed" | "interrupted";
  error?: string;
};

export type JobRecord = {
  id: string;
  status: JobStatus;
  task: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
  agent: JobAgentSnapshot;
  model: JobModel;
  thinkingLevel: ModelThinkingLevel;
  conversationId?: number;
  submissionId?: number;
  result?: JobResult;
  notified: boolean;
};

export type JobsState = {
  jobs: Record<string, JobRecord>;
  queue: string[];
};

export const JobsDoc = defineDoc<JobsState>({
  kind: "pi-agents.jobs",
  version: 1,
  scope: "session",
  initial: () => ({ jobs: {}, queue: [] }),
  checkpointWhen: (_value, _ops, info) => info.deltasSinceBase >= 31,
});

export type StartJobInput = {
  task: string;
  cwd: string;
  agent: JobAgentSnapshot;
  model: JobModel;
  thinkingLevel: ModelThinkingLevel;
};

export interface LegacyJobManagerOptions {
  storagePath: string;
  models: Models;
  context: Context;
  defaultCwd: string;
  maxConcurrency: number;
  now?: () => number;
  createId?: () => string;
  onSettled?: (job: JobRecord) => void | Promise<void>;
  onReport?: (error: unknown) => void;
}

const TERMINAL = new Set<JobStatus>(["completed", "failed", "interrupted"]);

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function textFromAssistant(entry: unknown): { text: string; model?: JobModel } {
  if (!entry || typeof entry !== "object") return { text: "" };
  const first = (entry as { model?: unknown[] }).model?.[0] as {
    role?: string;
    provider?: string;
    model?: string;
    content?: unknown[];
  } | undefined;
  if (first?.role !== "assistant") return { text: "" };
  const text = (first.content ?? [])
    .flatMap((part) => part && typeof part === "object" && (part as { type?: string }).type === "text"
      ? [String((part as { text?: unknown }).text ?? "")]
      : [])
    .join("");
  return {
    text,
    ...(first.provider && first.model ? { model: { provider: first.provider, modelId: first.model } } : {}),
  };
}

export class LegacyJobManager {
  readonly maxConcurrency: number;
  readonly storagePath: string;

  private readonly harness: Awaited<ReturnType<typeof Harness.open>>;
  private readonly context: Context;
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly onSettled?: LegacyJobManagerOptions["onSettled"];
  private readonly onReport: (error: unknown) => void;
  private readonly toolsByName: Map<string, ToolRegistration>;
  private readonly monitors = new Map<string, Promise<void>>();
  private pumpTail: Promise<void> = Promise.resolve();
  private closing = false;

  private constructor(
    options: LegacyJobManagerOptions,
    harness: Awaited<ReturnType<typeof Harness.open>>,
    toolsByName: Map<string, ToolRegistration>,
  ) {
    this.storagePath = options.storagePath;
    this.maxConcurrency = options.maxConcurrency;
    this.harness = harness;
    this.context = options.context;
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? (() => `psa_${randomUUID().replaceAll("-", "").slice(0, 12)}`);
    this.onSettled = options.onSettled;
    this.onReport = options.onReport ?? (() => {});
    this.toolsByName = toolsByName;
  }

  static async open(options: LegacyJobManagerOptions): Promise<LegacyJobManager> {
    await mkdir(path.dirname(options.storagePath), { recursive: true, mode: 0o700 });
    const registry = createRegistry();
    registry.install(CodingTools);
    const toolsByName = new Map((CodingTools.tools ?? []).map((tool) => [tool.name, tool as ToolRegistration]));
    const harness = await Harness.open(
      await openNodeSqliteStorage(options.storagePath),
      {
        models: options.models,
        registry,
        settings: { extensions: [CodingTools] },
        env: ({ cwd }) => new NodeExecutionEnv({ cwd: cwd ?? options.defaultCwd }),
        onReport: options.onReport,
      },
      options.context,
    );
    await harness.commit(async (tx) => { await tx.doc(JobsDoc); }, options.context);
    const manager = new LegacyJobManager(options, harness, toolsByName);
    await manager.recover();
    return manager;
  }

  supportedToolNames(): string[] {
    return [...this.toolsByName.keys()];
  }

  async start(input: StartJobInput): Promise<JobRecord> {
    this.assertOpen();
    const id = this.createId();
    const timestamp = this.now();
    const record: JobRecord = {
      id,
      status: "queued",
      task: input.task,
      cwd: input.cwd,
      createdAt: timestamp,
      updatedAt: timestamp,
      agent: input.agent,
      model: input.model,
      thinkingLevel: input.thinkingLevel,
      notified: false,
    };
    await this.harness.commit(async (tx) => {
      const state = await tx.doc(JobsDoc);
      state.jobs[id] = record;
      state.queue.push(id);
    }, this.context);
    void this.pump();
    return record;
  }

  async get(id: string): Promise<JobRecord | undefined> {
    const state = await this.harness.snapshot(JobsDoc, this.context);
    const job = state?.jobs[id];
    return job === undefined ? undefined : structuredClone(job);
  }

  async queuedPosition(id: string): Promise<number | undefined> {
    const state = await this.harness.snapshot(JobsDoc, this.context);
    const index = state?.queue.indexOf(id) ?? -1;
    return index < 0 ? undefined : index + 1;
  }

  async unnotifiedTerminalJobs(): Promise<JobRecord[]> {
    const state = await this.harness.snapshot(JobsDoc, this.context);
    if (!state) return [];
    return Object.values(state.jobs)
      .filter((job) => TERMINAL.has(job.status) && !job.notified)
      .map((job) => structuredClone(job));
  }

  async markNotified(id: string): Promise<void> {
    if (this.closing) return;
    await this.harness.commit(async (tx) => {
      const state = await tx.doc(JobsDoc);
      const job = state.jobs[id];
      if (job) {
        job.notified = true;
        job.updatedAt = this.now();
      }
    }, this.context);
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    await this.harness.close(this.context);
    await Promise.allSettled(this.monitors.values());
    this.monitors.clear();
  }

  private assertOpen(): void {
    if (this.closing) throw new Error("El administrador de subagentes se está cerrando.");
  }

  private async recover(): Promise<void> {
    const state = await this.harness.snapshot(JobsDoc, this.context);
    if (!state) return;
    for (const job of Object.values(state.jobs)) {
      if (job.status === "provisioning") void this.continueProvision(job.id);
      else if (job.status === "running") this.monitor(job.id);
    }
    void this.pump();
  }

  private pump(): Promise<void> {
    this.pumpTail = this.pumpTail
      .then(() => this.pumpAvailable())
      .catch((error) => this.onReport(error));
    return this.pumpTail;
  }

  private async pumpAvailable(): Promise<void> {
    while (!this.closing) {
      const state = await this.harness.snapshot(JobsDoc, this.context);
      if (!state) return;
      const active = Object.values(state.jobs)
        .filter((job) => job.status === "provisioning" || job.status === "running").length;
      if (active >= this.maxConcurrency) return;
      const id = state.queue.find((candidate) => state.jobs[candidate]?.status === "queued");
      if (!id) return;
      try {
        await this.provision(id);
      } catch (error) {
        if (this.closing) return;
        await this.fail(id, error);
      }
    }
  }

  private async provision(id: string): Promise<void> {
    const conversationId = await this.harness.commit(async (tx) => {
      const state = await tx.doc(JobsDoc);
      const job = state.jobs[id];
      if (!job || job.status !== "queued") return undefined;
      const conversation = await tx.createConversation({ ownership: { kind: "ownerless" } });
      const tools = job.agent.tools.map((name) => this.toolsByName.get(name)).filter(Boolean) as ToolRegistration[];
      await configure(tx, conversation.id, {
        model: job.model,
        thinkingLevel: job.thinkingLevel,
        extensions: [CodingTools],
        tools,
        instructions: job.agent.systemPrompt,
        cwd: job.cwd,
      });
      job.status = "provisioning";
      job.conversationId = conversation.id;
      job.updatedAt = this.now();
      state.queue = state.queue.filter((queued) => queued !== id);
      return conversation.id;
    }, this.context);
    if (conversationId !== undefined) await this.continueProvision(id);
  }

  private async continueProvision(id: string): Promise<void> {
    if (this.closing) return;
    try {
      const job = await this.get(id);
      if (!job || job.status !== "provisioning" || job.conversationId === undefined) return;
      const conversation = await this.harness.conversation(job.conversationId as ConversationId, this.context);
      if (!conversation) throw new Error("La conversación durable del trabajo no existe.");
      const submission = await conversation.submit({
        type: "input",
        content: job.task,
        requestId: `pi-agents:${job.id}`,
      }, this.context);
      await this.harness.commit(async (tx) => {
        const state = await tx.doc(JobsDoc);
        const current = state.jobs[id];
        if (!current || current.status !== "provisioning") return;
        current.status = "running";
        current.submissionId = submission.id;
        current.startedAt = current.startedAt ?? this.now();
        current.updatedAt = this.now();
      }, this.context);
      this.monitor(id);
    } catch (error) {
      if (!this.closing) await this.fail(id, error);
    }
  }

  private monitor(id: string): void {
    if (this.monitors.has(id) || this.closing) return;
    const promise = this.monitorSubmission(id)
      .catch(async (error) => {
        if (!this.closing) await this.fail(id, error);
      })
      .finally(() => {
        this.monitors.delete(id);
        if (!this.closing) void this.pump();
      });
    this.monitors.set(id, promise);
  }

  private async monitorSubmission(id: string): Promise<void> {
    const job = await this.get(id);
    if (!job || job.status !== "running" || job.submissionId === undefined || job.conversationId === undefined) {
      if (job?.status === "running") throw new Error("El trabajo running no tiene identificadores durables completos.");
      return;
    }
    const submission = await this.harness.submission(job.submissionId as SubmissionId, this.context);
    if (!submission) throw new Error("La solicitud durable del trabajo no existe.");
    const settled = await submission.wait(this.context);
    if (this.closing) return;

    const finishedAt = this.now();
    let result: JobResult;
    if (settled.status === "done" && settled.type === "input") {
      const conversation = await this.harness.conversation(job.conversationId as ConversationId, this.context);
      if (!conversation) throw new Error("La conversación durable finalizada no existe.");
      const answer = await conversation.commit((tx) => tx.entry(AssistantEntry, settled.answer), this.context);
      const extracted = textFromAssistant(answer);
      result = {
        finalResponse: extracted.text,
        durationMs: Math.max(0, finishedAt - (job.startedAt ?? job.createdAt)),
        model: extracted.model ?? job.model,
        status: "completed",
      };
    } else {
      const detail = "detail" in settled && settled.detail !== undefined
        ? `: ${typeof settled.detail === "string" ? settled.detail : JSON.stringify(settled.detail)}`
        : "";
      result = {
        finalResponse: "",
        durationMs: Math.max(0, finishedAt - (job.startedAt ?? job.createdAt)),
        model: job.model,
        status: "failed",
        error: `${"reason" in settled ? settled.reason : "unanswered"}${detail}`,
      };
    }

    const changed = await this.harness.commit(async (tx) => {
      const state = await tx.doc(JobsDoc);
      const current = state.jobs[id];
      if (!current || TERMINAL.has(current.status)) return false;
      current.status = result.status;
      current.result = result;
      current.finishedAt = finishedAt;
      current.updatedAt = finishedAt;
      return true;
    }, this.context);
    const terminal = changed ? await this.get(id) : undefined;
    if (terminal && this.onSettled) await this.onSettled(terminal);
  }

  private async fail(id: string, error: unknown): Promise<void> {
    if (this.closing) return;
    const finishedAt = this.now();
    const changed = await this.harness.commit(async (tx) => {
      const state = await tx.doc(JobsDoc);
      const job = state.jobs[id];
      if (!job || TERMINAL.has(job.status)) return false;
      const result: JobResult = {
        finalResponse: "",
        durationMs: Math.max(0, finishedAt - (job.startedAt ?? job.createdAt)),
        model: job.model,
        status: "failed",
        error: errorText(error),
      };
      job.status = "failed";
      job.result = result;
      job.finishedAt = finishedAt;
      job.updatedAt = finishedAt;
      state.queue = state.queue.filter((queued) => queued !== id);
      return true;
    }, this.context);
    const terminal = changed ? await this.get(id) : undefined;
    if (terminal && this.onSettled) await this.onSettled(terminal);
  }
}

export function briefSummary(job: JobRecord, maxLength = 180): string {
  const source = job.result?.finalResponse || job.result?.error || job.status;
  const oneLine = source.replace(/\s+/g, " ").trim();
  return oneLine.length <= maxLength ? oneLine : `${oneLine.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function publicStatus(job: JobRecord): "queued" | "running" | "completed" | "failed" | "interrupted" {
  return job.status === "provisioning" ? "running" : job.status;
}

export type JobsStateV1 = JobsState;
export const LegacyJobsDoc = JobsDoc;
