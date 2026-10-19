import { describe, expect, it } from 'vitest';
import { AGENT_TRIGGERS } from '@/shared/contracts';
import { CLASSIFICATION_LABELS, DOCUMENT_STATE_LABELS, GROUP_INFO, dataRoomTraceText, evidenceBannerText, homeLedeText, phaseLineText, PRACTICE_REPLY_LABEL, describeChatError, selectionReasonText, teamChangeText, triggerText } from './labels';

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

describe('what the wording says about documents', () => {
  const MODEL = 'Agent replies are model output, not sources.';
  const STAND_IN = 'Replies in practice mode are stand-in text, not model output and not sources.';

  it('keeps the old line when no documents are connected', () => {
    expect(phaseLineText('none', 'live', 0)).toBe(`In this phase no documents and no tools are connected. ${MODEL}`);
    expect(phaseLineText('none', 'practice', 0)).toBe(`In this phase no documents and no tools are connected. ${STAND_IN}`);
  });

  it('says a data room is connected, with how many documents the agents see, and still no tools', () => {
    expect(phaseLineText('connected', 'live', 9)).toBe(`A data room is connected (9 documents shown to the agents). No tools are. ${MODEL}`);
    expect(phaseLineText('connected', 'live', 1)).toBe(`A data room is connected (1 document shown to the agents). No tools are. ${MODEL}`);
    expect(phaseLineText('connected', 'practice', 2)).toBe(`A data room is connected (2 documents shown to the agents). No tools are. ${STAND_IN}`);
  });

  it('claims nothing about documents while it is not known whether there is a data room', () => {
    expect(phaseLineText('unknown', 'live', 0)).toBe(`No tools are connected. ${MODEL}`);
    expect(phaseLineText('unknown', 'practice', 0)).toBe(`No tools are connected. ${STAND_IN}`);
    expect(phaseLineText('unknown', 'live', 0)).not.toMatch(/document/i);
  });

  it('says the same three things on the home page', () => {
    expect(homeLedeText('none')).toMatch(/the agents have no documents and no tools/);
    expect(homeLedeText('connected')).toMatch(/read the documents of the data room and cite them by id; they have no tools/);
    expect(homeLedeText('connected')).not.toMatch(/no documents/);
    expect(homeLedeText('unknown')).not.toMatch(/document/i);
    for (const kind of ['none', 'connected', 'unknown'] as const) expect(homeLedeText(kind)).toMatch(/model output, not a source/);
  });

  it('tells the evidence checker\'s room what he can and cannot check', () => {
    expect(evidenceBannerText('none', 'Emeka')).toBe(
      'No documents are connected yet, so Emeka cannot verify anything. He can explain what evidence a claim would need.',
    );
    expect(evidenceBannerText('connected', 'Emeka')).toBe(
      'Emeka can check a claim against the documents of the data room and name the document that shows it. He has no tools, so he cannot look anything up outside it.',
    );
    expect(evidenceBannerText('unknown', 'Emeka')).toBe('Emeka has no tools, so he cannot look anything up himself.');
  });
});

describe('dataRoomTraceText', () => {
  it('says what the agents of a turn saw of the data room, and what they did not and why', () => {
    expect(
      dataRoomTraceText({
        asOf: '2026-10-12',
        shown: ['DR-01', 'DR-02'],
        notShown: [
          { id: 'DR-03', reason: 'too_large' },
          { id: 'DR-09', reason: 'not_provided' },
          { id: 'DR-10', reason: 'withdrawn' },
          { id: 'DR-11', reason: 'after_as_of' },
        ],
      }),
    ).toBe(
      'As of 2026-10-12. Shown: DR-01, DR-02. Not shown: DR-03 (did not fit), DR-09 (listed, not provided), DR-10 (withdrawn), DR-11 (dated after the as-of date).',
    );
  });

  it('leaves out the part that has nothing in it, and says "none" when nothing was shown', () => {
    expect(dataRoomTraceText({ asOf: '2026-10-12', shown: ['DR-01'], notShown: [] })).toBe('As of 2026-10-12. Shown: DR-01.');
    expect(dataRoomTraceText({ asOf: '2026-10-12', shown: [], notShown: [] })).toBe('As of 2026-10-12. Shown: none.');
  });
});

describe('DOCUMENT_STATE_LABELS', () => {
  it('says in plain words what the agents do with each document', () => {
    expect(DOCUMENT_STATE_LABELS).toEqual({
      shown: 'Agents see it',
      not_provided: 'Listed, not provided',
      withdrawn: 'Withdrawn',
      after_as_of: 'Not shown: dated after the as-of date',
      too_large: 'Not shown: it did not fit',
    });
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
