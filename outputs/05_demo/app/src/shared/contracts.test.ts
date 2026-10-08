import { readFileSync } from 'node:fs';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { parse } from 'yaml';
import {
  AGENT_SECTION_HEADINGS,
  AGENT_SPEC_OPTIONAL_YAML_KEYS,
  AGENT_SPEC_YAML_KEYS,
  type AgentSectionHeading,
  type AgentSectionKeyByHeading,
  type AgentSections,
  type AgentSpec,
  type AgentSpecFieldByYamlKey,
  type AgentSpecYamlKey,
} from './contracts';

// The spec template (outputs/04_agents/README.md) and these contracts describe one format.
// These tests keep the two in step.
const readme = readFileSync(new URL('../../../../04_agents/README.md', import.meta.url), 'utf8');

/** The README's top-level `## ` sections. Headings inside code fences do not count. */
function section(name: string): string {
  const found = new Map<string, string[]>();
  let current: string[] | null = null;
  let inFence = false;
  for (const line of readme.split('\n')) {
    if (line.startsWith('```')) inFence = !inFence;
    const heading = inFence ? null : /^## (.+)$/.exec(line);
    if (heading) {
      current = [];
      found.set(heading[1], current);
    } else {
      current?.push(line);
    }
  }
  const lines = found.get(name);
  if (!lines) throw new Error(`README has no "## ${name}" section`);
  return lines.join('\n');
}

/** The content of the first fenced code block in `text`. */
function firstFence(text: string): string {
  const match = /^```[^\n]*\n([\s\S]*?)^```$/m.exec(text);
  if (!match) throw new Error('no fenced code block');
  return match[1];
}

/** The first table in `text`: header row first, separator row dropped, cells trimmed. */
function firstTable(text: string): string[][] {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.startsWith('|'));
  if (start === -1) throw new Error('no table');
  const rows: string[][] = [];
  for (const line of lines.slice(start)) {
    if (!line.startsWith('|')) break;
    if (/^\|[-| :]+\|$/.test(line)) continue;
    rows.push(line.split('|').slice(1, -1).map((cell) => cell.trim()));
  }
  return rows;
}

const headingsIn = (markdown: string) => [...markdown.matchAll(/^## (.+)$/gm)].map((match) => match[1]);

describe('spec template and contracts', () => {
  it('maps every body heading and every front-matter key onto exactly one AgentSpec field', () => {
    // Compile-time checks: `npm run typecheck` fails if these maps drift from the types.
    expectTypeOf<AgentSectionKeyByHeading[AgentSectionHeading]>().toEqualTypeOf<keyof AgentSections>();
    expectTypeOf<keyof AgentSpecFieldByYamlKey>().toEqualTypeOf<AgentSpecYamlKey>();
    expectTypeOf<AgentSpecFieldByYamlKey[AgentSpecYamlKey]>().toEqualTypeOf<Exclude<keyof AgentSpec, 'sections'>>();

    expect(new Set(AGENT_SECTION_HEADINGS).size).toBe(10);
    expect(new Set(AGENT_SPEC_YAML_KEYS).size).toBe(AGENT_SPEC_YAML_KEYS.length);
  });

  it('lays out the body headings in the order the contract requires', () => {
    expect(headingsIn(firstFence(section('File layout')))).toEqual([...AGENT_SECTION_HEADINGS]);
  });

  it('documents exactly the front-matter keys the contract allows', () => {
    const [, ...rows] = firstTable(section('Front matter'));
    const documented = rows.map((row) => row[0].replace(/`/g, '').split('.')[0]);

    expect(new Set(documented)).toEqual(new Set(AGENT_SPEC_YAML_KEYS));
  });

  it('fills in the example with allowed keys, every required key and the headings in order', () => {
    const spec = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(firstFence(section('Example (fictional)')));
    if (!spec) throw new Error('the example has no front matter');
    const keys = Object.keys(parse(spec[1]) as Record<string, unknown>);
    const allowed: readonly string[] = AGENT_SPEC_YAML_KEYS;
    const optional: readonly string[] = AGENT_SPEC_OPTIONAL_YAML_KEYS;

    expect(keys.filter((key) => !allowed.includes(key))).toEqual([]);
    expect(allowed.filter((key) => !optional.includes(key) && !keys.includes(key))).toEqual([]);
    expect(headingsIn(spec[2])).toEqual([...AGENT_SECTION_HEADINGS]);
  });

  it('keeps the roster table at 25 agents: 14 selected by default, 5 locked, one orchestrator', () => {
    const [header, ...rows] = firstTable(section('Roster at a glance'));
    const count = (column: string, value: string) => rows.filter((row) => row[header.indexOf(column)] === value).length;

    expect(rows).toHaveLength(25);
    expect(count('default_selected', 'true')).toBe(14);
    expect(count('locked', 'true')).toBe(5);
    expect(count('kind', 'orchestrator')).toBe(1);
  });
});
