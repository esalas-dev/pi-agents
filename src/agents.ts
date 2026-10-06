import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";

export const SUPPORTED_TOOLS = ["read", "write", "edit", "bash"] as const;
export type SupportedTool = (typeof SUPPORTED_TOOLS)[number];
export type AgentSource = "personal" | "project";

export interface AgentDefinition {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  systemPrompt: string;
  source: AgentSource;
  filePath: string;
}

export interface AgentDiscovery {
  agents: AgentDefinition[];
  projectAgentsDir?: string;
  projectAgentsIgnored: boolean;
  diagnostics: string[];
}

interface ParsedMarkdown {
  frontmatter: Record<string, unknown>;
  body: string;
}

function parseMarkdown(content: string): ParsedMarkdown {
  const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return { frontmatter: {}, body: normalized };
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) return { frontmatter: {}, body: normalized };
  const raw = normalized.slice(4, end);
  const parsed = parseYaml(raw);
  return {
    frontmatter: parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {},
    body: normalized.slice(end + 5).trim(),
  };
}

function parseTools(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return values
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readAgents(dir: string, source: AgentSource, diagnostics: string[]): AgentDefinition[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      diagnostics.push(`No se pudo leer ${dir}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return [];
  }

  const agents: AgentDefinition[] = [];
  for (const entry of entries) {
    if (!entry.name.endsWith(".md") || (!entry.isFile() && !entry.isSymbolicLink())) continue;
    const filePath = path.join(dir, entry.name);
    try {
      const { frontmatter, body } = parseMarkdown(fs.readFileSync(filePath, "utf8"));
      const name = typeof frontmatter.name === "string" ? frontmatter.name.trim() : "";
      const description = typeof frontmatter.description === "string" ? frontmatter.description.trim() : "";
      if (!name || !description) {
        diagnostics.push(`${filePath}: se requieren name y description en el frontmatter.`);
        continue;
      }
      agents.push({
        name,
        description,
        ...(parseTools(frontmatter.tools) === undefined ? {} : { tools: parseTools(frontmatter.tools) }),
        ...(typeof frontmatter.model === "string" && frontmatter.model.trim()
          ? { model: frontmatter.model.trim() }
          : {}),
        systemPrompt: body,
        source,
        filePath,
      });
    } catch (error) {
      diagnostics.push(`${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return agents;
}

function nearestProjectAgentsDir(cwd: string): string | undefined {
  let current = path.resolve(cwd);
  while (true) {
    const candidate = path.join(current, ".pi", "agents");
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch {
      // Continue walking to the filesystem root.
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export function discoverAgents(options: {
  cwd: string;
  agentDir: string;
  projectTrusted: boolean;
}): AgentDiscovery {
  const diagnostics: string[] = [];
  const projectAgentsDir = nearestProjectAgentsDir(options.cwd);
  const personal = readAgents(path.join(options.agentDir, "agents"), "personal", diagnostics);
  const project = options.projectTrusted && projectAgentsDir
    ? readAgents(projectAgentsDir, "project", diagnostics)
    : [];

  const byName = new Map<string, AgentDefinition>();
  for (const agent of personal) byName.set(agent.name, agent);
  for (const agent of project) byName.set(agent.name, agent);

  return {
    agents: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    ...(projectAgentsDir ? { projectAgentsDir } : {}),
    projectAgentsIgnored: Boolean(projectAgentsDir && !options.projectTrusted),
    diagnostics,
  };
}

export function unsupportedTools(agent: AgentDefinition): string[] {
  return (agent.tools ?? []).filter((tool) => !SUPPORTED_TOOLS.includes(tool as SupportedTool));
}
