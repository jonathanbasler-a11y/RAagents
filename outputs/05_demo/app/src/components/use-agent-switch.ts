import type { PublicAgent } from '@/shared/contracts';
import { useDdSetup } from './DdSetupProvider';
import { useSelection, type SelectionProblem } from './SelectionProvider';

/**
 * What a control for "selected for this DD" may show for one agent. Every such control (the
 * switch, the "Add" button in the thread) takes its states from here, so the rules live once:
 * - a locked team role is always on and cannot be changed;
 * - while the saved selection is unknown, nothing says on or off: unknown is never shown as off;
 * - a change waits while the DD setup is being saved, because that save rewrites the selection.
 */
export type AgentSwitchState =
  /** No selection provider: nothing is shown. */
  | { kind: 'hidden' }
  | { kind: 'locked' }
  /** The selection could not be loaded and nothing is known. */
  | { kind: 'failed'; reload: () => void }
  | { kind: 'loading' }
  | {
      kind: 'ready';
      on: boolean;
      saving: boolean;
      /** Saving this agent, or the DD setup. */
      disabled: boolean;
      problem: SelectionProblem | undefined;
      set: (on: boolean) => void;
    };

export function useAgentSwitch(agent: PublicAgent): AgentSwitchState {
  const selection = useSelection();
  const setupSaving = useDdSetup().saving;

  if (agent.locked) return { kind: 'locked' };
  if (selection.status === 'unavailable') return { kind: 'hidden' };
  if (selection.status === 'error' && !selection.selected) return { kind: 'failed', reload: selection.reload };
  if (!selection.selected) return { kind: 'loading' };

  const saving = selection.saving.has(agent.id);
  return {
    kind: 'ready',
    on: selection.selected.has(agent.id),
    saving,
    disabled: saving || setupSaving,
    problem: selection.saveErrors[agent.id],
    set: (on) => void selection.setSelected(agent.id, on),
  };
}
