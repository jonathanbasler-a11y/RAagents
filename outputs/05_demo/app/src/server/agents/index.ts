import 'server-only';

// The agent registry. Specs are data: outputs/04_agents/<id>.md, read at runtime.
// Authoring rules for the spec files: outputs/04_agents/README.md.
//
// - parseAgentSpec: one file → AgentSpec (front matter and sections).
// - validateSpecs: the roster rules that span fields or files.
// - loadRegistry: read, parse and validate a folder; returns the active agents. Not cached.
// - getAgent, listAgents, listPublicAgents, getOrchestrator: one process-wide registry
//   with default options, reloaded when a spec file's mtime or the file list changes.

export { AgentSpecError } from './errors';
export { parseAgentSpec } from './parse';
export { toPublicAgent } from './public';
export { getAgent, getOrchestrator, listAgents, listPublicAgents, loadRegistry } from './registry';
export { validateSpecs } from './validate';
