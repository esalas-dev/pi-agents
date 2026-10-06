import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverAgents, unsupportedTools } from '../src/agents.ts';

async function agentFile(root, relative, content) {
  const file = join(root, relative);
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, content);
}

const markdown = ({ name, description = 'desc', tools = 'read, bash', model, body = 'Prompt' }) => `---\nname: ${name}\ndescription: ${description}\ntools: ${tools}\n${model ? `model: ${model}\n` : ''}---\n${body}\n`;

test('descubre agentes personales y el proyecto confiado los reemplaza por nombre', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-agents-agents-'));
  const agentDir = join(root, 'agent-home');
  const project = join(root, 'repo', 'nested');
  try {
    await agentFile(agentDir, 'agents/shared.md', markdown({ name: 'shared', body: 'personal' }));
    await agentFile(agentDir, 'agents/personal.md', markdown({ name: 'personal' }));
    await agentFile(join(root, 'repo'), '.pi/agents/shared.md', markdown({ name: 'shared', tools: '[read, edit]', body: 'project' }));

    const discovery = discoverAgents({ cwd: project, agentDir, projectTrusted: true });
    assert.deepEqual(discovery.agents.map(agent => agent.name), ['personal', 'shared']);
    const shared = discovery.agents.find(agent => agent.name === 'shared');
    assert.equal(shared.source, 'project');
    assert.equal(shared.systemPrompt, 'project');
    assert.deepEqual(shared.tools, ['read', 'edit']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('omite agentes de proyecto sin confianza nativa', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-agents-trust-'));
  const agentDir = join(root, 'agent-home');
  const project = join(root, 'repo');
  try {
    await agentFile(agentDir, 'agents/shared.md', markdown({ name: 'shared', body: 'personal' }));
    await agentFile(project, '.pi/agents/shared.md', markdown({ name: 'shared', body: 'project' }));
    const discovery = discoverAgents({ cwd: project, agentDir, projectTrusted: false });
    assert.equal(discovery.projectAgentsIgnored, true);
    assert.equal(discovery.agents[0].source, 'personal');
    assert.equal(discovery.agents[0].systemPrompt, 'personal');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('reporta archivos inválidos y herramientas fuera del subconjunto durable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-agents-invalid-'));
  const agentDir = join(root, 'agent-home');
  try {
    await agentFile(agentDir, 'agents/bad.md', '---\nname: bad\n---\nPrompt\n');
    await agentFile(agentDir, 'agents/custom.md', markdown({ name: 'custom', tools: 'read, codemode, mcp__jira' }));
    const discovery = discoverAgents({ cwd: root, agentDir, projectTrusted: true });
    assert.equal(discovery.diagnostics.length, 1);
    assert.deepEqual(unsupportedTools(discovery.agents[0]), ['codemode', 'mcp__jira']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
