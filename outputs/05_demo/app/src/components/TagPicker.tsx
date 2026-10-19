'use client';

import { CHECKLIST_ITEM_IDS, FINDING_CATEGORIES, type ChecklistItemId, type FindingCategory } from '@/shared/contracts';
import { CHECKLIST_ITEMS, isChecklistItemId, isFindingCategory } from '@/shared/checklist';
import { FINDING_CATEGORY_LABELS } from './labels';

/**
 * The two choices a person makes about an accepted finding: which checklist item it supports, and whether it is a
 * positive, a risk or neutral. Nothing is preselected, so accepting is never done by habit. An empty choice is "".
 */
export interface TagChoice {
  item: ChecklistItemId | '';
  category: FindingCategory | '';
}

export const NO_CHOICE: TagChoice = { item: '', category: '' };

export const isCompleteChoice = (choice: TagChoice): choice is { item: ChecklistItemId; category: FindingCategory } =>
  isChecklistItemId(choice.item) && isFindingCategory(choice.category);

export function TagPicker({
  findingId,
  choice,
  onChange,
  disabled,
}: {
  findingId: string;
  choice: TagChoice;
  onChange: (choice: TagChoice) => void;
  disabled: boolean;
}) {
  return (
    <div className="fd-tag">
      <label className="dr-field">
        <span>Supports checklist item</span>
        <select
          className="input"
          aria-label={`Checklist item for ${findingId}`}
          value={choice.item}
          disabled={disabled}
          onChange={(event) => onChange({ ...choice, item: event.target.value as TagChoice['item'] })}
        >
          <option value="">Choose…</option>
          {CHECKLIST_ITEM_IDS.map((id) => (
            <option key={id} value={id}>
              {CHECKLIST_ITEMS[id].label}
            </option>
          ))}
        </select>
      </label>
      <label className="dr-field">
        <span>Kind of finding</span>
        <select
          className="input"
          aria-label={`Kind of finding for ${findingId}`}
          value={choice.category}
          disabled={disabled}
          onChange={(event) => onChange({ ...choice, category: event.target.value as TagChoice['category'] })}
        >
          <option value="">Choose…</option>
          {FINDING_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {FINDING_CATEGORY_LABELS[category]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
