import { ModelRuntime, resolveCliModel, getAgentDir, VERSION, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { registerPiAgents } from "./src/adapters/pi/register.ts";

export default function piAgentsExtension(pi: ExtensionAPI): void {
  registerPiAgents(pi, {
    getAgentDir,
    createModels: options => ModelRuntime.create(options as Parameters<typeof ModelRuntime.create>[0]),
    resolveModel: resolveCliModel,
    text: content => new Text(content, 0, 0),
    Type,
    version: VERSION,
  });
}
