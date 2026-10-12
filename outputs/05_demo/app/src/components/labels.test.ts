import { describe, expect, it } from 'vitest';
import { AGENT_TRIGGERS } from '@/shared/contracts';
import { GROUP_INFO, PRACTICE_REPLY_LABEL, describeChatError, triggerText } from './labels';

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
