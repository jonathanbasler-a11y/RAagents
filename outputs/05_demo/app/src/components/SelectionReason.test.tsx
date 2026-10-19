// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ApiResult, ChatApi } from '@/client/chat-client';
import { CYRUS, EMEKA, OLU, OONA, ROSA } from '@/client/test-fixtures';
import type { DdSetup, DdSetupResponse, PublicAgent, SelectionResponse } from '@/shared/contracts';
import { DdSetupProvider } from './DdSetupProvider';
import { SelectionProvider } from './SelectionProvider';
import { SelectionReason } from './SelectionReason';

const ok = <T,>(data: T): ApiResult<T> => ({ ok: true, data });

function renderReason(agent: PublicAgent, selected: string[], setup: DdSetup) {
  const client = {
    getSelection: vi
      .fn<ChatApi['getSelection']>()
      .mockResolvedValue(ok<SelectionResponse>({ workspaceId: 'demo', selected, source: 'saved' })),
    setSelection: vi.fn<ChatApi['setSelection']>(),
    getDdSetup: vi.fn<ChatApi['getDdSetup']>().mockResolvedValue(
      ok<DdSetupResponse>({
        workspaceId: 'demo',
        setup,
        source: 'saved',
        selection: { workspaceId: 'demo', selected, source: 'saved' },
      }),
    ),
    setDdSetup: vi.fn<ChatApi['setDdSetup']>(),
  };
  return render(
    <SelectionProvider client={client}>
      <DdSetupProvider client={client}>
        <SelectionReason agent={agent} />
      </DdSetupProvider>
    </SelectionProvider>,
  );
}

const PHASE_2: DdSetup = { stage: 'Phase 2', classifications: ['orphan'] };
const PHASE_3: DdSetup = { stage: 'Phase 3', classifications: ['orphan'] };

describe('SelectionReason', () => {
  it.each([
    ['a team role', EMEKA, ['ev'], PHASE_2, 'Always on: a team role in every DD.'],
    ['an agent on for every regulatory DD', ROSA, ['reglead'], PHASE_2, 'On for every regulatory DD.'],
    ['an agent on by classification', OONA, ['sp-orphan'], PHASE_2, 'On because the asset is classified: Orphan.'],
    ['an agent waiting for a filing', OLU, [], PHASE_2, 'Joins when a filing is near (Phase 3 or filed).'],
    ['an agent brought in by a late stage', OLU, ['ops'], PHASE_3, 'On because a filing is near (Phase 3 or filed).'],
    ['an agent switched on by hand', OLU, ['ops'], PHASE_2, 'Switched on by you.'],
    [
      'an agent switched off by hand',
      OONA,
      [],
      PHASE_2,
      'Switched off by you (the playbook would bring them in: Orphan).',
    ],
    ['an agent built for other playbooks', CYRUS, [], PHASE_2, 'Off for a regulatory DD: built for other playbooks.'],
  ] as const)('says why for %s', async (_label, agent, selected, setup, expected) => {
    renderReason(agent, [...selected], setup);

    expect(await screen.findByText(expected)).toBeInTheDocument();
  });

  it('shows the agent\'s usual trigger, not a claim about this DD, while the setup or the selection is unknown', () => {
    renderReason(OONA, ['sp-orphan'], PHASE_2);

    expect(screen.getByText('Usually switched on by the asset classification: Orphan.')).toBeInTheDocument();
    expect(screen.queryByText(/On because/)).not.toBeInTheDocument();
  });

  it('shows nothing for an agent with no trigger while it is unknown', () => {
    const { container } = renderReason(ROSA, ['reglead'], PHASE_2);

    expect(container).toBeEmptyDOMElement();
  });

  it('shows the usual trigger when there is no provider at all', () => {
    render(<SelectionReason agent={OONA} />);

    expect(screen.getByText('Usually switched on by the asset classification: Orphan.')).toBeInTheDocument();
  });
});
