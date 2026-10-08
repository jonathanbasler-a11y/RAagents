import 'server-only';

// Prompt building (server-only: prompt text must never reach the browser bundle).
// - SHARED_RULES: the rules every agent shares; carries PROMPT_MARKER for the bundle check.
// - buildAgentPrompt: rules → persona brief → date and time zone → fenced room context →
//   validated history ending with the question. Returns the messages and their hash.
// - fenceUntrusted / neutraliseUntrusted: text not written by the person asking.
// - formatTurnDate / resolveTimeZone: the date line, and the browser time zone check.

export { PROMPT_MARKER, SHARED_RULES } from './rules';
export { formatTurnDate, resolveTimeZone } from './date';
export { fenceUntrusted, neutraliseUntrusted, type FencedText, type FenceOptions, type UntrustedBlock } from './fence';
export { buildAgentPrompt, hashPrompt, type AgentPrompt, type AgentPromptInput } from './build';
