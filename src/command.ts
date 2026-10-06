export type PiAgentsCommand =
  | { action: "start"; agent: string; task: string }
  | { action: "status"; id: string }
  | { action: "result"; id: string };

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

export function parsePiAgentsCommand(input: string): PiAgentsCommand {
  const tokens = tokenizeCommandLine(input);
  if (tokens.length === 0) {
    throw new CommandSyntaxError('Uso: /pi-agents <agente> "<tarea>" | status <id> | result <id>');
  }

  if (tokens[0] === "status" || tokens[0] === "result") {
    if (tokens.length !== 2 || !tokens[1]) {
      throw new CommandSyntaxError(`Uso: /pi-agents ${tokens[0]} <id>`);
    }
    return { action: tokens[0], id: tokens[1] };
  }

  if (tokens.length < 2) {
    throw new CommandSyntaxError('Uso: /pi-agents <agente> "<tarea>"');
  }
  return { action: "start", agent: tokens[0], task: tokens.slice(1).join(" ") };
}
