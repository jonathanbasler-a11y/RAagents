// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ApiResult, ChatApi } from '@/client/chat-client';
import type { DataRoomResponse, FindingsResponse } from '@/shared/contracts';
import { LOCAL_PERSON } from '@/shared/contracts';
import { DataRoomProvider } from './DataRoomProvider';
import { FindingsPanel } from './FindingsPanel';
import { FindingsProvider } from './FindingsProvider';
import { finding, question } from './findings-fixtures';

const ok = <T,>(data: T): ApiResult<T> => ({ ok: true, data });
const register = (findings: FindingsResponse['findings'] = [], openQuestions: FindingsResponse['openQuestions'] = []): FindingsResponse => ({
  workspaceId: 'demo',
  findings,
  openQuestions,
});

const LIMITS = { documentChars: 12_000, turnChars: 48_000 };
function roomWith(withdrawn: string[] = []): DataRoomResponse {
  return {
    workspaceId: 'demo',
    dataRoom: {
      asOf: '2026-10-12',
      createdAt: '2026-10-12T08:00:00.000Z',
      documents: ['DR-01', 'DR-02'].map((id) => ({
        id,
        title: `Title of ${id}`,
        sourceType: 'company-disclosure' as const,
        publishedAt: '2026-07-01',
        url: null,
        provided: true,
        origin: 'added' as const,
        addedAt: '2026-10-12T08:00:00.000Z',
        withdrawnAt: withdrawn.includes(id) ? '2026-10-12T09:00:00.000Z' : null,
        withdrawnReason: withdrawn.includes(id) ? 'wrong file' : null,
        chars: 100,
      })),
    },
    practiceAvailable: true,
    limits: LIMITS,
  };
}

function setup(initial: FindingsResponse, room: DataRoomResponse = roomWith()) {
  const client = {
    getFindings: vi.fn<ChatApi['getFindings']>().mockResolvedValue(ok(initial)),
    submitFindingDecision: vi.fn<ChatApi['submitFindingDecision']>(),
  };
  const dataRoomClient = {
    getDataRoom: vi.fn<ChatApi['getDataRoom']>().mockResolvedValue(ok(room)),
    getDocument: vi.fn<ChatApi['getDocument']>(),
    startDataRoom: vi.fn<ChatApi['startDataRoom']>(),
    addDocument: vi.fn<ChatApi['addDocument']>(),
    withdrawDocument: vi.fn<ChatApi['withdrawDocument']>(),
  };
  render(
    <DataRoomProvider client={dataRoomClient}>
      <FindingsProvider client={client}>
        <FindingsPanel />
      </FindingsProvider>
    </DataRoomProvider>,
  );
  return client;
}

describe('FindingsPanel', () => {
  it('renders nothing without a provider', () => {
    const { container } = render(<FindingsPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says the app has no login and that a draft is not a finding, in the page head', async () => {
    setup(register());

    expect(await screen.findByRole('heading', { level: 1, name: 'Findings' })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`recorded as “${LOCAL_PERSON.replace(/[()]/g, '\\$&')}”`))).toBeInTheDocument();
    expect(screen.getByText(/A draft is not a finding until a person accepts it/)).toBeInTheDocument();
  });

  it('shows a loading state, never "nothing yet", until the register is read', async () => {
    const client = setup(register());
    expect(screen.getByText('Loading the findings…')).toBeInTheDocument();
    expect(screen.queryByText(/Nothing yet/)).not.toBeInTheDocument();

    await screen.findByText(/Nothing yet/);
    expect(client.getFindings).toHaveBeenCalledTimes(1);
  });

  it('offers a retry when the register cannot be read, and does not claim it is empty', async () => {
    const client = {
      getFindings: vi.fn<ChatApi['getFindings']>().mockResolvedValue({ ok: false, status: 0, error: null, message: 'Could not reach the server.' }),
      submitFindingDecision: vi.fn<ChatApi['submitFindingDecision']>(),
    };
    render(
      <FindingsProvider client={client}>
        <FindingsPanel />
      </FindingsProvider>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('The findings could not be loaded. Could not reach the server.');
    expect(screen.queryByText(/Nothing yet/)).not.toBeInTheDocument();
    client.getFindings.mockResolvedValue(ok(register()));
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText(/Nothing yet/);
  });

  it('shows a draft with its claim, the quote beside its document, and the draft label until a person acts', async () => {
    setup(register([finding('F-001', { claim: 'The licensor says one pivotal study is enough.', quote: 'agreed one adequate and well-controlled pivotal study' })]));

    const card = await screen.findByRole('article', { name: 'F-001' });
    expect(within(card).getByText('Draft: no person has decided')).toBeInTheDocument();
    expect(within(card).getByText('Attributed: what the seller states, not verified fact')).toBeInTheDocument();
    expect(within(card).getByText('The licensor says one pivotal study is enough.')).toBeInTheDocument();
    expect(within(card).getByText('agreed one adequate and well-controlled pivotal study')).toBeInTheDocument();
    const citation = within(card).getByText(/Licensor overview/);
    expect(citation).toHaveTextContent('DR-01, Licensor overview');
    expect(citation).toHaveTextContent('dated 2026-07-14');
    expect(within(card).getByText(/agent output, not evidence/)).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Accept F-001' })).toBeEnabled();
    expect(within(card).getByRole('button', { name: 'Reject F-001' })).toBeEnabled();
  });

  it('accepts with the note, and the card moves to Decided with the honest stamp', async () => {
    const client = setup(register([finding('F-001'), finding('F-002')]));
    client.submitFindingDecision.mockResolvedValue(
      ok({ finding: finding('F-001', { status: 'accepted', decidedAt: '2026-10-12T09:30:00.000Z', decidedBy: LOCAL_PERSON, decisionNote: 'Checked against the label.' }) }),
    );
    const card = await screen.findByRole('article', { name: 'F-001' });

    await userEvent.type(within(card).getByLabelText('Note (optional)'), 'Checked against the label.');
    await userEvent.click(within(card).getByRole('button', { name: 'Accept F-001' }));

    await waitFor(() => expect(client.submitFindingDecision).toHaveBeenCalledWith('F-001', 'accept', 'Checked against the label.'));
    const decided = await screen.findByRole('region', { name: 'Decided' });
    const stamp = within(decided).getByRole('article', { name: 'F-001' });
    expect(stamp).toHaveTextContent('Accepted by person (local, not authenticated) on 2026-10-12.');
    expect(stamp).toHaveTextContent('Note: Checked against the label.');
    expect(within(stamp).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'F-002' })).toBeInTheDocument();
  });

  it('rejects without a note', async () => {
    const client = setup(register([finding('F-001')]));
    client.submitFindingDecision.mockResolvedValue(ok({ finding: finding('F-001', { status: 'rejected', decidedAt: '2026-10-12T09:30:00.000Z', decidedBy: LOCAL_PERSON }) }));

    await userEvent.click(await screen.findByRole('button', { name: 'Reject F-001' }));

    await waitFor(() => expect(client.submitFindingDecision).toHaveBeenCalledWith('F-001', 'reject', ''));
    expect(await screen.findByText(/Rejected by person \(local, not authenticated\)/)).toBeInTheDocument();
  });

  it('keeps the draft and says why when a decision is not saved', async () => {
    const client = setup(register([finding('F-001')]));
    client.submitFindingDecision.mockResolvedValue({
      ok: false,
      status: 409,
      error: { error: 'finding_decided', message: 'This finding was already decided.', correlationId: 'c-7' },
      message: 'This finding was already decided.',
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Accept F-001' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Not saved: This finding was already decided.');
    expect(alert).toHaveTextContent('Reference c-7');
    expect(screen.getByText('Draft: no person has decided')).toBeInTheDocument();
  });

  it('disables Accept, not Reject, when the finding’s document was withdrawn, and says so', async () => {
    setup(register([finding('F-001', { documentId: 'DR-02' })]), roomWith(['DR-02']));

    const card = await screen.findByRole('article', { name: 'F-001' });
    await waitFor(() => expect(within(card).getByRole('button', { name: 'Accept F-001' })).toBeDisabled());
    expect(within(card).getByRole('button', { name: 'Reject F-001' })).toBeEnabled();
    expect(within(card).getByText(/document was withdrawn from the data room, so it cannot be accepted/)).toBeInTheDocument();
  });

  it('lists open questions as not findings and not evidence', async () => {
    setup(register([], [question('Q-001', { claim: 'The label allows a 12-week schedule.', reason: 'The quote is not in the document.' })]));

    const section = await screen.findByRole('region', { name: 'Open questions' });
    expect(within(section).getByText(/not findings and not evidence/)).toBeInTheDocument();
    expect(within(section).getByText('Q-001')).toBeInTheDocument();
    expect(within(section).getByText(/The label allows a 12-week schedule\./)).toBeInTheDocument();
    expect(within(section).getByText(/Not a finding: The quote is not in the document\./)).toBeInTheDocument();
  });

  it('counts drafts, decided findings and open questions', async () => {
    setup(register([finding('F-001'), finding('F-002', { status: 'accepted', decidedBy: LOCAL_PERSON, decidedAt: '2026-10-12T09:00:00.000Z' })], [question('Q-001')]));

    expect(await screen.findByText('1 draft waiting for a person · 1 decided finding · 1 open question')).toBeInTheDocument();
  });
});
