import 'server-only';
import { LineCounter, parseDocument } from 'yaml';
import {
  AGENT_GROUPS,
  AGENT_KINDS,
  AGENT_SECTION_HEADINGS,
  AGENT_SPEC_OPTIONAL_YAML_KEYS,
  AGENT_SPEC_YAML_KEYS,
  AGENT_TRIGGERS,
  TEAM_ROLES,
  type AgentRouting,
  type AgentSectionHeading,
  type AgentSections,
  type AgentSpec,
  type AgentSpecYamlKey,
  type AutonomyLevel,
  type ModelRoute,
  type SpecIssue,
} from '@/shared/contracts';
import { AgentSpecError } from './errors';
import { AGENT_ID_PATTERN, RESERVED_AGENT_IDS, SECTION_KEY_BY_HEADING } from './spec-format';

type Report = (message: string) => void;
type Fields = Record<string, unknown>;
type FrontMatter = Omit<AgentSpec, 'sections'>;

const ALLOWED_KEYS: ReadonlySet<string> = new Set(AGENT_SPEC_YAML_KEYS);
const OPTIONAL_KEYS: ReadonlySet<string> = new Set(AGENT_SPEC_OPTIONAL_YAML_KEYS);
const MODEL_ROUTES: readonly ModelRoute[] = ['agents'];
const AUTONOMY_LEVELS: readonly AutonomyLevel[] = [1, 2, 3];
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const LETTER_PATTERN = /^\p{Lu}$/u;
const ROUTING_KEYS: ReadonlySet<string> = new Set(['keywords', 'acronyms']);
/** A fence line in Markdown: three or more backticks or tildes. */
const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
/** A top-level `## ` heading (an optional closing run of `#` is dropped). */
const SECTION_HEADING_PATTERN = /^## (.*)$/;
/** A `-`, `*` or `+` bullet; the text may be missing. */
const BULLET_PATTERN = /^ {0,3}[-*+](?:[ \t]+(.*))?$/;

/**
 * Parses one spec file: YAML front matter (snake_case) plus the `## ` body sections.
 * Throws AgentSpecError naming the file on a missing field, a bad value or a missing
 * section, with every problem in the file, not just the first.
 *
 * Checks that need the whole roster, or that compare fields with each other (the letter
 * rule, kind against group, flag consistency, empty sections), are validateSpecs's job.
 */
export function parseAgentSpec(source: string, fileName: string): AgentSpec {
  const issues: SpecIssue[] = [];
  const report: Report = (message) => {
    issues.push({ source: fileName, message });
  };

  // Tolerate a byte-order mark and Windows line endings; neither is content.
  const text = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const split = splitFrontMatter(text);
  if (!split.ok) {
    report(split.problem);
    throw new AgentSpecError(issues);
  }

  const frontMatter = readFrontMatter(split.yaml, fileName, report);
  const sections = readSections(split.body, report);
  if (issues.length > 0 || frontMatter === undefined || sections === undefined) throw new AgentSpecError(issues);
  return { ...frontMatter, sections };
}

type FrontMatterSplit = { ok: true; yaml: string; body: string } | { ok: false; problem: string };

function splitFrontMatter(text: string): FrontMatterSplit {
  const lines = text.split('\n');
  if (lines[0]?.trimEnd() !== '---') {
    return { ok: false, problem: 'the file must start with front matter: a "---" line, the YAML fields, then a closing "---" line' };
  }
  const end = lines.findIndex((line, index) => index > 0 && line.trimEnd() === '---');
  if (end === -1) return { ok: false, problem: 'the front matter has no closing "---" line' };
  return { ok: true, yaml: lines.slice(1, end).join('\n'), body: lines.slice(end + 1).join('\n') };
}

// ---------------------------------------------------------------------------
// Front matter
// ---------------------------------------------------------------------------

function readFrontMatter(yamlText: string, fileName: string, report: Report): FrontMatter | undefined {
  const parsed = readYaml(yamlText, report);
  if (!parsed.ok) return undefined;
  if (!isMapping(parsed.value)) {
    report(`the front matter must be a mapping of fields ("key: value" lines); got ${shown(parsed.value)}`);
    return undefined;
  }
  const fields = parsed.value;
  for (const key of Object.keys(fields)) {
    if (!ALLOWED_KEYS.has(key)) report(unknownKeyMessage(key));
  }

  // Read in the contract's key order, so issues come out in a predictable order.
  const read = new FieldReader(fields, report);
  const frontMatter: FrontMatter = {
    id: read.id(fileName),
    name: read.text('name'),
    letter: read.letter(),
    capability: read.text('capability'),
    ...optional('shortCapability', read.optionalText('short_capability')),
    group: read.oneOf('group', AGENT_GROUPS),
    kind: read.oneOf('kind', AGENT_KINDS),
    ...optional('teamRole', read.optionalOneOf('team_role', TEAM_ROLES)),
    order: read.wholeNumber('order'),
    autonomyLevel: read.autonomyLevel(),
    humanOwner: read.text('human_owner'),
    active: read.bool('active'),
    version: read.version(),
    modelRoute: read.oneOf('model_route', MODEL_ROUTES),
    routing: read.routing(),
    routable: read.bool('routable'),
    mentionOnly: read.bool('mention_only'),
    locked: read.bool('locked'),
    defaultSelected: read.bool('default_selected'),
    ...optional('trigger', read.optionalOneOf('trigger', AGENT_TRIGGERS)),
    handoffs: read.idList('handoffs'),
    sourceAllowlist: read.textList('source_allowlist'),
    avatar: read.text('avatar'),
    plannedRemit: read.text('planned_remit'),
  };
  return frontMatter;
}

type YamlResult = { ok: true; value: unknown } | { ok: false };

function readYaml(yamlText: string, report: Report): YamlResult {
  const lineCounter = new LineCounter();
  const doc = parseDocument(yamlText, { lineCounter, prettyErrors: false, uniqueKeys: true });
  const problems = [...doc.errors, ...doc.warnings];
  for (const problem of problems) {
    // The YAML starts on line 2 of the file, after the opening "---".
    const line = lineCounter.linePos(problem.pos[0]).line + 1;
    report(`front matter YAML error on line ${line}: ${problem.message}`);
  }
  if (problems.length > 0) return { ok: false };
  try {
    return { ok: true, value: doc.toJS() };
  } catch (error) {
    report(`front matter YAML could not be read: ${error instanceof Error ? error.message : String(error)}`);
    return { ok: false };
  }
}

function unknownKeyMessage(key: string): string {
  const snake = key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
  const hint = snake !== key && ALLOWED_KEYS.has(snake) ? ` (did you mean "${snake}"?)` : '';
  return `unknown front-matter key "${key}"${hint}; outputs/04_agents/README.md lists the allowed keys`;
}

/**
 * Reads and type-checks one front-matter field at a time. A bad value is reported and
 * replaced by a placeholder of the right type; parseAgentSpec throws whenever anything
 * was reported, so a placeholder never leaves this module.
 */
class FieldReader {
  private readonly fields: Fields;
  private readonly report: Report;

  constructor(fields: Fields, report: Report) {
    this.fields = fields;
    this.report = report;
  }

  /** The value, or undefined when the key is absent (reported if required) or has no value (reported). */
  private value(key: AgentSpecYamlKey): unknown {
    if (!Object.hasOwn(this.fields, key)) {
      if (!OPTIONAL_KEYS.has(key)) this.report(`missing required key "${key}"`);
      return undefined;
    }
    const value = this.fields[key];
    if (value === null || value === undefined) {
      this.report(`"${key}" has no value${OPTIONAL_KEYS.has(key) ? '; leave the key out instead' : ''}`);
      return undefined;
    }
    return value;
  }

  id(fileName: string): string {
    const value = this.value('id');
    if (value === undefined) return '';
    if (typeof value !== 'string') {
      this.report(`"id" must be text; got ${shown(value)}`);
      return '';
    }
    if (!AGENT_ID_PATTERN.test(value)) {
      this.report(`id "${value}" must be lowercase letters, digits and hyphens, starting with a letter`);
    } else if (RESERVED_AGENT_IDS.has(value)) {
      this.report(`id "${value}" is reserved for the team chat`);
    }
    if (`${value}.md` !== fileName) this.report(`id "${value}" must match the file name "${fileName}"`);
    return value;
  }

  text(key: AgentSpecYamlKey): string {
    const value = this.value(key);
    return value === undefined ? '' : this.checkText(key, value);
  }

  optionalText(key: AgentSpecYamlKey): string | undefined {
    const value = this.value(key);
    return value === undefined ? undefined : this.checkText(key, value);
  }

  private checkText(key: AgentSpecYamlKey, value: unknown): string {
    if (typeof value !== 'string') {
      this.report(`"${key}" must be text; got ${shown(value)}`);
      return '';
    }
    if (value.trim() === '') {
      this.report(`"${key}" must be non-empty text`);
      return '';
    }
    return value.trim();
  }

  letter(): string {
    const value = this.value('letter');
    if (value === undefined) return '';
    if (typeof value !== 'string' || !LETTER_PATTERN.test(value)) {
      this.report(`"letter" must be one capital letter, such as "L"; got ${shown(value)}`);
      return '';
    }
    return value;
  }

  bool(key: AgentSpecYamlKey): boolean {
    const value = this.value(key);
    if (value === undefined) return false;
    if (typeof value !== 'boolean') {
      this.report(`"${key}" must be true or false; got ${shown(value)}`);
      return false;
    }
    return value;
  }

  oneOf<T extends string>(key: AgentSpecYamlKey, allowed: readonly T[]): T {
    const value = this.value(key);
    return value === undefined ? allowed[0] : this.checkOneOf(key, value, allowed);
  }

  optionalOneOf<T extends string>(key: AgentSpecYamlKey, allowed: readonly T[]): T | undefined {
    const value = this.value(key);
    return value === undefined ? undefined : this.checkOneOf(key, value, allowed);
  }

  private checkOneOf<T extends string>(key: AgentSpecYamlKey, value: unknown, allowed: readonly T[]): T {
    const match = allowed.find((candidate) => candidate === value);
    if (match === undefined) {
      this.report(`"${key}" must be one of ${allowed.join(', ')}; got ${shown(value)}`);
      return allowed[0];
    }
    return match;
  }

  wholeNumber(key: AgentSpecYamlKey): number {
    const value = this.value(key);
    if (value === undefined) return 0;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
      this.report(`"${key}" must be a whole number, 1 or more; got ${shown(value)}`);
      return 0;
    }
    return value;
  }

  autonomyLevel(): AutonomyLevel {
    const value = this.value('autonomy_level');
    const match = AUTONOMY_LEVELS.find((level) => level === value);
    if (value !== undefined && match === undefined) {
      this.report(`"autonomy_level" must be 1, 2 or 3, written as a number; got ${shown(value)}`);
    }
    return match ?? 1;
  }

  version(): string {
    const value = this.value('version');
    if (value === undefined) return '';
    if (typeof value === 'number') {
      this.report(`"version" must be a quoted string such as "0.1.0"; unquoted, YAML reads ${value} as a number`);
      return '';
    }
    if (typeof value !== 'string' || !VERSION_PATTERN.test(value)) {
      this.report(`"version" must be "MAJOR.MINOR.PATCH", such as "0.1.0"; got ${shown(value)}`);
      return '';
    }
    return value;
  }

  routing(): AgentRouting {
    const value = this.value('routing');
    if (value === undefined) return { keywords: [], acronyms: [] };
    if (!isMapping(value)) {
      this.report(`"routing" must be a mapping with the lists "keywords" and "acronyms"; got ${shown(value)}`);
      return { keywords: [], acronyms: [] };
    }
    for (const key of Object.keys(value)) {
      if (!ROUTING_KEYS.has(key)) this.report(`unknown key "routing.${key}"; routing has only "keywords" and "acronyms"`);
    }
    return { keywords: this.routingTerms(value, 'keywords'), acronyms: this.routingTerms(value, 'acronyms') };
  }

  private routingTerms(routing: Fields, list: 'keywords' | 'acronyms'): string[] {
    const name = `routing.${list}`;
    if (!Object.hasOwn(routing, list)) {
      this.report(`"${name}" is missing; write [] for none`);
      return [];
    }
    const terms = this.list(name, routing[list]);
    for (const term of terms) {
      if (list === 'acronyms' && /\s/.test(term)) this.report(`"${name}" item "${term}" must be one word without spaces`);
    }
    return terms;
  }

  idList(key: AgentSpecYamlKey): string[] {
    const value = this.value(key);
    if (value === undefined) return [];
    const ids = this.list(key, value);
    for (const id of ids) {
      if (!AGENT_ID_PATTERN.test(id)) this.report(`"${key}" item "${id}" is not an agent id (lowercase letters, digits and hyphens)`);
    }
    return ids;
  }

  textList(key: AgentSpecYamlKey): string[] {
    const value = this.value(key);
    return value === undefined ? [] : this.list(key, value);
  }

  /** A list of non-empty text items, trimmed. */
  private list(name: string, value: unknown): string[] {
    if (value === null || value === undefined) {
      this.report(`"${name}" has no value; write [] for none`);
      return [];
    }
    if (!Array.isArray(value)) {
      this.report(`"${name}" must be a list (write [] for none); got ${shown(value)}`);
      return [];
    }
    const items: string[] = [];
    value.forEach((item: unknown, index) => {
      if (typeof item !== 'string' || item.trim() === '') {
        this.report(`"${name}" item ${index + 1} must be non-empty text; got ${shown(item)}`);
      } else {
        items.push(item.trim());
      }
    });
    return items;
  }
}

function optional<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

function isMapping(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function shown(value: unknown): string {
  if (value === null || value === undefined) return 'nothing';
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return 'a list';
  if (isMapping(value)) return 'a mapping';
  return String(value);
}

// ---------------------------------------------------------------------------
// Body sections
// ---------------------------------------------------------------------------

interface RawSection {
  heading: string;
  lines: string[];
}

function readSections(body: string, report: Report): AgentSections | undefined {
  const { preamble, sections } = splitSections(body);
  if (preamble.some((line) => line.trim() !== '')) {
    report('text before "## Role": nothing may come between the front matter and the first section');
  }

  const found = new Map<AgentSectionHeading, RawSection[]>();
  const firstSeen: AgentSectionHeading[] = [];
  for (const section of sections) {
    const heading = headingFor(section.heading, report);
    if (heading === undefined) continue;
    const list = found.get(heading);
    if (list) {
      list.push(section);
    } else {
      found.set(heading, [section]);
      firstSeen.push(heading);
    }
  }

  for (const heading of AGENT_SECTION_HEADINGS) {
    const list = found.get(heading);
    if (!list) report(`missing section "## ${heading}"`);
    else if (list.length > 1) report(`section "## ${heading}" appears ${list.length} times`);
  }
  const expected = AGENT_SECTION_HEADINGS.filter((heading) => found.has(heading));
  if (firstSeen.join('\n') !== expected.join('\n')) {
    report(`sections are out of order: expected ${expected.join(', ')}; found ${firstSeen.join(', ')}`);
  }

  const textOf = (heading: AgentSectionHeading): string | undefined => found.get(heading)?.[0]?.lines.join('\n').trim();
  const promptLines = found.get('Example prompts')?.[0]?.lines;
  const result: Partial<AgentSections> = {
    examplePrompts: promptLines ? readExamplePrompts(promptLines, report) : undefined,
  };
  for (const heading of AGENT_SECTION_HEADINGS) {
    const key = SECTION_KEY_BY_HEADING[heading];
    if (key !== 'examplePrompts') result[key] = textOf(heading);
  }
  return isComplete(result) ? result : undefined;
}

function isComplete(sections: Partial<AgentSections>): sections is AgentSections {
  return AGENT_SECTION_HEADINGS.every((heading) => sections[SECTION_KEY_BY_HEADING[heading]] !== undefined);
}

/** The section a heading names, or undefined (reported) for an unknown heading. */
function headingFor(text: string, report: Report): AgentSectionHeading | undefined {
  const exact = AGENT_SECTION_HEADINGS.find((heading) => heading === text);
  if (exact !== undefined) return exact;
  const sameLetters = AGENT_SECTION_HEADINGS.find((heading) => heading.toLowerCase() === text.toLowerCase());
  if (sameLetters !== undefined) {
    report(`section heading "## ${text}" must be written exactly "## ${sameLetters}"`);
    return sameLetters;
  }
  report(`unknown section "## ${text}"; the sections are ${AGENT_SECTION_HEADINGS.map((heading) => `"## ${heading}"`).join(', ')}`);
  return undefined;
}

/** Splits the body at `## ` headings. Lines inside fenced code blocks never start a section. */
function splitSections(body: string): { preamble: string[]; sections: RawSection[] } {
  const preamble: string[] = [];
  const sections: RawSection[] = [];
  let fence: { marker: string; length: number } | null = null;
  for (const line of body.split('\n')) {
    const fenceLine = FENCE_PATTERN.exec(line);
    if (fenceLine) {
      const [, run, rest] = fenceLine;
      if (fence === null) {
        fence = { marker: run[0], length: run.length };
      } else if (run[0] === fence.marker && run.length >= fence.length && rest.trim() === '') {
        fence = null;
      }
    }
    const heading = fence === null && !fenceLine ? SECTION_HEADING_PATTERN.exec(line) : null;
    if (heading) {
      sections.push({ heading: heading[1].replace(/\s+#+\s*$/, '').trim(), lines: [] });
    } else {
      (sections.at(-1)?.lines ?? preamble).push(line);
    }
  }
  return { preamble, sections };
}

/** The bullet items of "## Example prompts". An indented line continues the bullet above it. */
function readExamplePrompts(lines: readonly string[], report: Report): string[] {
  const prompts: string[] = [];
  for (const line of lines) {
    if (line.trim() === '') continue;
    const bullet = BULLET_PATTERN.exec(line);
    if (bullet) {
      const text = (bullet[1] ?? '').trim();
      if (text === '') report('"## Example prompts" has an empty bullet');
      else prompts.push(text);
    } else if (/^[ \t]/.test(line) && prompts.length > 0) {
      prompts[prompts.length - 1] = `${prompts[prompts.length - 1]} ${line.trim()}`;
    } else {
      report(`"## Example prompts" must be a bullet list; this line is not a bullet: "${line.trim()}"`);
    }
  }
  return prompts;
}
