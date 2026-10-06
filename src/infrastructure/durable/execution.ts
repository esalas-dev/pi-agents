import type { Context } from "@earendil-works/chord";
import { AssistantEntry, configure, type ConversationId, type Harness, type SubmissionId, type ToolRegistration, type Tx } from "@earendil-works/pi-durable";
import type { Clock } from "../../domain/requests.ts";
import type { JobModel, JobRecord, JobResult } from "../../domain/jobs.ts";

export type DurableExecution = { create(tx: Tx, job: JobRecord): Promise<number>; submit(job: JobRecord): Promise<number>; wait(job: JobRecord): Promise<JobResult> };
function assistantText(entry: unknown): { text: string; model?: JobModel } {
  const first = (entry as { model?: Array<{ role?: string; provider?: string; model?: string; content?: Array<{ type?: string; text?: string }> }> } | undefined)?.model?.[0];
  if (first?.role !== "assistant") return { text: "" };
  return { text: (first.content ?? []).filter(part => part.type === "text").map(part => part.text ?? "").join(""), ...(first.provider && first.model ? { model: { provider: first.provider, modelId: first.model } } : {}) };
}
export function createExecution(harness: Harness, context: Context, tools: ReadonlyMap<string, ToolRegistration>, clock: Clock): DurableExecution {
  return {
    async create(tx, job) {
      const conversation = await tx.createConversation({ ownership: { kind: "ownerless" } });
      const selected = job.agent.tools.map(name => tools.get(name)).filter((tool): tool is ToolRegistration => Boolean(tool));
      await configure(tx, conversation.id, { model: job.model, thinkingLevel: job.thinkingLevel, extensions: [], tools: selected, instructions: job.agent.systemPrompt, cwd: job.cwd });
      return conversation.id;
    },
    async submit(job) {
      if (job.conversationId === undefined) throw new Error("La conversación durable no existe.");
      const conversation = await harness.conversation(job.conversationId as ConversationId, context);
      if (!conversation) throw new Error("La conversación durable no existe.");
      const submission = await conversation.submit({ type: "input", content: job.task, requestId: `pi-agents:${job.id}` }, context);
      return submission.id;
    },
    async wait(job) {
      if (job.submissionId === undefined || job.conversationId === undefined) throw new Error("La ejecución durable carece de identificadores.");
      const submission = await harness.submission(job.submissionId as SubmissionId, context);
      if (!submission) throw new Error("La solicitud durable no existe.");
      const settled = await submission.wait(context); const finishedAt = clock();
      if (settled.status === "done" && settled.type === "input") {
        const conversation = await harness.conversation(job.conversationId as ConversationId, context); if (!conversation) throw new Error("La conversación durable no existe.");
        const entry = await conversation.commit(tx => tx.entry(AssistantEntry, settled.answer), context); const extracted = assistantText(entry);
        return { finalResponse: extracted.text, durationMs: Math.max(0, finishedAt - (job.startedAt ?? job.createdAt)), model: extracted.model ?? job.model, status: "completed" };
      }
      const detail = "detail" in settled && settled.detail !== undefined ? `: ${typeof settled.detail === "string" ? settled.detail : JSON.stringify(settled.detail)}` : "";
      return { finalResponse: "", durationMs: Math.max(0, finishedAt - (job.startedAt ?? job.createdAt)), model: job.model, status: "failed", error: `${"reason" in settled ? settled.reason : "unanswered"}${detail}` };
    },
  };
}
