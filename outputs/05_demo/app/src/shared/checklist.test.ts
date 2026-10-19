import { describe, expect, it } from 'vitest';
import { CHECKLIST_ITEM_IDS, CHECKLIST_STATES, FINDING_CATEGORIES } from './contracts';
import {
  CHECKLIST_ITEMS,
  MAX_STATE_REASON_CHARS,
  checkStateChange,
  checkTagInput,
  isChecklistItemId,
  isChecklistState,
  isFindingCategory,
} from './checklist';

// The regulatory checklist: six items, four states that stay apart, and the rule that "checked" needs an accepted
// finding behind it. Everything here is pure; the store and the database enforce the same rules again.

describe('the items', () => {
  it('are the six of the regulatory checklist, each with a label and a hint', () => {
    expect([...CHECKLIST_ITEM_IDS]).toEqual(['guidance', 'designations', 'regions', 'bottlenecks', 'ptrs-inputs', 'hta-handover']);
    for (const id of CHECKLIST_ITEM_IDS) {
      expect(CHECKLIST_ITEMS[id].label.length, id).toBeGreaterThan(3);
      expect(CHECKLIST_ITEMS[id].hint.length, id).toBeGreaterThan(10);
    }
  });

  it('say that reimbursement and HTA risks are flagged and handed over, never assessed, and that the app computes no PTRS number', () => {
    expect(CHECKLIST_ITEMS['hta-handover'].hint).toMatch(/hand them to HEOR/i);
    expect(CHECKLIST_ITEMS['hta-handover'].hint).toMatch(/do not assess/i);
    expect(CHECKLIST_ITEMS['ptrs-inputs'].hint).toMatch(/computes no number/i);
  });

  it('are recognised by exact id only', () => {
    expect(isChecklistItemId('regions')).toBe(true);
    for (const value of ['Regions', 'region', '', null, undefined, 3, {}, 'regions ']) expect(isChecklistItemId(value), String(value)).toBe(false);
  });
});

describe('the four states', () => {
  it('are not checked, checked, not applicable and could not check, in that order', () => {
    expect([...CHECKLIST_STATES]).toEqual(['not_checked', 'checked', 'not_applicable', 'could_not_check']);
  });

  it('are recognised by exact name only', () => {
    expect(isChecklistState('could_not_check')).toBe(true);
    for (const value of ['Checked', 'done', 'not checked', '', null, undefined, 1]) expect(isChecklistState(value), String(value)).toBe(false);
  });
});

describe('checkStateChange', () => {
  const change = (state: unknown, reason: unknown = undefined, acceptedFindings = 0) => checkStateChange({ state, reason, acceptedFindings });

  it('takes "checked" only with at least one accepted finding behind the item', () => {
    expect(change('checked', undefined, 0)).toMatchObject({ ok: false, code: 'needs_finding' });
    expect(change('checked', 'a reason', 0)).toMatchObject({ ok: false, code: 'needs_finding' });
    expect(change('checked', undefined, 1)).toEqual({ ok: true, reason: null });
    expect(change('checked', undefined, 5)).toEqual({ ok: true, reason: null });
  });

  it('keeps an optional note on "checked", trimmed', () => {
    expect(change('checked', '  Reviewed with the minutes.  ', 1)).toEqual({ ok: true, reason: 'Reviewed with the minutes.' });
  });

  it.each(['not_applicable', 'could_not_check'])('needs a reason for %s, and does not need a finding', (state) => {
    expect(change(state, undefined)).toMatchObject({ ok: false, code: 'invalid' });
    expect(change(state, '')).toMatchObject({ ok: false, code: 'invalid' });
    expect(change(state, '   \n ')).toMatchObject({ ok: false, code: 'invalid' });
    expect(change(state, 'Not an orphan product.')).toEqual({ ok: true, reason: 'Not an orphan product.' });
  });

  it('takes a reason of exactly the limit and refuses one character more', () => {
    expect(MAX_STATE_REASON_CHARS).toBe(300);
    expect(change('not_applicable', 'x'.repeat(300))).toMatchObject({ ok: true });
    expect(change('not_applicable', 'x'.repeat(301))).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('lets a person take the mark back, and drops any reason with it', () => {
    expect(change('not_checked', undefined)).toEqual({ ok: true, reason: null });
    expect(change('not_checked', 'changed my mind')).toEqual({ ok: true, reason: null });
  });

  it('refuses a state that is not one of the four, and a reason that is not text', () => {
    for (const state of ['done', 'Checked', '', null, undefined, 7]) expect(change(state, 'r', 1), String(state)).toMatchObject({ ok: false, code: 'invalid' });
    expect(change('not_applicable', 42)).toMatchObject({ ok: false, code: 'invalid' });
    expect(change('checked', { reason: 'x' }, 1)).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('says in words why it refused', () => {
    const refused = change('checked', undefined, 0);
    expect(refused.ok === false && refused.message).toMatch(/at least one accepted finding/);
    const noReason = change('could_not_check');
    expect(noReason.ok === false && noReason.message).toMatch(/reason/);
  });
});

describe('checkTagInput', () => {
  it('takes a known item and a known category', () => {
    expect([...FINDING_CATEGORIES]).toEqual(['positive', 'risk', 'neutral']);
    expect(checkTagInput('regions', 'risk')).toEqual({ ok: true, tag: { checklistItem: 'regions', category: 'risk' } });
    for (const item of CHECKLIST_ITEM_IDS) for (const category of FINDING_CATEGORIES) expect(checkTagInput(item, category)).toMatchObject({ ok: true });
  });

  it('refuses either one missing or unknown, and names which', () => {
    expect(checkTagInput(undefined, 'risk')).toMatchObject({ ok: false });
    expect(checkTagInput('regions', undefined)).toMatchObject({ ok: false });
    const badItem = checkTagInput('everything', 'risk');
    expect(badItem.ok === false && badItem.message).toMatch(/checklist item/);
    const badCategory = checkTagInput('regions', 'good');
    expect(badCategory.ok === false && badCategory.message).toMatch(/a positive, a risk or neutral/);
  });

  it('is exact: another case or spacing is not a tag', () => {
    expect(isFindingCategory('Risk')).toBe(false);
    expect(isFindingCategory('risk ')).toBe(false);
    expect(checkTagInput('Regions', 'risk')).toMatchObject({ ok: false });
  });
});
