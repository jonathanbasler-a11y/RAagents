'use client';

import type { ReactNode } from 'react';
import { CLASSIFICATION_IDS, DEVELOPMENT_STAGES, type AgentId, type ClassificationId, type DevelopmentStage, type PublicAgent } from '@/shared/contracts';
import { useDdSetup } from './DdSetupProvider';
import { CLASSIFICATION_LABELS, teamChangeText } from './labels';

/**
 * The asset's stage and classification. A change is one save: the team follows by the playbook's
 * rule, and the agent cards and the team chat show it. Native radios and checkboxes stay enabled
 * while a save runs (a disabled control drops keyboard focus); the provider ignores changes until it ends.
 */
export function DdSetupPanel({ agents }: { agents: PublicAgent[] }) {
  const state = useDdSetup();
  if (state.status === 'unavailable') return null;

  const { setup, saving } = state;
  const firstName = (id: AgentId) => agents.find((agent) => agent.id === id)?.name ?? id;

  // The provider ignores a change while a save runs, so the handlers need no guard of their own.
  const chooseStage = (stage: DevelopmentStage) => {
    if (!setup) return;
    void state.change({ stage, classifications: setup.classifications });
  };

  const toggleClassification = (id: ClassificationId, on: boolean) => {
    if (!setup) return;
    const chosen = new Set(setup.classifications);
    if (on) chosen.add(id);
    else chosen.delete(id);
    void state.change({ stage: setup.stage, classifications: CLASSIFICATION_IDS.filter((each) => chosen.has(each)) });
  };

  let status: ReactNode = null;
  if (saving) {
    status = 'Saving…';
  } else if (state.saveError) {
    status = (
      <span className="dd-error" role="alert">
        Not saved: {state.saveError.message}
        {state.saveError.correlationId && <span className="mono"> Reference {state.saveError.correlationId}</span>}
      </span>
    );
  } else if (state.lastSave) {
    const { team } = state.lastSave;
    status = team ? teamChangeText(team.joined.map(firstName), team.left.map(firstName)) : 'Saved.';
  } else if (state.source === 'default') {
    status = 'Default setup: nothing saved yet. Change anything to save it.';
  }

  return (
    <section className="sheet dd-setup" aria-labelledby="dd-setup-title">
      <h2 id="dd-setup-title">DD setup</h2>
      <p className="note">
        Stage and classification decide who is on the team. Change them and the team follows, here and in the team
        chat. You can still switch single agents on or off below.
      </p>

      {state.status === 'loading' && <p aria-busy="true">Loading the DD setup…</p>}

      {state.status === 'error' && !setup && (
        <p role="alert">
          The DD setup could not be loaded. {state.loadError?.message}{' '}
          <button type="button" className="btn btn-quiet btn-sm" onClick={state.reload}>
            Retry
          </button>
        </p>
      )}

      {setup && (
        <>
          <div className="dd-groups" aria-busy={saving}>
            <fieldset className="dd-group">
              <legend>Stage</legend>
              <div className="chips">
                {DEVELOPMENT_STAGES.map((stage) => (
                  <label key={stage} className="chip">
                    <input
                      type="radio"
                      name="dd-stage"
                      checked={setup.stage === stage}
                      aria-disabled={saving}
                      onChange={() => chooseStage(stage)}
                    />
                    <span>{stage}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="dd-group">
              <legend>Classification</legend>
              <div className="chips">
                {CLASSIFICATION_IDS.map((id) => (
                  <label key={id} className="chip">
                    <input
                      type="checkbox"
                      checked={setup.classifications.includes(id)}
                      aria-disabled={saving}
                      onChange={(event) => toggleClassification(id, event.target.checked)}
                    />
                    <span>{CLASSIFICATION_LABELS[id]}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          <p className="dd-status" aria-live="polite">
            {status}
          </p>
        </>
      )}
    </section>
  );
}
