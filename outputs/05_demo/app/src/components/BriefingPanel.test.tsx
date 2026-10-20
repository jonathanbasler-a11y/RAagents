// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiResult, ChatApi } from '@/client/chat-client';
import { buildBriefing } from '@/shared/briefing';
import { CHECKLIST_ITEM_IDS, LOCAL_PERSON, type BriefingResponse, type Finding, type FindingTag } from '@/shared/contracts';
import { BriefingPanel } from './BriefingPanel';
import { finding } from './findings-fixtures';

const ok = <T,>(data: T): ApiResult<T> => ({ ok: true, data });
const failure = <T,>(message: string, status = 0): ApiResult<T> => ({ ok: false, status, error: null, message });

const ROOM = {
  asOf: '2026-10-12',
  documents: [
    { id: 'DR-01', title: 'Licensor overview', sourceType: 'company-disclosure' as const, publishedAt: '2026-07-14', provided: true, withdrawnAt: null },
    { id: 'DR-09', title: 'Paediatric study plan', sourceType: 'company-disclosure' as const, publishedAt: null, provided: false, withdrawnAt: null },
  ],
};

const accepted = (id: string, overrides: Partial<Finding> = {}) => finding(id, { status: 'accepted', decidedBy: LOCAL_PERSON, decidedAt: '2026-10-12T09:00:00.000Z', ...overrides });
const tag = (findingId: string, checklistItem: FindingTag['checklistItem'], category: FindingTag['category']): FindingTag => ({ findingId, checklistItem, category, taggedAt: 'x', taggedBy: LOCAL_PERSON });
const states = (patch: Record<string, { state: 'checked' | 'not_applicable' | 'could_not_check'; reason?: string }> = {}) =>
  CHECKLIST_ITEM_IDS.map((item) => ({ item, state: patch[item]?.state ?? ('not_checked' as const), reason: patch[item]?.reason ?? null, changedAt: null, changedBy: null }));

function response(overrides: Partial<Parameters<typeof buildBriefing>[0]> = {}): BriefingResponse {
  return {
    workspaceId: 'demo',
    generatedAt: '2026-10-19T10:00:00.000Z',
    briefing: buildBriefing({ dataRoom: ROOM, findings: [], tags: [], openQuestions: [], checklist: states(), ...overrides }),
  };
}

const MIXED = () =>
  response({
    findings: [
      accepted('F-001', { claim: 'The licensor says one study is enough.', decisionNote: 'Matches the minutes.' }),
      accepted('F-002', { claim: 'An orphan designation is held in the US.' }),
      accepted('F-003', { claim: 'Timing of the filing plan.' }),
      accepted('F-004', { claim: 'Accepted but never tagged.' }),
      finding('F-005', { claim: 'Still a draft.' }),
    ],
    tags: [tag('F-001', 'regions', 'risk'), tag('F-002', 'designations', 'positive'), tag('F-003', 'ptrs-inputs', 'neutral')],
    openQuestions: [{ id: 'Q-001', workspaceId: 'demo', claim: 'The paediatric plan is agreed.', reasonCode: 'quote_not_in_document', reason: 'The quote is not in the document.', documentId: 'DR-09', raisedBy: { agentId: 'reglead', agentName: 'Rosa', turnId: 't' }, createdAt: 'x' }],
    checklist: states({ regions: { state: 'checked' }, designations: { state: 'not_applicable', reason: 'Not an orphan product.' }, bottlenecks: { state: 'could_not_check', reason: 'The filing plan was not provided.' } }),
  });

function mount(initial: BriefingResponse | ApiResult<BriefingResponse> = MIXED()) {
  const client = { getBriefing: vi.fn<ChatApi['getBriefing']>().mockResolvedValue('ok' in initial ? initial : ok(initial)) };
  render(<BriefingPanel client={client} />);
  return client;
}

const section = (name: string) => screen.getByRole('region', { name });

afterEach(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

describe('BriefingPanel', () => {
  it('says it is loading, and shows no briefing, until it has one', () => {
    const client = { getBriefing: vi.fn<ChatApi['getBriefing']>().mockReturnValue(new Promise(() => undefined)) };
    render(<BriefingPanel client={client} />);

    expect(screen.getByText('Loading the briefing…')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Risks' })).not.toBeInTheDocument();
  });

  it('offers a retry when it cannot be built, and shows no briefing', async () => {
    const client = mount(failure('Could not reach the server.'));

    expect(await screen.findByRole('alert')).toHaveTextContent('The briefing could not be built. Could not reach the server.');
    client.getBriefing.mockResolvedValue(ok(MIXED()));
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('region', { name: 'Risks' })).toBeInTheDocument();
  });

  it('says first that it is a briefing, not a decision, and what is reserved for people', async () => {
    mount();

    expect(await screen.findByRole('heading', { level: 1, name: 'Briefing' })).toBeInTheDocument();
    expect(screen.getByText(/This is a briefing, not a decision\./)).toBeInTheDocument();
    expect(screen.getByText(/Deal-breakers, the overall assessment and the recommendation are reserved for people\./)).toBeInTheDocument();
    expect(document.querySelector('.bf-notice')).toHaveTextContent(/what the seller states, not verified fact/);
    expect(screen.getByText(/Data room as of 2026-10-12/)).toBeInTheDocument();
  });

  it('puts the warnings first, each in words', async () => {
    mount();

    const warnings = await screen.findByRole('region', { name: 'Before you read' });
    expect(within(warnings).getByText(/1 draft finding is not decided and is not in this briefing\./)).toBeInTheDocument();
    expect(within(warnings).getByText(/1 accepted finding has no checklist item or kind/)).toBeInTheDocument();
    expect(within(warnings).getByText(/3 of 6 checklist items are not checked\./)).toBeInTheDocument();
  });

  it('says "no warnings" when there are none', async () => {
    const all = Object.fromEntries(CHECKLIST_ITEM_IDS.map((item) => [item, { state: 'not_applicable' as const, reason: 'Does not apply.' }]));
    mount(response({ checklist: states(all) }));

    expect(within(await screen.findByRole('region', { name: 'Before you read' })).getByText('No warnings.')).toBeInTheDocument();
  });

  it('lists the six items with the four states apart, reasons, and the findings behind each', async () => {
    mount();

    const checked = within(await screen.findByRole('region', { name: 'What was checked' }));
    const row = (label: string) => checked.getByText(label).closest('li') as HTMLElement;
    expect(row('Regional differences')).toHaveTextContent('Checked. Findings: F-001.');
    expect(row('Special designations')).toHaveTextContent('Checked: not applicable. Reason: Not an orphan product. Findings: F-002.');
    expect(row('Bottleneck hunt')).toHaveTextContent('Could not check. Reason: The filing plan was not provided.');
    expect(row('Applicable guidance')).toHaveTextContent('Not checked.');
    expect(checked.getAllByRole('listitem')).toHaveLength(6);
  });

  it('lists the documents in the data room, including one listed but not provided', async () => {
    mount();

    const checked = await screen.findByRole('region', { name: 'What was checked' });
    expect(checked).toHaveTextContent('DR-09 Paediatric study plan');
    expect(checked).toHaveTextContent('listed, not provided');
  });

  it('shows each sorted finding with its claim, the quote, the source, the basis, the confidence and the note', async () => {
    mount();

    const risks = within(await screen.findByRole('region', { name: 'Risks' }));
    const card = risks.getByRole('article', { name: 'F-001' });
    expect(card).toHaveTextContent('Regional differences');
    expect(within(card).getByText('The licensor says one study is enough.')).toBeInTheDocument();
    expect(card.querySelector('blockquote')).toHaveTextContent('Quote of F-001');
    expect(card).toHaveTextContent('DR-01, Licensor overview (company disclosure, dated 2026-07-14)');
    expect(card).toHaveTextContent('Attributed: what the seller states, not verified fact');
    expect(card).toHaveTextContent('Confidence in the quote: Medium');
    expect(card).toHaveTextContent('Note from the person who accepted it: Matches the minutes.');
    expect(within(section('Positives')).getByRole('article', { name: 'F-002' })).toBeInTheDocument();
    expect(within(section('Neutral')).getByRole('article', { name: 'F-003' })).toBeInTheDocument();
  });

  it('says "None accepted and tagged yet." under an empty section', async () => {
    mount(response());

    expect(within(await screen.findByRole('region', { name: 'Risks' })).getByText('None accepted and tagged yet.')).toBeInTheDocument();
  });

  it('lists an accepted finding with no tag apart, and has no such section otherwise', async () => {
    mount();
    const unsorted = within(await screen.findByRole('region', { name: 'Not yet sorted' }));
    expect(unsorted.getByRole('article', { name: 'F-004' })).toHaveTextContent('Not yet tagged');
  });

  it('has no "not yet sorted" section when every accepted finding is tagged', async () => {
    mount(response({ findings: [accepted('F-001')], tags: [tag('F-001', 'regions', 'risk')] }));

    await screen.findByRole('region', { name: 'Risks' });
    expect(screen.queryByRole('region', { name: 'Not yet sorted' })).not.toBeInTheDocument();
  });

  it('never shows a draft', async () => {
    mount();

    await screen.findByRole('region', { name: 'Risks' });
    expect(screen.queryByText('Still a draft.')).not.toBeInTheDocument();
  });

  it('marks a finding whose document was withdrawn after it was accepted', async () => {
    const room = { ...ROOM, documents: ROOM.documents.map((document) => (document.id === 'DR-01' ? { ...document, withdrawnAt: '2026-10-13T08:00:00.000Z' } : document)) };
    mount(response({ dataRoom: room, findings: [accepted('F-001')], tags: [tag('F-001', 'regions', 'risk')] }));

    const card = within(await screen.findByRole('region', { name: 'Risks' })).getByRole('article', { name: 'F-001' });
    expect(card).toHaveTextContent('Its document has been withdrawn from the data room since it was accepted.');
  });

  it('lists open questions and the items that could not be checked together', async () => {
    mount();

    const open = within(await screen.findByRole('region', { name: 'Open questions' }));
    expect(open.getByText(/Q-001: The paediatric plan is agreed\./)).toBeInTheDocument();
    expect(open.getByText(/Not a finding: The quote is not in the document\./)).toBeInTheDocument();
    expect(open.getByText(/Could not check: Bottleneck hunt\. The filing plan was not provided\./)).toBeInTheDocument();
  });

  it('says the app computes no PTRS number, and lists what feeds it', async () => {
    mount();

    const ptrs = within(await screen.findByRole('region', { name: 'Inputs to the regulatory part of PTRS' }));
    expect(ptrs.getByText(/The app computes no number\./)).toBeInTheDocument();
    expect(ptrs.getByText(/F-003: Timing of the filing plan\./)).toBeInTheDocument();
  });

  it('says there is nothing for PTRS yet when nothing is tagged to it', async () => {
    mount(response());

    expect(within(await screen.findByRole('region', { name: 'Inputs to the regulatory part of PTRS' })).getByText('No accepted finding is tagged to this item yet.')).toBeInTheDocument();
  });

  it('leaves the mitigations to the people', async () => {
    mount();

    expect(within(await screen.findByRole('region', { name: 'Possible mitigations' })).getByText('For the regulatory lead and the functions to add. The app does not draft mitigations.')).toBeInTheDocument();
  });

  it('offers the Markdown download, from the same function the page uses', async () => {
    mount();

    const link = await screen.findByRole('link', { name: 'Download as Markdown' });
    expect(link).toHaveAttribute('href', '/api/briefing?format=markdown');
    expect(link).toHaveAttribute('download');
  });

  it('contains no buy, acquire or go/no-go language', async () => {
    mount();

    await screen.findByRole('region', { name: 'Risks' });
    expect(document.body.textContent).not.toMatch(/\b(buy|acquire|acquisition|go\/no-go)\b/i);
  });

  it('reads the briefing again when the tab becomes visible, and not while it is hidden', async () => {
    const client = mount();
    await screen.findByRole('region', { name: 'Risks' });
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(client.getBriefing).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    await waitFor(() => expect(client.getBriefing).toHaveBeenCalledTimes(2));
  });

  it('keeps the briefing it has when a later read fails', async () => {
    const client = mount();
    await screen.findByRole('region', { name: 'Risks' });
    client.getBriefing.mockResolvedValue(failure('down'));

    document.dispatchEvent(new Event('visibilitychange'));

    await waitFor(() => expect(client.getBriefing).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('region', { name: 'Risks' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
