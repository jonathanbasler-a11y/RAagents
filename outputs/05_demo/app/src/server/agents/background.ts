import 'server-only';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AgentBackground } from '@/shared/contracts';

// Background reading the workspace owner keeps beside the app, never in the repository: one
// `<agent id>.md` per agent in a local folder (default `.data/background`, which git ignores).
// It may hold material that must not be published, so it is read at runtime, only from that
// folder, and only its demo questions ever reach the browser (see toPublicAgent).

/** Longest background text an agent carries in every prompt, in characters (about 15,000 tokens). */
export const BACKGROUND_MAX_CHARS = 60_000;
/** Most demo questions one background file may offer. */
export const BACKGROUND_MAX_QUESTIONS = 3;
const QUESTION_MAX_CHARS = 300;
const TITLE_MAX_CHARS = 200;
const DEMO_HEADING = /^##\s+Demo questions\s*$/i;

export type ParsedBackground = { ok: true; background: AgentBackground } | { ok: false; reason: string };
export type BackgroundRead = { kind: 'none' } | { kind: 'ok'; background: AgentBackground } | { kind: 'skipped'; reason: string };

/** The option, else env AGENT_BACKGROUND_DIR, else `.data/background`, resolved from process.cwd(). */
export function resolveBackgroundDir(optionsDir?: string): string {
  const fromEnv = process.env.AGENT_BACKGROUND_DIR?.trim();
  return resolve(/* turbopackIgnore: true */ process.cwd(), optionsDir ?? (fromEnv ? fromEnv : join('.data', 'background')));
}

/**
 * A background file: the first line `# Title`, then the text. An optional `## Demo questions`
 * section lists questions (`- ...`) that the agent's 1:1 room offers as starter prompts; that
 * section is left out of the text the agent reads.
 */
export function parseBackground(raw: string): ParsedBackground {
  const lines = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const first = lines.findIndex((line) => line.trim() !== '');
  const titleMatch = first === -1 ? null : /^#\s+(.+?)\s*$/.exec(lines[first]);
  if (titleMatch === null) return { ok: false, reason: 'the first line must be a "# Title" heading' };
  const title = titleMatch[1];
  if (title.length > TITLE_MAX_CHARS) return { ok: false, reason: `the title is longer than ${TITLE_MAX_CHARS} characters` };

  const body: string[] = [];
  const demoQuestions: string[] = [];
  let inDemo = false;
  for (const line of lines.slice(first + 1)) {
    if (DEMO_HEADING.test(line)) {
      inDemo = true;
      continue;
    }
    if (inDemo && /^#{1,2}\s/.test(line)) {
      inDemo = false;
      body.push('');
    }
    if (!inDemo) {
      body.push(line);
      continue;
    }
    const item = /^\s*[-*]\s+(.+?)\s*$/.exec(line);
    if (item) demoQuestions.push(item[1]);
  }

  const text = body.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text === '') return { ok: false, reason: 'the file has a title but no text' };
  if (text.length > BACKGROUND_MAX_CHARS) return { ok: false, reason: `the text is longer than ${BACKGROUND_MAX_CHARS} characters` };
  if (demoQuestions.length > BACKGROUND_MAX_QUESTIONS) {
    return { ok: false, reason: `more than ${BACKGROUND_MAX_QUESTIONS} demo questions` };
  }
  if (demoQuestions.some((question) => question.length > QUESTION_MAX_CHARS)) {
    return { ok: false, reason: `a demo question is too long (over ${QUESTION_MAX_CHARS} characters)` };
  }
  return { ok: true, background: { title, text, demoQuestions } };
}

/** `<dir>/<id>.md`: none when the folder or the file does not exist; skipped (with the reason) when it cannot be read or parsed. */
export function readBackground(dir: string, id: string): BackgroundRead {
  let raw: string;
  try {
    raw = readFileSync(join(dir, `${id}.md`), 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { kind: 'none' };
    return { kind: 'skipped', reason: `cannot read the file (${code ?? String(error)})` };
  }
  const parsed = parseBackground(raw);
  return parsed.ok ? { kind: 'ok', background: parsed.background } : { kind: 'skipped', reason: parsed.reason };
}
