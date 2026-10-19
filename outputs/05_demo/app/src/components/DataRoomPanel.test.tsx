// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ApiResult, ChatApi } from '@/client/chat-client';
import type { DataRoomDocument, DataRoomDocumentResponse, DataRoomDocumentSummary, DataRoomResponse } from '@/shared/contracts';
import { DataRoomPanel } from './DataRoomPanel';
import { DataRoomProvider } from './DataRoomProvider';

const ok = <T,>(data: T): ApiResult<T> => ({ ok: true, data });
const failure = <T,>(message: string, correlationId: string | null = null): ApiResult<T> => ({
  ok: false,
  status: 400,
  error: correlationId ? { error: 'invalid_request', message, correlationId } : null,
  message,
});

const LIMITS = { documentChars: 12_000, turnChars: 48_000 };
const AS_OF = '2026-10-12';

function summary(id: string, overrides: Partial<DataRoomDocumentSummary> = {}): DataRoomDocumentSummary {
  return {
    id,
    title: `Title of ${id}`,
    sourceType: 'company-disclosure',
    publishedAt: '2026-07-01',
    url: null,
    provided: true,
    origin: 'added',
    addedAt: '2026-10-12T08:00:00.000Z',
    withdrawnAt: null,
    withdrawnReason: null,
    chars: 1200,
    ...overrides,
  };
}

const NO_ROOM = (practiceAvailable = true): DataRoomResponse => ({ workspaceId: 'demo', dataRoom: null, practiceAvailable, limits: LIMITS });
const room = (documents: DataRoomDocumentSummary[], limits = LIMITS): DataRoomResponse => ({
  workspaceId: 'demo',
  dataRoom: { asOf: AS_OF, createdAt: '2026-10-12T08:00:00.000Z', documents },
  practiceAvailable: true,
  limits,
});
const docReply = (id: string, text = 'The text of the document.'): ApiResult<DataRoomDocumentResponse> =>
  ok({ document: { ...summary(id), text } as DataRoomDocument });

function clientWith(initial: DataRoomResponse) {
  return {
    getDataRoom: vi.fn<ChatApi['getDataRoom']>().mockResolvedValue(ok(initial)),
    getDocument: vi.fn<ChatApi['getDocument']>(),
    startDataRoom: vi.fn<ChatApi['startDataRoom']>(),
    addDocument: vi.fn<ChatApi['addDocument']>(),
    withdrawDocument: vi.fn<ChatApi['withdrawDocument']>(),
  };
}

function renderPanel(client: ReturnType<typeof clientWith>, today = '2026-10-19') {
  return render(
    <DataRoomProvider client={client}>
      <DataRoomPanel today={today} />
    </DataRoomProvider>,
  );
}

const rowOf = (id: string) => screen.getByRole('row', { name: new RegExp(`^${id}\\b`) });

describe('DataRoomPanel: before there is a room', () => {
  it('shows nothing to choose while it loads: not knowing is not "no data room"', () => {
    renderPanel(clientWith(NO_ROOM()));

    expect(screen.getByText('Loading the data room…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /practice/i })).not.toBeInTheDocument();
  });

  it('says it could not be loaded, and retries', async () => {
    const user = userEvent.setup();
    const client = clientWith(NO_ROOM());
    client.getDataRoom.mockResolvedValueOnce(failure('Could not reach the server.')).mockResolvedValueOnce(ok(room([summary('DR-01')])));
    renderPanel(client);

    expect(await screen.findByRole('alert')).toHaveTextContent('The data room could not be loaded');
    await user.click(screen.getByRole('button', { name: /retry/i }));

    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('offers the practice case and an empty room, and says what each is', async () => {
    renderPanel(clientWith(NO_ROOM()));

    expect(await screen.findByRole('button', { name: 'Load the practice data room' })).toBeEnabled();
    expect(screen.getByText(/invented/i)).toBeInTheDocument();
    expect(screen.getByLabelText('As-of date')).toHaveValue('2026-10-19');
    expect(screen.getByRole('button', { name: 'Start an empty data room' })).toBeInTheDocument();
    expect(screen.getByText(/cannot change the date later/i)).toBeInTheDocument();
  });

  it('says the practice case is not installed here, and does not offer to load it', async () => {
    renderPanel(clientWith(NO_ROOM(false)));

    expect(await screen.findByRole('button', { name: 'Load the practice data room' })).toBeDisabled();
    expect(screen.getByText(/not installed here/i)).toBeInTheDocument();
  });

  it('loads the practice case, and then shows the room', async () => {
    const user = userEvent.setup();
    const client = clientWith(NO_ROOM());
    client.startDataRoom.mockResolvedValue(ok(room([summary('DR-01'), summary('DR-09', { provided: false, publishedAt: null, chars: 0 })])));
    renderPanel(client);

    await user.click(await screen.findByRole('button', { name: 'Load the practice data room' }));

    expect(client.startDataRoom).toHaveBeenCalledWith({ practice: true });
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load the practice data room' })).not.toBeInTheDocument();
  });

  it('starts an empty room with the date in the box', async () => {
    const user = userEvent.setup();
    const client = clientWith(NO_ROOM());
    client.startDataRoom.mockResolvedValue(ok(room([])));
    renderPanel(client);
    const date = await screen.findByLabelText('As-of date');
    await user.clear(date);
    await user.type(date, '2026-09-01');

    await user.click(screen.getByRole('button', { name: 'Start an empty data room' }));

    expect(client.startDataRoom).toHaveBeenCalledWith({ asOf: '2026-09-01' });
    expect(await screen.findByText(/No documents yet/)).toBeInTheDocument();
  });

  it('does not send a date that is not a date, and says so', async () => {
    const user = userEvent.setup();
    const client = clientWith(NO_ROOM());
    renderPanel(client);
    const date = await screen.findByLabelText('As-of date');
    await user.clear(date);

    await user.click(screen.getByRole('button', { name: 'Start an empty data room' }));

    expect(client.startDataRoom).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/real date/i);
  });

  it('keeps the choices and shows why when starting is refused, with the reference', async () => {
    const user = userEvent.setup();
    const client = clientWith(NO_ROOM());
    client.startDataRoom.mockResolvedValue(failure('This workspace already has a data room.', 'corr-r1'));
    renderPanel(client);

    await user.click(await screen.findByRole('button', { name: 'Load the practice data room' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Not saved: This workspace already has a data room.');
    expect(alert).toHaveTextContent('corr-r1');
    expect(screen.getByRole('button', { name: 'Load the practice data room' })).toBeEnabled();
  });
});

describe('DataRoomPanel: the room', () => {
  it('shows the as-of date, what the agents will see, and why a document is not shown', async () => {
    const small = { documentChars: 12_000, turnChars: 2_500 };
    renderPanel(
      clientWith(
        room(
          [
            summary('DR-01', { chars: 1200 }),
            summary('DR-02', { chars: 1200 }),
            summary('DR-03', { chars: 1200 }),
            summary('DR-04', { provided: false, publishedAt: null, chars: 0 }),
            summary('DR-05', { withdrawnAt: '2026-10-12T09:00:00.000Z', withdrawnReason: 'wrong file', chars: 800 }),
          ],
          small,
        ),
      ),
    );

    expect(await screen.findByText(/As of 2026-10-12/)).toBeInTheDocument();
    expect(within(rowOf('DR-01')).getByText('Agents see it')).toBeInTheDocument();
    expect(within(rowOf('DR-02')).getByText('Agents see it')).toBeInTheDocument();
    expect(within(rowOf('DR-03')).getByText('Not shown: it did not fit')).toBeInTheDocument();
    expect(within(rowOf('DR-04')).getByText('Listed, not provided')).toBeInTheDocument();
    expect(within(rowOf('DR-05')).getByText('Withdrawn')).toBeInTheDocument();
    expect(within(rowOf('DR-05')).getByText(/wrong file/)).toBeInTheDocument();
    expect(screen.getByText(/5 documents: 2 shown to the agents, 3 not shown/)).toBeInTheDocument();
  });

  it('shows each document with its source type, date and size', async () => {
    renderPanel(clientWith(room([summary('DR-02', { sourceType: 'agency-record', publishedAt: '2026-03-20', chars: 1500 })])));

    const row = within(await screen.findByRole('row', { name: /^DR-02/ }));
    expect(row.getByText('Title of DR-02')).toBeInTheDocument();
    expect(row.getByText('agency record')).toBeInTheDocument();
    expect(row.getByText('2026-03-20')).toBeInTheDocument();
    expect(row.getByText('1,500 characters')).toBeInTheDocument();
  });

  it('says a room with no document yet is empty', async () => {
    renderPanel(clientWith(room([])));

    expect(await screen.findByText(/No documents yet/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('reads a document: loads its text, shows it, and closes it again', async () => {
    const user = userEvent.setup();
    const client = clientWith(room([summary('DR-01')]));
    client.getDocument.mockResolvedValue(docReply('DR-01', 'Line one.\nLine two.'));
    renderPanel(client);

    await user.click(await screen.findByRole('button', { name: 'Read DR-01' }));

    expect(client.getDocument).toHaveBeenCalledWith('DR-01');
    expect(await screen.findByText(/Line one\./)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close DR-01' }));
    expect(screen.queryByText(/Line one\./)).not.toBeInTheDocument();
  });

  it('says so when a document cannot be read', async () => {
    const user = userEvent.setup();
    const client = clientWith(room([summary('DR-01')]));
    client.getDocument.mockResolvedValue(failure('There is no such document in the data room.'));
    renderPanel(client);

    await user.click(await screen.findByRole('button', { name: 'Read DR-01' }));

    expect(await screen.findByText(/could not be read/i)).toBeInTheDocument();
  });

  it('has nothing to read for a document that was never provided', async () => {
    renderPanel(clientWith(room([summary('DR-09', { provided: false, publishedAt: null, chars: 0 })])));

    await screen.findByRole('table');

    expect(screen.queryByRole('button', { name: 'Read DR-09' })).not.toBeInTheDocument();
  });

  it('withdraws a document only with a reason, and then shows it withdrawn', async () => {
    const user = userEvent.setup();
    const client = clientWith(room([summary('DR-01')]));
    client.withdrawDocument.mockResolvedValue(docReply('DR-01'));
    renderPanel(client);

    await user.click(await screen.findByRole('button', { name: 'Withdraw DR-01' }));
    await user.click(screen.getByRole('button', { name: 'Confirm withdrawal of DR-01' }));
    expect(client.withdrawDocument).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/reason/i);

    client.getDataRoom.mockResolvedValue(ok(room([summary('DR-01', { withdrawnAt: '2026-10-12T09:00:00.000Z', withdrawnReason: 'wrong file' })])));
    await user.type(screen.getByLabelText('Why is DR-01 being withdrawn?'), 'wrong file');
    await user.click(screen.getByRole('button', { name: 'Confirm withdrawal of DR-01' }));

    expect(client.withdrawDocument).toHaveBeenCalledWith('DR-01', 'wrong file');
    expect(await within(rowOf('DR-01')).findByText('Withdrawn')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Withdraw DR-01' })).not.toBeInTheDocument();
  });

  it('lets a withdrawal be cancelled', async () => {
    const user = userEvent.setup();
    const client = clientWith(room([summary('DR-01')]));
    renderPanel(client);

    await user.click(await screen.findByRole('button', { name: 'Withdraw DR-01' }));
    await user.click(screen.getByRole('button', { name: 'Cancel withdrawal of DR-01' }));

    expect(screen.queryByLabelText('Why is DR-01 being withdrawn?')).not.toBeInTheDocument();
    expect(client.withdrawDocument).not.toHaveBeenCalled();
  });
});

describe('DataRoomPanel: adding a document', () => {
  async function fill(user: ReturnType<typeof userEvent.setup>, fields: { title?: string; date?: string; text?: string; url?: string } = {}) {
    await user.type(await screen.findByLabelText('Title'), fields.title ?? 'Clinical summary');
    if (fields.date !== '') await user.type(screen.getByLabelText('Dated'), fields.date ?? '2026-07-30');
    if (fields.url) await user.type(screen.getByLabelText('Address (optional)'), fields.url);
    await user.type(screen.getByLabelText('Text'), fields.text ?? 'Topline table text.');
  }

  it('adds a document with the fields as typed, then clears the form and shows the new list', async () => {
    const user = userEvent.setup();
    const client = clientWith(room([summary('DR-01')]));
    client.addDocument.mockResolvedValue(docReply('DR-02'));
    renderPanel(client);
    await fill(user, { url: 'https://example.org/summary' });
    await user.selectOptions(screen.getByLabelText('Source'), 'agency-record');
    client.getDataRoom.mockResolvedValue(ok(room([summary('DR-01'), summary('DR-02', { title: 'Clinical summary' })])));

    await user.click(screen.getByRole('button', { name: 'Add to the data room' }));

    expect(client.addDocument).toHaveBeenCalledWith({
      title: 'Clinical summary',
      sourceType: 'agency-record',
      publishedAt: '2026-07-30',
      url: 'https://example.org/summary',
      provided: true,
      text: 'Topline table text.',
    });
    expect(await screen.findByRole('row', { name: /^DR-02/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('');
    expect(screen.getByLabelText('Text')).toHaveValue('');
  });

  it('counts the characters against the limit', async () => {
    const user = userEvent.setup();
    renderPanel(clientWith(room([])));
    await user.type(await screen.findByLabelText('Text'), 'Hello');

    expect(screen.getByText('5 of 12,000 characters')).toBeInTheDocument();
  });

  it('does not send a document the rules refuse, and says which rule: dated after the as-of date', async () => {
    const user = userEvent.setup();
    const client = clientWith(room([]));
    renderPanel(client);
    await fill(user, { date: '2026-10-13' });

    await user.click(screen.getByRole('button', { name: 'Add to the data room' }));

    expect(client.addDocument).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/after the as-of date 2026-10-12/);
    expect(screen.getByLabelText('Title')).toHaveValue('Clinical summary');
  });

  it('does not send a document with no title', async () => {
    const user = userEvent.setup();
    const client = clientWith(room([]));
    renderPanel(client);
    await fill(user, { title: ' ' });

    await user.click(screen.getByRole('button', { name: 'Add to the data room' }));

    expect(client.addDocument).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/title/i);
  });

  it('lists a document that is not provided: no date and no text are asked for', async () => {
    const user = userEvent.setup();
    const client = clientWith(room([]));
    client.addDocument.mockResolvedValue(docReply('DR-01'));
    renderPanel(client);
    await user.type(await screen.findByLabelText('Title'), 'Paediatric study plan');
    // A date typed before the box is ticked is not sent: a document that is not provided has none.
    await user.type(screen.getByLabelText('Dated'), '2026-07-30');
    await user.click(screen.getByLabelText('Listed in the index but not provided'));

    expect(screen.getByLabelText('Dated')).toBeDisabled();
    expect(screen.getByLabelText('Text')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Add to the data room' }));

    expect(client.addDocument).toHaveBeenCalledWith({
      title: 'Paediatric study plan',
      sourceType: 'company-disclosure',
      publishedAt: null,
      url: null,
      provided: false,
      text: null,
    });
  });

  it('keeps what was typed and shows why when the server refuses the document, with the reference', async () => {
    const user = userEvent.setup();
    const client = clientWith(room([]));
    client.addDocument.mockResolvedValue(failure('Something the server did not like.', 'corr-a9'));
    renderPanel(client);
    await fill(user);

    await user.click(screen.getByRole('button', { name: 'Add to the data room' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Not saved: Something the server did not like.');
    expect(alert).toHaveTextContent('corr-a9');
    expect(screen.getByLabelText('Title')).toHaveValue('Clinical summary');
    expect(screen.getByLabelText('Text')).toHaveValue('Topline table text.');
  });

  it('limits the date box to the as-of date', async () => {
    renderPanel(clientWith(room([])));

    expect(await screen.findByLabelText('Dated')).toHaveAttribute('max', AS_OF);
  });
});
