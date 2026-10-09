export type GenerationScope = {
  sessionId: string;
  signal: AbortSignal;
  phase: "opening" | "active" | "closing" | "closed";
  activate(): void;
  seal(): void;
  close(): void;
  isActive(): boolean;
};

export function createGeneration(sessionId: string): GenerationScope {
  const controller = new AbortController();
  let phase: GenerationScope["phase"] = "opening";
  return {
    sessionId,
    signal: controller.signal,
    get phase() { return phase; },
    activate() {
      if (phase !== "opening") throw new Error("No se puede activar una generación cerrada.");
      phase = "active";
    },
    seal() {
      if (phase === "opening" || phase === "active") {
        phase = "closing";
        controller.abort();
      }
    },
    close() {
      if (phase === "closed") return;
      this.seal();
      phase = "closed";
    },
    isActive() { return phase === "active" && !controller.signal.aborted; },
  };
}
