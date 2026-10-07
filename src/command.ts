export type PiAgentsCommand =
  | { action: "start"; agent: string; task: string }
  | { action: "status"; id: string }
  | { action: "result"; id: string }
  | { action: "list"; statuses?: string[]; limit?: number; cursor?: string; pendingReview?: boolean }
  | { action: "wait"; id: string; until?: string; timeoutSeconds?: number }
  | { action: "approve" | "reject"; id: string; reason?: string };

export class CommandSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandSyntaxError";
  }
}

export function tokenizeCommandLine(input: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let quote: "'" | '"' | undefined;
  let escaping = false;
  let started = false;

  for (const character of input.trim()) {
    if (escaping) {
      token += character;
      escaping = false;
      started = true;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaping = true;
      started = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = undefined;
      else token += character;
      started = true;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      started = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (started) {
        tokens.push(token);
        token = "";
        started = false;
      }
      continue;
    }
    token += character;
    started = true;
  }

  if (escaping) token += "\\";
  if (quote) throw new CommandSyntaxError("La tarea contiene una comilla sin cerrar.");
  if (started) tokens.push(token);
  return tokens;
}

const statuses = new Set(["queued", "running", "completed", "failed", "interrupted"]);
const numberOption = (value: string, min: number, max: number, name: string): number => {
  if (!/^\d+(?:\.\d+)?$/.test(value)) throw new CommandSyntaxError(`Valor inválido para ${name}.`);
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new CommandSyntaxError(`Valor inválido para ${name}.`);
  return number;
};

export function parsePiAgentsCommand(input: string): PiAgentsCommand {
  const tokens = tokenizeCommandLine(input);
  if (tokens.length === 0) throw new CommandSyntaxError('Uso: /pi-agents <agente> "<tarea>" | status <id> | result <id>');
  const action = tokens[0];
  if (action === "status" || action === "result") {
    if (tokens.length !== 2 || !tokens[1]) throw new CommandSyntaxError(`Uso: /pi-agents ${action} <id>`);
    return { action, id: tokens[1] };
  }
  if (action === "list") {
    const parsed: Extract<PiAgentsCommand, { action: "list" }> = { action };
    const seenStatuses = new Set<string>();
    for (let index = 1; index < tokens.length; index++) {
      const option = tokens[index];
      if (option === "--status") {
        const status = tokens[++index];
        if (!status || !statuses.has(status) || seenStatuses.has(status)) throw new CommandSyntaxError("Estado inválido o repetido.");
        seenStatuses.add(status); (parsed.statuses ??= []).push(status);
      } else if (option === "--limit") parsed.limit = numberOption(tokens[++index] ?? "", 1, 100, "--limit");
      else if (option === "--cursor") { const cursor = tokens[++index]; if (!cursor) throw new CommandSyntaxError("Cursor inválido."); parsed.cursor = cursor; }
      else if (option === "--pending-review") { if (parsed.pendingReview) throw new CommandSyntaxError("Opción repetida."); parsed.pendingReview = true; }
      else throw new CommandSyntaxError(`Opción desconocida: ${option}`);
    }
    return parsed;
  }
  if (action === "wait") {
    if (!tokens[1]) throw new CommandSyntaxError("Uso: /pi-agents wait <id>");
    const parsed: Extract<PiAgentsCommand, { action: "wait" }> = { action, id: tokens[1] };
    for (let index = 2; index < tokens.length; index++) {
      const option = tokens[index];
      if (option === "--until") { const until = tokens[++index]; if (!until || (until !== "terminal" && !statuses.has(until))) throw new CommandSyntaxError("Estado de espera inválido."); parsed.until = until; }
      else if (option === "--timeout") parsed.timeoutSeconds = numberOption(tokens[++index] ?? "", 0, 300, "--timeout");
      else throw new CommandSyntaxError(`Opción desconocida: ${option}`);
    }
    return parsed;
  }
  if (action === "approve" || action === "reject") {
    if (!tokens[1]) throw new CommandSyntaxError(`Uso: /pi-agents ${action} <id>`);
    const parsed: Extract<PiAgentsCommand, { action: "approve" | "reject" }> = { action, id: tokens[1] };
    for (let index = 2; index < tokens.length; index++) {
      if (tokens[index] !== "--reason" || parsed.reason !== undefined) throw new CommandSyntaxError("Uso: --reason <texto>");
      const reason = tokens[++index]; if (!reason) throw new CommandSyntaxError("La razón no puede estar vacía."); parsed.reason = reason;
    }
    return parsed;
  }
  if (tokens.length < 2) throw new CommandSyntaxError('Uso: /pi-agents <agente> "<tarea>"');
  return { action: "start", agent: action, task: tokens.slice(1).join(" ") };
}
