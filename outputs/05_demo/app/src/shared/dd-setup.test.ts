import { describe, expect, it } from 'vitest';
import type { AgentSpec, DdSetup } from './contracts';
import {
  DEFAULT_DD_SETUP,
  FILED_STAGES,
  LATE_STAGES,
  normalizeDdSetup,
  ruleWants,
  selectionAfterSetupChange,
  selectionReason,
} from './dd-setup';

// The DD setup (development stage and asset classifications) decides which agents the playbook brings in.
// These tests use a small roster that mirrors the real specs: team roles are locked, two specialists are
// triggered by a classification and on by default, the others wait for a classification, a late stage
// or the filed stage, and "other functions" have no trigger and are off.

type RuleAgent = Pick<AgentSpec, 'id' | 'locked' | 'defaultSelected' | 'trigger'>;

const agent = (id: string, patch: Partial<RuleAgent> = {}): RuleAgent => ({ id, locked: false, defaultSelected: false, ...patch });

const ROSTER: RuleAgent[] = [
  agent('reglead', { defaultSelected: true }),
  agent('cmcreg', { defaultSelected: true }),
  agent('ops', { trigger: 'late' }),
  agent('mw', { trigger: 'late' }),
  agent('sp-orphan', { trigger: 'orphan', defaultSelected: true }),
  agent('sp-paed', { trigger: 'paed', defaultSelected: true }),
  agent('sp-exp', { trigger: 'exp' }),
  agent('sp-rm', { trigger: 'late' }),
  agent('sp-promo', { trigger: 'filed' }),
  agent('orc', { locked: true, defaultSelected: true }),
  agent('san', { locked: true, defaultSelected: true }),
  agent('o-cmc'),
];

const setup = (stage: DdSetup['stage'], classifications: DdSetup['classifications'] = ['orphan', 'paed']): DdSetup => ({ stage, classifications });
const idsOn = (ids: string[]) => ROSTER.filter((candidate) => ids.includes(candidate.id)).map((candidate) => candidate.id);
const DEFAULT_ON = ['reglead', 'cmcreg', 'sp-orphan', 'sp-paed', 'orc', 'san'];

describe('the default setup', () => {
  it('is Phase 2 with the orphan and paediatric classifications', () => {
    expect(DEFAULT_DD_SETUP).toEqual({ stage: 'Phase 2', classifications: ['orphan', 'paed'] });
  });

  it('wants exactly the agents that are selected by default', () => {
    expect(ROSTER.filter((candidate) => ruleWants(candidate, DEFAULT_DD_SETUP)).map((candidate) => candidate.id)).toEqual(DEFAULT_ON);
    for (const candidate of ROSTER) expect(ruleWants(candidate, DEFAULT_DD_SETUP), candidate.id).toBe(candidate.defaultSelected);
  });

  it('names Phase 3 and Filed as the late stages and Filed alone as the filed stage', () => {
    expect([...LATE_STAGES]).toEqual(['Phase 3', 'Filed']);
    expect([...FILED_STAGES]).toEqual(['Filed']);
  });
});

describe('ruleWants', () => {
  it('always wants a locked agent, whatever the setup', () => {
    for (const stage of ['Phase 1', 'Phase 2', 'Phase 3', 'Filed'] as const) {
      expect(ruleWants(agent('orc', { locked: true, defaultSelected: false }), setup(stage, []))).toBe(true);
    }
  });

  it('wants a classification specialist only while that classification is set', () => {
    const exp = agent('sp-exp', { trigger: 'exp' });
    expect(ruleWants(exp, setup('Phase 2', ['exp']))).toBe(true);
    expect(ruleWants(exp, setup('Phase 2', ['orphan']))).toBe(false);
    expect(ruleWants(exp, setup('Filed', ['orphan']))).toBe(false);
  });

  it('wants a late agent from Phase 3 on, not before', () => {
    const late = agent('ops', { trigger: 'late' });
    expect(ruleWants(late, setup('Phase 1'))).toBe(false);
    expect(ruleWants(late, setup('Phase 2'))).toBe(false);
    expect(ruleWants(late, setup('Phase 3'))).toBe(true);
    expect(ruleWants(late, setup('Filed'))).toBe(true);
  });

  it('wants a filed agent only once the asset is filed', () => {
    const filed = agent('sp-promo', { trigger: 'filed' });
    expect(ruleWants(filed, setup('Phase 3'))).toBe(false);
    expect(ruleWants(filed, setup('Filed'))).toBe(true);
  });

  it('follows the default for an agent with no trigger', () => {
    expect(ruleWants(agent('reglead', { defaultSelected: true }), setup('Phase 1', []))).toBe(true);
    expect(ruleWants(agent('o-cmc'), setup('Filed', ['orphan', 'paed', 'exp', 'combo', 'cdx']))).toBe(false);
  });
});

describe('selectionAfterSetupChange', () => {
  const change = (before: DdSetup, after: DdSetup, on: string[]) => selectionAfterSetupChange(ROSTER, before, after, on);

  it('brings the late agents in at Phase 3 and nobody else', () => {
    expect(change(setup('Phase 2'), setup('Phase 3'), DEFAULT_ON)).toEqual(idsOn([...DEFAULT_ON, 'ops', 'mw', 'sp-rm']));
  });

  it('brings only the filed agent in when Phase 3 becomes Filed', () => {
    const atPhase3 = idsOn([...DEFAULT_ON, 'ops', 'mw', 'sp-rm']);
    expect(change(setup('Phase 3'), setup('Filed'), atPhase3)).toEqual(idsOn([...atPhase3, 'sp-promo']));
  });

  it('takes the late and filed agents out again when the stage moves back to Phase 2', () => {
    const atFiled = idsOn([...DEFAULT_ON, 'ops', 'mw', 'sp-rm', 'sp-promo']);
    expect(change(setup('Filed'), setup('Phase 2'), atFiled)).toEqual(idsOn(DEFAULT_ON));
  });

  it('changes nothing when the move does not cross a rule (Phase 1 to Phase 2), even for agents chosen by hand', () => {
    const withManual = idsOn([...DEFAULT_ON, 'sp-exp', 'o-cmc']);
    expect(change(setup('Phase 1'), setup('Phase 2'), withManual)).toEqual(withManual);
  });

  it('keeps a late agent that was switched off by hand when a later stage change does not touch it', () => {
    const atPhase3WithoutOps = idsOn([...DEFAULT_ON, 'mw', 'sp-rm']);
    expect(change(setup('Phase 3'), setup('Filed'), atPhase3WithoutOps)).toEqual(idsOn([...atPhase3WithoutOps, 'sp-promo']));
    expect(change(setup('Phase 3'), setup('Filed'), atPhase3WithoutOps)).not.toContain('ops');
  });

  it('keeps an agent chosen by hand when the stage changes', () => {
    expect(change(setup('Phase 2'), setup('Phase 3'), idsOn([...DEFAULT_ON, 'o-cmc']))).toContain('o-cmc');
  });

  it('switches a classification specialist on with its classification, and off with it', () => {
    const on = change(setup('Phase 2', ['orphan', 'paed']), setup('Phase 2', ['orphan', 'paed', 'exp']), DEFAULT_ON);
    expect(on).toEqual(idsOn([...DEFAULT_ON, 'sp-exp']));
    expect(change(setup('Phase 2', ['orphan', 'paed', 'exp']), setup('Phase 2', ['orphan', 'paed']), on)).toEqual(idsOn(DEFAULT_ON));
    // Turning orphan off takes the orphan specialist out even though it is on by default.
    expect(change(setup('Phase 2', ['orphan', 'paed']), setup('Phase 2', ['paed']), DEFAULT_ON)).toEqual(idsOn(DEFAULT_ON.filter((id) => id !== 'sp-orphan')));
  });

  it('applies a stage change and a classification change made together', () => {
    const result = change(setup('Phase 2', ['orphan', 'paed']), setup('Filed', ['paed', 'exp']), DEFAULT_ON);
    expect(result).toEqual(idsOn(['reglead', 'cmcreg', 'sp-paed', 'orc', 'san', 'ops', 'mw', 'sp-rm', 'sp-promo', 'sp-exp']));
  });

  it('never takes a locked agent out, even if it is missing from the saved list', () => {
    const result = change(setup('Filed'), setup('Phase 1', []), ['reglead']);
    expect(result).toContain('orc');
    expect(result).toContain('san');
  });

  it('drops ids that are not in the roster, keeps the roster order and gives the same answer every time', () => {
    const first = change(setup('Phase 2'), setup('Phase 3'), ['sp-paed', 'ghost', 'reglead', 'orc', 'san']);
    expect(first).not.toContain('ghost');
    expect(first).toEqual(ROSTER.map((candidate) => candidate.id).filter((id) => first.includes(id)));
    expect(change(setup('Phase 2'), setup('Phase 3'), ['sp-paed', 'ghost', 'reglead', 'orc', 'san'])).toEqual(first);
  });

  it('does not change the selection when the setup does not change', () => {
    const odd = idsOn(['reglead', 'sp-exp', 'orc', 'san']);
    expect(change(setup('Phase 3'), setup('Phase 3'), odd)).toEqual(odd);
  });
});

describe('selectionReason', () => {
  const reason = (id: string, on: boolean, current: DdSetup = DEFAULT_DD_SETUP) => selectionReason(ROSTER.find((candidate) => candidate.id === id) as RuleAgent, current, on);

  it.each([
    ['a locked team role', 'orc', true, DEFAULT_DD_SETUP, { kind: 'always' }],
    ['a classification specialist that the asset calls for', 'sp-orphan', true, DEFAULT_DD_SETUP, { kind: 'classification', id: 'orphan' }],
    ['a late agent at Phase 3', 'ops', true, setup('Phase 3'), { kind: 'late' }],
    ['the filed agent once filed', 'sp-promo', true, setup('Filed'), { kind: 'filed' }],
    ['a regulatory agent on by default', 'reglead', true, DEFAULT_DD_SETUP, { kind: 'default' }],
    ['an agent switched on by hand', 'sp-exp', true, DEFAULT_DD_SETUP, { kind: 'manual-on' }],
    ['a specialist the asset calls for but a person switched off', 'sp-orphan', false, DEFAULT_DD_SETUP, { kind: 'manual-off' }],
    ['a late agent that a person switched off at Phase 3', 'ops', false, setup('Phase 3'), { kind: 'manual-off' }],
    ['a regulatory agent switched off by hand', 'reglead', false, DEFAULT_DD_SETUP, { kind: 'manual-off' }],
    ['a classification specialist waiting for its classification', 'sp-exp', false, DEFAULT_DD_SETUP, { kind: 'waiting', trigger: 'exp' }],
    ['a late agent before Phase 3', 'ops', false, setup('Phase 2'), { kind: 'waiting', trigger: 'late' }],
    ['the filed agent before filing', 'sp-promo', false, setup('Phase 3'), { kind: 'waiting', trigger: 'filed' }],
    ['an agent built for other playbooks', 'o-cmc', false, DEFAULT_DD_SETUP, { kind: 'not-for-dd' }],
  ] as const)('%s', (_label, id, on, current, expected) => {
    expect(reason(id, on, current)).toEqual(expected);
  });

  it('calls an agent that is on but not wanted by the rule "switched on by you", whatever its trigger', () => {
    expect(reason('sp-exp', true)).toEqual({ kind: 'manual-on' });
    expect(reason('ops', true, setup('Phase 1'))).toEqual({ kind: 'manual-on' });
    expect(reason('o-cmc', true)).toEqual({ kind: 'manual-on' });
  });
});

describe('normalizeDdSetup', () => {
  it('accepts a valid setup and returns it in a fixed shape', () => {
    expect(normalizeDdSetup({ stage: 'Phase 3', classifications: ['paed', 'orphan'] })).toEqual({
      ok: true,
      setup: { stage: 'Phase 3', classifications: ['orphan', 'paed'] },
    });
  });

  it('puts the classifications in the canonical order and removes duplicates', () => {
    expect(normalizeDdSetup({ stage: 'Filed', classifications: ['cdx', 'orphan', 'cdx', 'orphan'] })).toEqual({
      ok: true,
      setup: { stage: 'Filed', classifications: ['orphan', 'cdx'] },
    });
  });

  it('accepts an empty classification list', () => {
    expect(normalizeDdSetup({ stage: 'Phase 1', classifications: [] })).toEqual({ ok: true, setup: { stage: 'Phase 1', classifications: [] } });
  });

  it('ignores extra keys, so a body cannot smuggle in a selection', () => {
    const result = normalizeDdSetup({ stage: 'Phase 2', classifications: ['orphan'], selected: ['reglead'], agentId: 'x' });
    expect(result).toEqual({ ok: true, setup: { stage: 'Phase 2', classifications: ['orphan'] } });
  });

  it.each([
    ['null', null],
    ['a string', 'Phase 2'],
    ['an array', ['Phase 2']],
    ['no stage', { classifications: [] }],
    ['an unknown stage', { stage: 'Phase 4', classifications: [] }],
    ['a stage with another case', { stage: 'phase 2', classifications: [] }],
    ['a numeric stage', { stage: 2, classifications: [] }],
    ['no classifications', { stage: 'Phase 2' }],
    ['classifications that are not a list', { stage: 'Phase 2', classifications: 'orphan' }],
    ['an unknown classification', { stage: 'Phase 2', classifications: ['orphan', 'biosimilar'] }],
    ['a classification that is not a string', { stage: 'Phase 2', classifications: [1] }],
  ])('refuses %s with a message that names the fields', (_label, value) => {
    const result = normalizeDdSetup(value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/stage/);
  });
});
