import { describe, expect, it } from 'vitest';
import { AGENT_TRIGGERS } from '@/shared/contracts';
import { CLASSIFICATION_LABELS, GROUP_INFO, PRACTICE_REPLY_LABEL, describeChatError, selectionReasonText, teamChangeText, triggerText } from './labels';

describe('practice mode label', () => {
  it('says a practice reply is not AI and not sourced', () => {
    expect(PRACTICE_REPLY_LABEL).toBe('Practice reply · not AI · not sourced');
  });
});

describe('team roles group note', () => {
  it('does not claim every team role answers in every DD: some join only by rule or by @mention', () => {
    expect(GROUP_INFO.role.note).toBe('Always on in every DD. Oskar and Sofia join by rule; Emeka, Saskia and Ruben answer when @mentioned.');
  });
});

describe('specialists group note', () => {
  it('says the DD setup brings them in, and that a hand switch is still possible', () => {
    expect(GROUP_INFO.spec.note).toBe(
      'Brought in by the asset’s classification or stage, set in the DD setup. You can still switch one on or off by hand.',
    );
  });
});

describe('triggerText', () => {
  it('says nothing when an agent has no trigger', () => {
    expect(triggerText(undefined)).toBeNull();
  });

  it('describes the late trigger', () => {
    expect(triggerText('late')).toBe('Usually joins when a filing is near (Phase 3 or filed).');
  });

  it('describes the filed trigger, never as a classification', () => {
    const text = triggerText('filed');
    expect(text).toBe('Joins only when the asset is filed.');
    expect(text).not.toMatch(/classification|undefined/i);
  });

  it('describes a classification trigger by its label', () => {
    expect(triggerText('orphan')).toBe('Usually switched on by the asset classification: Orphan.');
  });

  it('gives every known trigger a readable sentence (no "undefined")', () => {
    for (const trigger of AGENT_TRIGGERS) {
      const text = triggerText(trigger);
      expect(text, trigger).toBeTruthy();
      expect(text, trigger).not.toMatch(/undefined/);
    }
  });
});

describe('describeChatError', () => {
  it('says a shutdown cut the reply off and that what is shown arrived before it stopped, as a service problem', () => {
    expect(describeChatError('server_shutdown')).toEqual({
      kind: 'service',
      title: 'Service problem',
      text: 'The server shut down during this reply. The text shown is what had arrived before it stopped.',
    });
  });

  it('keeps the other codes as they were (positive control)', () => {
    expect(describeChatError('out_of_time')).toMatchObject({ kind: 'service', text: 'The turn ran out of time.' });
    expect(describeChatError(null)).toMatchObject({ kind: 'app', text: 'Something went wrong.' });
  });
});

describe('selectionReasonText', () => {
  it.each([
    [{ kind: 'always' }, undefined, 'Always on: a team role in every DD.'],
    [{ kind: 'classification', id: 'orphan' }, 'orphan', 'On because the asset is classified: Orphan.'],
    [{ kind: 'classification', id: 'cdx' }, 'cdx', 'On because the asset is classified: Companion diagnostic.'],
    [{ kind: 'late' }, 'late', 'On because a filing is near (Phase 3 or filed).'],
    [{ kind: 'filed' }, 'filed', 'On because the asset is filed.'],
    [{ kind: 'default' }, undefined, 'On for every regulatory DD.'],
    [{ kind: 'manual-on' }, 'exp', 'Switched on by you.'],
    [{ kind: 'manual-off' }, undefined, 'Switched off by you (on by default).'],
    [{ kind: 'manual-off' }, 'orphan', 'Switched off by you (the playbook would bring them in: Orphan).'],
    [{ kind: 'manual-off' }, 'late', 'Switched off by you (the playbook would bring them in at Phase 3 or filed).'],
    [{ kind: 'manual-off' }, 'filed', 'Switched off by you (the playbook would bring them in once the asset is filed).'],
    [{ kind: 'waiting', trigger: 'exp' }, 'exp', 'Joins if the asset is classified: Expedited programme.'],
    [{ kind: 'waiting', trigger: 'late' }, 'late', 'Joins when a filing is near (Phase 3 or filed).'],
    [{ kind: 'waiting', trigger: 'filed' }, 'filed', 'Joins only when the asset is filed.'],
    [{ kind: 'not-for-dd' }, undefined, 'Off for a regulatory DD: built for other playbooks.'],
  ] as const)('says %j (trigger %s) as "%s"', (reason, trigger, expected) => {
    expect(selectionReasonText(reason, trigger)).toBe(expected);
  });

  it('has a label for every classification', () => {
    expect(Object.keys(CLASSIFICATION_LABELS).sort()).toEqual(['cdx', 'combo', 'exp', 'orphan', 'paed']);
  });
});

describe('teamChangeText', () => {
  it.each([
    [['Olu'], [], 'Saved. Olu joined the team.'],
    [['Olu', 'Mira'], [], 'Saved. Olu and Mira joined the team.'],
    [['Olu', 'Mira', 'Rhea'], [], 'Saved. Olu, Mira and Rhea joined the team.'],
    [[], ['Eitan'], 'Saved. Eitan left the team.'],
    [['Olu'], ['Eitan', 'Chen'], 'Saved. Olu joined the team; Eitan and Chen left the team.'],
    [[], [], 'Saved. The team stays the same.'],
  ])('joined %j, left %j: "%s"', (joined, left, expected) => {
    expect(teamChangeText(joined, left)).toBe(expected);
  });
});
