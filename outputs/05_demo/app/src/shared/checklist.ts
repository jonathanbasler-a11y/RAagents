import {
  CHECKLIST_ITEM_IDS,
  CHECKLIST_STATES,
  FINDING_CATEGORIES,
  type ChecklistItemId,
  type ChecklistState,
  type FindingCategory,
  type FindingTagInput,
} from './contracts';

// The regulatory checklist of the DD playbook (CLAUDE.md, "Regulatory checklist") and the rules around it. Pure, so the
// store, the API, the page and the tests all use the same ones.
//
// Four states, kept apart: not checked (the default), checked, checked: not applicable, could not check. A person sets
// every state; "checked" needs at least one accepted finding tagged to the item; the two states that say "this did not
// get done the usual way" need a reason, so that nothing is skipped silently.

export const MAX_STATE_REASON_CHARS = 300;

export const CHECKLIST_ITEMS: Record<ChecklistItemId, { label: string; hint: string }> = {
  guidance: {
    label: 'Applicable guidance',
    hint: 'The regulatory guidance that applies to the therapeutic area and the product type.',
  },
  designations: {
    label: 'Special designations',
    hint: 'Orphan, breakthrough, paediatric requirements and similar designations.',
  },
  regions: {
    label: 'Regional differences',
    hint: 'FDA, EMA, Japan, China and global access; tailored to the product.',
  },
  bottlenecks: {
    label: 'Bottleneck hunt',
    hint: 'What could make approval hard in any region.',
  },
  'ptrs-inputs': {
    label: 'Inputs to the regulatory part of PTRS',
    hint: 'Check that the right information feeds the calculation. The app computes no number.',
  },
  'hta-handover': {
    label: 'Reimbursement and HTA risks',
    hint: 'Flag them and hand them to HEOR. Do not assess them.',
  },
};

export const isChecklistItemId = (value: unknown): value is ChecklistItemId =>
  typeof value === 'string' && (CHECKLIST_ITEM_IDS as readonly string[]).includes(value);

export const isChecklistState = (value: unknown): value is ChecklistState =>
  typeof value === 'string' && (CHECKLIST_STATES as readonly string[]).includes(value);

export const isFindingCategory = (value: unknown): value is FindingCategory =>
  typeof value === 'string' && (FINDING_CATEGORIES as readonly string[]).includes(value);

export type TagCheck = { ok: true; tag: FindingTagInput } | { ok: false; message: string };

/** A tag names one checklist item and one category, exactly as spelled. */
export function checkTagInput(item: unknown, category: unknown): TagCheck {
  if (!isChecklistItemId(item)) return { ok: false, message: `Name the checklist item the finding supports: one of ${CHECKLIST_ITEM_IDS.join(', ')}.` };
  if (!isFindingCategory(category)) return { ok: false, message: `Say whether the finding is a positive, a risk or neutral: ${FINDING_CATEGORIES.join(', ')}.` };
  return { ok: true, tag: { checklistItem: item, category } };
}

export type StateCheck = { ok: true; reason: string | null } | { ok: false; code: 'invalid' | 'needs_finding'; message: string };

/**
 * Whether a person may move an item to a state. `acceptedFindings` is how many accepted findings are tagged to the item.
 * Returns the reason to store (trimmed; none for "not checked").
 */
export function checkStateChange(input: { state: unknown; reason: unknown; acceptedFindings: number }): StateCheck {
  const { state } = input;
  if (!isChecklistState(state)) return { ok: false, code: 'invalid', message: `The state must be one of: ${CHECKLIST_STATES.join(', ')}.` };
  if (input.reason !== undefined && input.reason !== null && typeof input.reason !== 'string') {
    return { ok: false, code: 'invalid', message: 'The reason must be text.' };
  }
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reason.length > MAX_STATE_REASON_CHARS) {
    return { ok: false, code: 'invalid', message: `The reason is longer than ${MAX_STATE_REASON_CHARS} characters.` };
  }
  if (state === 'not_checked') return { ok: true, reason: null };
  if (state === 'checked') {
    if (input.acceptedFindings < 1) {
      return { ok: false, code: 'needs_finding', message: 'An item can be marked checked only when at least one accepted finding is tagged to it.' };
    }
    return { ok: true, reason: reason === '' ? null : reason };
  }
  if (reason === '') {
    return { ok: false, code: 'invalid', message: 'Give the reason: one short sentence on why it does not apply, or why it could not be checked.' };
  }
  return { ok: true, reason };
}
