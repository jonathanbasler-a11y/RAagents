'use client';

import type { PublicAgent } from '@/shared/contracts';
import { selectionReason } from '@/shared/dd-setup';
import { useDdSetup } from './DdSetupProvider';
import { selectionReasonText, triggerText } from './labels';
import { useSelection } from './SelectionProvider';

/**
 * One line on an agent's card: why it is on or off for this DD. While the selection or the setup
 * is unknown, only the agent's usual trigger is shown: no claim about this DD is made.
 */
export function SelectionReason({ agent }: { agent: PublicAgent }) {
  const { selected } = useSelection();
  const { setup } = useDdSetup();

  if (!selected || !setup) {
    const usual = triggerText(agent.trigger);
    return usual ? <p className="trig">{usual}</p> : null;
  }

  return <p className="trig">{selectionReasonText(selectionReason(agent, setup, selected.has(agent.id)), agent.trigger)}</p>;
}
