import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadRegistry } from '@/server/agents';
import { extraSpec, fixtureSpec, fixtureSpecs } from '@/server/agents/test-fixtures';
import type { AgentSpec, RouteDecision } from '@/shared/contracts';
import { routeTeamTurn } from './team-router';

// The fixture roster: Rosa (lead), Carlos (cmc), Lena (labels, not selected by default),
// Oskar (conductor, orchestrator), Ruben (critic, red team) and Sofia (summary,
// synthesiser), plus four extra agents so the caps and the team roles can be exercised.
function roster(): AgentSpec[] {
  return [
    ...fixtureSpecs(),
    extraSpec(), // dosing: Dara, keyword "dose finding", selected
    {
      ...fixtureSpec('lead'),
      id: 'paeds',
      name: 'Pia',
      letter: 'P',
      capability: 'Paediatric specialist',
      group: 'spec',
      order: 8,
      routing: { keywords: ['paediatric'], acronyms: ['PIP'] },
      handoffs: [],
    },
    {
      ...fixtureSpec('critic'),
      id: 'checker',
      name: 'Emeka',
      letter: 'E',
      capability: 'Evidence checker',
      teamRole: 'evidence-checker',
      order: 9,
    },
    {
      ...fixtureSpec('critic'),
      id: 'scrub',
      name: 'Saskia',
      letter: 'S',
      capability: 'Sanitiser',
      teamRole: 'sanitiser',
      order: 10,
    },
  ];
}

/** "Selected for this DD" as the app derives it with nothing saved: locked or selected by default. */
function defaults(agents: AgentSpec[]): Set<string> {
  return new Set(agents.filter((agent) => agent.locked || agent.defaultSelected).map((agent) => agent.id));
}

function route(question: string, options: { agents?: AgentSpec[]; selected?: Set<string> } = {}): RouteDecision {
  const agents = options.agents ?? roster();
  return routeTeamTurn({ question, agents, selected: options.selected ?? defaults(agents) });
}

const ORCHESTRATOR_ONLY: RouteDecision = {
  source: 'none',
  primary: 'conductor',
  secondaries: [],
  notConsulted: [],
  notes: [],
  synthesis: false,
};

describe('routeTeamTurn: @mentions', () => {
  it('brings in exactly the agents mentioned, in mention order, and lets the synthesiser follow', () => {
    expect(route('@Rosa @Carlos what are the main regulatory risks for a biologic moving to Phase 3?')).toEqual({
      source: 'explicit',
      primary: 'lead',
      secondaries: ['cmc'],
      notConsulted: [],
      notes: [],
      synthesis: true,
    });
  });

  it('matches names whatever their case, and keeps the order they were written in', () => {
    expect(route('@carlos and @ROSA, a question about the filing route')).toMatchObject({
      source: 'explicit',
      primary: 'cmc',
      secondaries: ['lead'],
    });
  });

  it('wins over routing terms in the same question', () => {
    expect(route('@Rosa what is the CMC comparability risk?')).toEqual({
      source: 'explicit',
      primary: 'lead',
      secondaries: [],
      notConsulted: [],
      notes: [],
      synthesis: false,
    });
  });

  it('counts a mention once, also when it is followed by punctuation or a possessive', () => {
    expect(route("(@Rosa) and @Rosa's view, then @Carlos.")).toMatchObject({ primary: 'lead', secondaries: ['cmc'] });
  });

  it('summons nobody with a bare name: Oskar answers when nothing else matches', () => {
    expect(route('Rosa and Carlos, what do you think?')).toEqual(ORCHESTRATOR_ONLY);
  });

  it('does not read an e-mail address as a mention', () => {
    expect(route('Ask rosa@example.org about the regulatory strategy')).toMatchObject({ source: 'keyword', primary: 'lead' });
  });

  it('brings in at most 4 agents and shows the rest as "matched, not consulted"', () => {
    expect(route('@Rosa @Carlos @Dara @Pia @Emeka, your views?')).toEqual({
      source: 'explicit',
      primary: 'lead',
      secondaries: ['cmc', 'dosing', 'paeds'],
      notConsulted: [{ agentId: 'checker', reason: 'over_cap' }],
      notes: [],
      synthesis: true,
    });
  });

  it('never makes the red team the first answer when anyone else is named', () => {
    expect(route('@Ruben @Rosa is this filing route realistic?')).toMatchObject({ primary: 'lead', secondaries: ['critic'] });
    expect(route('@Ruben @Emeka check these claims')).toMatchObject({ primary: 'checker', secondaries: ['critic'] });
  });

  it('lets a mention-only team role answer alone when only it is named', () => {
    expect(route('@Ruben challenge this plan')).toEqual({
      source: 'explicit',
      primary: 'critic',
      secondaries: [],
      notConsulted: [],
      notes: [],
      synthesis: false,
    });
  });

  it('leaves out an agent who is not selected for this DD, with a note that says how to bring them in', () => {
    expect(route('@Lena @Rosa what goes in the label?')).toEqual({
      source: 'explicit',
      primary: 'lead',
      secondaries: [],
      notConsulted: [{ agentId: 'labels', reason: 'not_selected' }],
      notes: ['Lena is not selected for this DD; switch them on in the team overview to bring them in.'],
      synthesis: false,
    });
  });

  it('brings in an agent once they are selected (positive control)', () => {
    const agents = roster();
    const selected = defaults(agents).add('labels');

    expect(route('@Lena @Rosa what goes in the label?', { agents, selected })).toMatchObject({
      primary: 'labels',
      secondaries: ['lead'],
      notConsulted: [],
      notes: [],
    });
  });

  it('adds a note about their rule when the orchestrator or the synthesiser is mentioned', () => {
    expect(route('@Oskar @Sofia @Rosa @Carlos what first?')).toEqual({
      source: 'explicit',
      primary: 'lead',
      secondaries: ['cmc'],
      notConsulted: [
        { agentId: 'conductor', reason: 'joins_by_rule' },
        { agentId: 'summary', reason: 'joins_by_rule' },
      ],
      notes: [
        'Oskar joins by rule, not by mention: Oskar answers only when nobody else is brought in.',
        'Sofia joins by rule, not by mention: Sofia sums up when 2 or more teammates have contributed.',
      ],
      synthesis: true,
    });
  });

  it('lets the orchestrator answer when only he is mentioned and nothing matches, keeping the note', () => {
    expect(route('@Oskar who should look at this?')).toEqual({
      ...ORCHESTRATOR_ONLY,
      notes: ['Oskar joins by rule, not by mention: Oskar answers only when nobody else is brought in.'],
    });
  });

  it('says so when an @name is not an agent, and routes the question as usual', () => {
    expect(route('@Bob @bob what is the regulatory strategy?')).toEqual({
      source: 'keyword',
      primary: 'lead',
      secondaries: [],
      notConsulted: [],
      notes: ['@Bob is not the name of an agent, so it brought nobody in.'],
      synthesis: false,
      matchedTerms: { lead: ['regulatory strategy'] },
    });
  });
});

describe('routeTeamTurn: routing terms', () => {
  it('picks the selected agents whose terms match, ranked by matching terms, with the terms in the trace', () => {
    expect(route('What CMC comparability risks come with a manufacturing change, and what regulatory strategy?')).toEqual({
      source: 'keyword',
      primary: 'cmc',
      secondaries: ['lead'],
      notConsulted: [],
      notes: [],
      synthesis: true,
      matchedTerms: { cmc: ['comparability', 'manufacturing change', 'CMC'], lead: ['regulatory strategy'] },
    });
  });

  it('breaks ties by spec order, whatever order the roster arrives in', () => {
    const agents = roster().reverse();

    expect(route('Which regulatory strategy fits the comparability data?', { agents })).toMatchObject({
      primary: 'lead',
      secondaries: ['cmc'],
    });
  });

  it('brings in at most 3 and shows the rest as "matched, not consulted"', () => {
    expect(route('CMC and comparability, the regulatory strategy, dose finding and the paediatric plan?')).toEqual({
      source: 'keyword',
      primary: 'cmc',
      secondaries: ['lead', 'dosing'],
      notConsulted: [{ agentId: 'paeds', reason: 'over_cap' }],
      notes: [],
      synthesis: true,
      matchedTerms: { cmc: ['comparability', 'CMC'], lead: ['regulatory strategy'], dosing: ['dose finding'], paeds: ['paediatric'] },
    });
  });

  it.each([
    ['an acronym in the wrong case', 'what about cmc?'],
    ['an acronym inside a longer word', 'what about CMCs?'],
    ['a keyword inside a longer word', 'is there incomparability here?'],
  ])('does not match %s', (_name, question) => {
    expect(route(question)).toEqual(ORCHESTRATOR_ONLY);
  });

  it('matches an acronym in its own case and a keyword phrase across line breaks (positive control)', () => {
    expect(route('what about CMC?')).toMatchObject({ source: 'keyword', primary: 'cmc' });
    expect(route('what is the\nfiling   route?')).toMatchObject({ source: 'keyword', primary: 'lead' });
  });

  it('leaves out a matching agent who is not selected, with a note, and Oskar answers if nobody else matched', () => {
    expect(route('What should the product information say?')).toEqual({
      source: 'none',
      primary: 'conductor',
      secondaries: [],
      notConsulted: [{ agentId: 'labels', reason: 'not_selected' }],
      notes: ['Lena matches this question but is not selected for this DD; switch them on in the team overview to bring them in.'],
      synthesis: false,
      matchedTerms: { labels: ['product information'] },
    });
  });

  it('names an unselected agent once when it is both mentioned and matched', () => {
    expect(route('@Lena what goes in the SmPC?')).toEqual({
      source: 'none',
      primary: 'conductor',
      secondaries: [],
      notConsulted: [{ agentId: 'labels', reason: 'not_selected' }],
      notes: ['Lena is not selected for this DD; switch them on in the team overview to bring them in.'],
      synthesis: false,
      matchedTerms: { labels: ['SmPC'] },
    });
  });
});

describe('routeTeamTurn: the real roster and the live-demo prompts', () => {
  const REAL_SPECS_DIR = fileURLToPath(new URL('../../../../../04_agents/', import.meta.url));
  const APP_PUBLIC_DIR = fileURLToPath(new URL('../../../public/', import.meta.url));
  const real = () => [...loadRegistry({ specsDir: REAL_SPECS_DIR, publicDir: APP_PUBLIC_DIR }).agents];

  it('"@Rosa @Carlos" brings in exactly Rosa and Carlos, and Sofia may sum up', () => {
    expect(route('@Rosa @Carlos what are the main regulatory risks for a biologic moving to Phase 3?', { agents: real() })).toEqual({
      source: 'explicit',
      primary: 'reglead',
      secondaries: ['cmcreg'],
      notConsulted: [],
      notes: [],
      synthesis: true,
    });
  });

  it('a paediatric question goes to Pia by routing terms', () => {
    expect(
      route('Which paediatric obligations could change a filing timeline, and who should confirm them?', { agents: real() }),
    ).toMatchObject({ source: 'keyword', primary: 'sp-paed', secondaries: [], matchedTerms: { 'sp-paed': ['paediatric'] } });
  });

  it('a question nobody matches goes to Oskar', () => {
    expect(route('What would you check first in a regulatory due diligence for an asset in Phase 2?', { agents: real() })).toEqual({
      source: 'none',
      primary: 'orc',
      secondaries: [],
      notConsulted: [],
      notes: [],
      synthesis: false,
    });
  });
});
