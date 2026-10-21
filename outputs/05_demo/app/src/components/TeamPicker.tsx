'use client';

import { useId, useState } from 'react';
import { andList } from '@/client/timeline';
import type { AgentGroup, PublicAgent } from '@/shared/contracts';
import { GROUP_INFO } from './labels';
import { useSelection } from './SelectionProvider';
import { SelectionSwitch } from './SelectionSwitch';

const GROUP_ORDER = Object.keys(GROUP_INFO) as AgentGroup[];

/**
 * The team chat's own "selected for this DD" list, above the message box: the same switches and
 * the same saved selection as the team overview. A change applies from the next question, because
 * the router reads the saved selection at the start of every turn.
 */
export function TeamPicker({ agents }: { agents: PublicAgent[] }) {
  const selection = useSelection();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (selection.status === 'unavailable') return null;

  const roster = [...agents].sort((a, b) => a.order - b.order);
  const optional = roster.filter((agent) => !agent.locked);
  const alwaysOn = roster.filter((agent) => agent.locked);
  const selected = selection.selected;
  const count = selected ? roster.filter((agent) => agent.locked || selected.has(agent.id)).length : null;

  return (
    <div className="team-picker">
      <button
        type="button"
        className="btn btn-quiet btn-sm"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen(!open)}
      >
        Team for this DD{count !== null && <span className="team-picker-count"> · {count} of {roster.length} on</span>}{' '}
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div id={panelId} className="team-picker-panel" role="group" aria-label="Team for this DD">
          {!selected ? (
            selection.status === 'error' ? (
              <p className="note">
                The selection could not be loaded.{' '}
                <button type="button" className="btn btn-quiet btn-sm" onClick={selection.reload}>
                  Retry
                </button>
              </p>
            ) : (
              <p className="note" aria-busy="true">
                Loading the selection…
              </p>
            )
          ) : (
            <>
              {GROUP_ORDER.map((group) => {
                const members = optional.filter((agent) => agent.group === group);
                if (members.length === 0) return null;
                return (
                  <section key={group} className="tp-group">
                    <h3 className="tp-group-title">{GROUP_INFO[group].label}</h3>
                    <ul className="tp-list">
                      {members.map((agent) => (
                        <li key={agent.id} className="tp-row">
                          <span className="tp-name">{agent.name}</span>
                          <span className="tp-cap">{agent.shortCapability ?? agent.capability}</span>
                          <SelectionSwitch agent={agent} />
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
              {alwaysOn.length > 0 && <p className="note">Always on: {andList(alwaysOn.map((agent) => agent.name))}.</p>}
              <p className="note">A change applies from your next question.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
