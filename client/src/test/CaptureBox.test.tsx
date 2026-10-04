import { act, render, screen, fireEvent, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaptureResponseBody } from 'shared/capture-grammar';
import { CaptureBox } from '@/components/capture/CaptureBox';
import { TestWrapper } from './wrapper';
import { getLocalIsoDate } from '@/lib/utils';

const mockMutate = vi.fn();
const mockAddToast = vi.fn();

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

vi.mock('@/hooks/useCapture', () => ({
  useCapture: () => ({ mutate: mockMutate, isPending: false }),
}));

vi.mock('@/hooks/useDevelopers', () => ({
  useDevelopers: () => ({
    data: [
      { accountId: 'dev-1', displayName: 'Alice Smith' },
      { accountId: 'dev-4', displayName: 'Alice Chen' },
      { accountId: 'dev-2', displayName: 'Bob Jones' },
    ],
  }),
}));

const mockCreateContact = vi.fn();
vi.mock('@/hooks/useContacts', () => ({
  useContacts: () => ({ data: [{ id: 7, displayName: 'Acme Legal', handle: 'acme-legal', note: null, createdAt: '' }] }),
  useCreateContact: () => ({ mutate: mockCreateContact, isPending: false }),
}));

vi.mock('@/hooks/useTaskLabels', () => ({
  useTaskLabels: () => ({
    data: {
      labels: [
        { name: 'category:follow_up', color: 'teal', system: true, createdAt: '' },
        { name: 'escalation', color: 'red', system: false, createdAt: '' },
        { name: 'urgent', color: 'red', system: false, createdAt: '' },
      ],
    },
  }),
}));

const mockIssues = vi.fn((query: string) => (query.toUpperCase().startsWith('LEA')
  ? [{ jiraKey: 'LEAD-42', summary: 'Login fails on Safari' }, { jiraKey: 'LEAD-43', summary: 'Logout loops' }]
  : []));
vi.mock('@/hooks/useGlobalSearch', () => ({
  GLOBAL_SEARCH_MIN_LENGTH: 2,
  useGlobalSearch: (query: string, options?: { enabled?: boolean }) => ({
    data: options?.enabled && query.trim().length >= 2 ? { issues: mockIssues(query.trim()) } : undefined,
  }),
}));

function renderBox(prefill = '', assignee?: { accountId: string; displayName?: string }) {
  const onClose = vi.fn();
  const utils = render(
    <TestWrapper>
      <CaptureBox prefill={prefill} assignee={assignee} onClose={onClose} />
    </TestWrapper>,
  );
  const input = screen.getByLabelText('Capture');
  return { onClose, input, ...utils };
}

function lastBody() {
  return mockMutate.mock.calls.at(-1)?.[0] as Record<string, unknown>;
}

function succeed(body: Record<string, unknown>) {
  // Simulate the default server response: a created task.
  const options = mockMutate.mock.calls.at(-1)?.[1] as {
    onSuccess: (res: CaptureResponseBody) => void;
  };
  act(() => options.onSuccess({
    intent: 'create',
    diagnostics: [],
    confirmRequired: false,
    blocked: false,
    task: { taskKey: 'T-5', title: String(body.text).split(' ').pop() ?? 'T-5' } as CaptureResponseBody['task'],
  }));
}

describe('CaptureBox (P3-D8)', () => {
  it('keeps the ID through confirmation but uses a fresh ID for the next intentional capture', () => {
    const { input } = renderBox('Write update !2020-01-01');
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    const requestId = lastBody().requestId;
    act(() => mockMutate.mock.calls.at(-1)![1].onSuccess({ intent: 'create', diagnostics: [], confirmRequired: true }));
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    expect(lastBody()).toMatchObject({ requestId, confirm: true });
    act(() => mockMutate.mock.calls.at(-1)![1].onSuccess({ intent: 'create', diagnostics: [], task: { taskKey: 'T-1', title: 'Write update' } }));
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    expect(lastBody().requestId).not.toBe(requestId);
  });

  it('reuses the request identity for an ambiguous retry and changes it after editing', () => {
    const { input } = renderBox('Write the update');
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    const first = lastBody().requestId;
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    expect(lastBody().requestId).toBe(first);
    fireEvent.change(input, { target: { value: 'Write the corrected update' } });
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    expect(lastBody().requestId).not.toBe(first);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('previews a !due: deadline as its own chip, and it is not an Inbox capture (docs/57 P3-04)', () => {
    const { input } = renderBox();
    fireEvent.change(input, { target: { value: 'Send contract !due:fri' } });

    const summary = screen.getByTestId('capture-summary');
    expect(summary.textContent).toMatch(/Due \w{3}, \w{3} \d+/);
    expect(summary.textContent).not.toContain('Inbox');
    // The plan date is not set by a deadline.
    fireEvent.change(input, { target: { value: 'Send contract !due:fri !tomorrow' } });
    expect(screen.getByTestId('capture-summary').textContent).toMatch(/Due \w{3}, \w{3} \d+/);
    expect(screen.getByTestId('capture-summary').textContent?.match(/\w{3}, \w{3} \d+/g)).toHaveLength(2);
  });

  it('renders a live summary of parsed tokens', () => {
    const { input } = renderBox('@dev-1 !fri +urgent Ship the login fix');
    fireEvent.change(input, { target: { value: '@dev-1 !fri +urgent Ship the login fix' } });

    const summary = screen.getByTestId('capture-summary');
    expect(summary.textContent).toContain('Alice Smith');
    expect(summary.textContent).toContain('urgent');
    expect(summary.textContent).toMatch(/\w{3}, \w{3} \d+/); // formatted date chip
  });

  it('announces diagnostics politely through a standing live region, not an assertive alert per keystroke', () => {
    const { input } = renderBox();
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toBeEmptyDOMElement();

    fireEvent.change(input, { target: { value: '@nobody check this' } });

    expect(within(region).getByTestId('capture-diagnostics')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('blocks submit on an unknown person token', () => {
    const { input } = renderBox();
    fireEvent.change(input, { target: { value: '@nobody check this' } });

    expect(screen.getByTestId('capture-diagnostics').textContent).toMatch(/Nobody matches @nobody/i);
    const button = screen.getByRole('button', { name: /capture/i });
    expect(button).toBeDisabled();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('offers a candidate chooser for an ambiguous person token', () => {
    const { input } = renderBox();
    fireEvent.change(input, { target: { value: '@alice pair on the release' } });

    const diagnostics = screen.getByTestId('capture-diagnostics');
    expect(diagnostics.textContent).toMatch(/ambiguous/i);
    // Both candidate buttons are rendered.
    const aliceSmith = screen.getByRole('button', { name: 'Alice Smith' });
    expect(screen.getByRole('button', { name: 'Alice Chen' })).toBeTruthy();

    fireEvent.click(aliceSmith);
    expect((input as HTMLTextAreaElement).value).toBe('@AliceSmith pair on the release');
    expect(screen.queryByTestId('capture-diagnostics')).toBeNull();
  });

  it('/later with a date shows the resurface date (P3-02)', () => {
    const { input } = renderBox();
    fireEvent.change(input, { target: { value: '/later !fri Park this thought' } });

    expect(screen.getByTestId('capture-summary').textContent).toMatch(/Later · back \w{3}, \w{3} \d+/);
    expect(screen.getByRole('button', { name: /capture/i })).not.toBeDisabled();
  });

  it('/w previews who the task waits on and the check-by date (P3-03)', () => {
    const { input } = renderBox();
    fireEvent.change(input, { target: { value: 'NDA review /w @acme-legal !mon' } });

    const summary = screen.getByTestId('capture-summary').textContent ?? '';
    expect(summary).toMatch(/Waiting on Acme Legal · check Mon, \w{3} \d+/);
    expect(summary).not.toContain('Inbox');
  });

  it('offers to create a contact for an unknown @person (P3-03)', () => {
    const { input } = renderBox();
    fireEvent.change(input, { target: { value: 'Quote /w @vendorx' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create contact @vendorx' }));
    expect(mockCreateContact.mock.calls.at(-1)?.[0]).toEqual({ displayName: 'vendorx', handle: 'vendorx' });
  });

  it('a bare capture previews as Inbox (P3-02)', () => {
    const { input } = renderBox();
    fireEvent.change(input, { target: { value: 'Think about hiring plan' } });

    expect(screen.getByTestId('capture-summary').textContent).toContain('Inbox');
  });

  it('shows the update intent for a task update', () => {
    const { input } = renderBox();
    fireEvent.change(input, { target: { value: 'T-9: shipped the fix' } });

    expect(screen.getByTestId('capture-summary').textContent).toContain('Update T-9');
    expect(screen.getByText('Logs a shared update on the task')).toBeTruthy();
  });

  it('shows the note intent for /note', () => {
    const { input } = renderBox('/note ');
    fireEvent.change(input, { target: { value: '/note shipped the release notes' } });

    expect(screen.getByTestId('capture-summary').textContent).toMatch(/Today.s note/);
    expect(screen.getByText(/Appends to today.s daily note/)).toBeTruthy();
  });

  it('submits the text with the client date and closes on success', () => {
    const { input, onClose } = renderBox();
    fireEvent.change(input, { target: { value: 'Ship the release @dev-1' } });
    fireEvent.click(screen.getByRole('button', { name: /capture/i }));

    expect(mockMutate).toHaveBeenCalledTimes(1);
    const body = lastBody();
    expect(body.text).toBe('Ship the release @dev-1');
    expect(body.clientToday).toBe(getLocalIsoDate());
    expect(body.tz).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(String(body.requestId)).toMatch(/^[0-9a-f-]{36}$/);

    succeed(body);
    expect(mockAddToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', title: expect.stringContaining('T-5') }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('arms a confirm for past dates and retries with confirm on the second press', () => {
    const { input } = renderBox();
    fireEvent.change(input, { target: { value: '!2020-01-01 Retro note' } });
    fireEvent.click(screen.getByRole('button', { name: /capture/i }));

    const firstOptions = mockMutate.mock.calls.at(-1)?.[1] as {
      onSuccess: (res: CaptureResponseBody) => void;
    };
    act(() =>
      firstOptions.onSuccess({
        intent: 'create',
        blocked: false,
        confirmRequired: true,
        diagnostics: [{ severity: 'warning', code: 'past-date', message: 'Date is in the past.' }],
      } as CaptureResponseBody),
    );

    // Second press sends confirm: true.
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    expect(lastBody().confirm).toBe(true);
  });

  it('holds a malformed @mention for a decision, says what it would keep, and sends the text untouched on confirm (docs/63 #8)', () => {
    const { input } = renderBox();
    fireEvent.change(input, { target: { value: 'Ask @harsha, about the rollout' } });
    // The preview already warns before anything is sent.
    expect(screen.getByText(/isn't a valid mention — did you mean @harsha\?/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /capture/i }));
    expect(lastBody().text).toBe('Ask @harsha, about the rollout');
    expect(lastBody().confirm).toBeUndefined();

    const options = mockMutate.mock.calls.at(-1)?.[1] as { onSuccess: (res: CaptureResponseBody) => void };
    act(() =>
      options.onSuccess({
        intent: 'create',
        blocked: false,
        confirmRequired: true,
        diagnostics: [{ severity: 'warning', code: 'malformed-mention', token: '@harsha,', message: '"@harsha," isn\'t a valid mention — did you mean @harsha? Otherwise it stays in the title as text' }],
      } as CaptureResponseBody),
    );
    expect(screen.getAllByRole('status').some((node) => node.textContent?.includes('press Enter or Capture again to keep it as text'))).toBe(true);
    expect(screen.queryByText(/Past date/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    // Nothing is rewritten on confirm: same text, now with the confirmation.
    expect(lastBody().text).toBe('Ask @harsha, about the rollout');
    expect(lastBody().confirm).toBe(true);
  });

  it('shows server diagnostics when the server blocks', () => {
    const { input } = renderBox();
    fireEvent.change(input, { target: { value: 'T-999: hello' } });
    fireEvent.click(screen.getByRole('button', { name: /capture/i }));

    const options = mockMutate.mock.calls.at(-1)?.[1] as {
      onSuccess: (res: CaptureResponseBody) => void;
    };
    act(() =>
      options.onSuccess({
        intent: 'update',
        blocked: true,
        confirmRequired: false,
        diagnostics: [{ severity: 'error', code: 'unknown-task', message: 'Task T-999 was not found.' }],
      } as CaptureResponseBody),
    );

    expect(screen.getByTestId('capture-diagnostics').textContent).toContain('Task T-999 was not found');
  });

  it('toasts non-blocking warnings after a successful capture (D3)', () => {
    const { input, onClose } = renderBox();
    fireEvent.change(input, { target: { value: 'Investigate #LEAD-99' } });
    fireEvent.click(screen.getByRole('button', { name: /capture/i }));

    const body = lastBody();
    const options = mockMutate.mock.calls.at(-1)?.[1] as {
      onSuccess: (res: CaptureResponseBody) => void;
    };
    act(() =>
      options.onSuccess({
        intent: 'create',
        blocked: false,
        confirmRequired: false,
        diagnostics: [{ severity: 'warning', code: 'jira-not-synced', message: '#LEAD-99 is not synced — kept as text.' }],
        task: { taskKey: 'T-7', title: 'Investigate #LEAD-99' } as CaptureResponseBody['task'],
      } as CaptureResponseBody),
    );

    // Success toast plus a separate warning toast — the dialog still closes.
    expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
    expect(mockAddToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'warning', message: expect.stringContaining('#LEAD-99') }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('suggests registered labels for a +fragment and inserts on Enter (D7)', () => {
    const { input } = renderBox();
    fireEvent.change(input, { target: { value: 'Call the vendor +es' } });

    const suggestion = screen.getByRole('option', { name: /escalation/i });
    expect(suggestion).toBeTruthy();
    // Display name is shown prefix-free; the raw +name is the insert value.
    fireEvent.keyDown(input, { key: 'Enter' });
    expect((input as HTMLTextAreaElement).value).toBe('Call the vendor +escalation ');
  });

  it('shows prefix-free display names for system labels in suggestions (D7/D8)', () => {
    const { input } = renderBox();
    fireEvent.change(input, { target: { value: 'Ping me +fo' } });

    const suggestion = screen.getByRole('option', { name: /follow up/i });
    expect(suggestion.textContent).toContain('category:follow_up');
    expect(suggestion.textContent).toContain('follow up');
  });

  it('Tab applies the highlighted label suggestion', () => {
    const { input } = renderBox();
    fireEvent.change(input, { target: { value: 'Something +ur' } });
    fireEvent.keyDown(input, { key: 'Tab' });
    expect((input as HTMLTextAreaElement).value).toBe('Something +urgent ');
  });

  it('does not fire the empty-note diagnostic on a bare /note prefill', () => {
    renderBox('/note ');
    expect(screen.queryByTestId('capture-diagnostics')).toBeNull();
  });

  it('prefills developer and issue context as tokens', () => {
    const { input } = renderBox('@dev-1 #PROJ-221 ');
    const value = (input as HTMLTextAreaElement).value;
    expect(value).toBe('@dev-1 #PROJ-221 ');
    // Owner resolves immediately in the preview.
    expect(screen.getByTestId('capture-summary').textContent).toContain('Alice Smith');
  });

  it('shows the assignee as a pill instead of a raw @token in the input', () => {
    const { input } = renderBox('', { accountId: 'dev-2', displayName: 'Bob Jones' });
    expect((input as HTMLTextAreaElement).value).toBe('');
    expect(screen.getByTestId('capture-assignee').textContent).toContain('Bob Jones');
  });

  it('sends the assignee as structured defaults, never as @id text (P3-05)', () => {
    const { input } = renderBox('', { accountId: 'dev-2', displayName: 'Bob Jones' });
    fireEvent.change(input, { target: { value: 'Review the deploy' } });
    fireEvent.click(screen.getByRole('button', { name: /capture/i }));
    expect(lastBody().text).toBe('Review the deploy');
    expect(lastBody().defaults).toEqual({ ownerAccountId: 'dev-2' });
  });

  it('carries an account id with a colon untouched (Jira ids)', () => {
    const { input } = renderBox('', { accountId: '557058:ab-12', displayName: 'Jira Person' });
    fireEvent.change(input, { target: { value: 'Fix the handoff' } });
    // The pill names the person and the id never reaches the input or the grammar.
    expect(screen.getByTestId('capture-assignee').textContent).toContain('Jira Person');
    expect((input as HTMLTextAreaElement).value).toBe('Fix the handoff');
    fireEvent.click(screen.getByRole('button', { name: /capture/i }));
    expect(lastBody().text).toBe('Fix the handoff');
    expect(lastBody().defaults).toEqual({ ownerAccountId: '557058:ab-12' });
    expect(String(lastBody().text)).not.toContain('@');
  });

  it('clears the assignee with the pill control and can bring it back', () => {
    const { input } = renderBox('', { accountId: 'dev-2', displayName: 'Bob Jones' });
    fireEvent.change(input, { target: { value: 'Unowned thought' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear assignee' }));

    expect(screen.getByTestId('capture-assignee').textContent).toContain('Nobody');
    // With no owner and no date it is an Inbox capture again.
    expect(screen.getByTestId('capture-summary').textContent).toContain('Inbox');
    fireEvent.click(screen.getByRole('button', { name: /^capture$/i }));
    expect(lastBody().defaults).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: 'Assign to Bob Jones' }));
    expect(screen.getByRole('button', { name: 'Clear assignee' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^capture$/i }));
    expect(lastBody().defaults).toEqual({ ownerAccountId: 'dev-2' });
  });

  it('a typed @person has no clear control and sends no default owner', () => {
    const { input } = renderBox('', { accountId: 'dev-2', displayName: 'Bob Jones' });
    fireEvent.change(input, { target: { value: '@dev-1 pair on the release' } });
    expect(screen.queryByRole('button', { name: 'Clear assignee' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^capture$/i }));
    expect(lastBody().defaults).toBeUndefined();
  });

  it('lets a typed @person override the assignee pill', () => {
    const { input } = renderBox('', { accountId: 'dev-2', displayName: 'Bob Jones' });
    fireEvent.change(input, { target: { value: '@alice pair on the release' } });
    fireEvent.click(screen.getByRole('button', { name: 'Alice Smith' }));

    // Pill tracks the typed owner; the text is submitted unchanged.
    expect(screen.getByTestId('capture-assignee').textContent).toContain('Alice Smith');
    fireEvent.click(screen.getByRole('button', { name: /capture/i }));
    expect(lastBody().text).toBe('@dev-1 pair on the release');
    expect(lastBody().defaults).toBeUndefined();
  });

  it('hides the pill and injects nothing for /later captures', () => {
    const { input } = renderBox('', { accountId: 'dev-2', displayName: 'Bob Jones' });
    fireEvent.change(input, { target: { value: '/later Park this thought' } });
    expect(screen.queryByTestId('capture-assignee')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /capture/i }));
    expect(lastBody().text).toBe('/later Park this thought');
    expect(lastBody().defaults).toBeUndefined();
  });

  describe('keep-open mode (P3-05)', () => {
    it('Cmd/Ctrl+Enter captures and stays open, back at the prefill', () => {
      const onCaptured = vi.fn();
      const onClose = vi.fn();
      render(
        <TestWrapper>
          <CaptureBox prefill="#PROJ-1 " onClose={onClose} onCaptured={onCaptured} />
        </TestWrapper>,
      );
      const input = screen.getByLabelText('Capture') as HTMLTextAreaElement;
      fireEvent.change(input, { target: { value: '#PROJ-1 First thing' } });
      fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
      expect(mockMutate).toHaveBeenCalledTimes(1);
      succeed(lastBody());

      expect(onCaptured).toHaveBeenCalledWith({ intent: 'create', taskKey: 'T-5' });
      expect(onClose).not.toHaveBeenCalled();
      expect(input.value).toBe('#PROJ-1 ');

      fireEvent.change(input, { target: { value: '#PROJ-1 Second thing' } });
      fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
      expect(mockMutate).toHaveBeenCalledTimes(2);
      expect(lastBody().text).toBe('#PROJ-1 Second thing');
    });

    it('plain Enter still closes after capturing', () => {
      const { input, onClose } = renderBox();
      fireEvent.change(input, { target: { value: 'One and done' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      succeed(lastBody());
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('the Add another button keeps the box open and keeps the assignee', () => {
      const { input, onClose } = renderBox('', { accountId: 'dev-2', displayName: 'Bob Jones' });
      fireEvent.change(input, { target: { value: 'First' } });
      fireEvent.click(screen.getByRole('button', { name: 'Add another' }));
      succeed(lastBody());
      expect(onClose).not.toHaveBeenCalled();
      expect((input as HTMLTextAreaElement).value).toBe('');
      expect(screen.getByTestId('capture-assignee').textContent).toContain('Bob Jones');
      fireEvent.change(input, { target: { value: 'Second' } });
      fireEvent.click(screen.getByRole('button', { name: /^capture$/i }));
      expect(lastBody().defaults).toEqual({ ownerAccountId: 'dev-2' });
    });

    it('does not submit while blocked, even with Cmd+Enter', () => {
      const { input } = renderBox();
      fireEvent.change(input, { target: { value: 'Ask @nobodyhere' } });
      fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
      expect(mockMutate).not.toHaveBeenCalled();
    });

    it('Cmd+Enter submits instead of accepting an open suggestion', () => {
      const { input } = renderBox();
      fireEvent.change(input, { target: { value: 'Call the vendor +es' } });
      expect(screen.getByRole('listbox', { name: 'Label suggestions' })).toBeInTheDocument();
      fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
      expect(lastBody().text).toBe('Call the vendor +es');
    });

    it('mentions the shortcut in the footer', () => {
      renderBox();
      expect(screen.getByTestId('capture-keep-open-hint').textContent).toMatch(/Enter/);
    });
  });

  describe('@ and # typeahead (P3-05)', () => {
    it('suggests people for @, shows a readable name on Tab and sends the id (UX-05)', () => {
      const { input } = renderBox();
      fireEvent.change(input, { target: { value: 'Pair with @al' } });
      const list = screen.getByRole('listbox', { name: 'Person suggestions' });
      expect(within(list).getAllByRole('option').map((option) => option.textContent)).toEqual([
        expect.stringContaining('Alice Smith'),
        expect.stringContaining('Alice Chen'),
      ]);
      fireEvent.keyDown(input, { key: 'Tab' });
      // Two Alices: the full name keeps it unique; the id never reaches the text.
      expect((input as HTMLTextAreaElement).value).toBe('Pair with @AliceSmith ');
      fireEvent.change(input, { target: { value: 'Pair with @AliceSmith on the release' } });
      expect(screen.queryByTestId('capture-diagnostics')).toBeNull();
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(lastBody().text).toBe('Pair with @dev-1 on the release');
    });

    it('lists contacts after developers, marked as contacts', () => {
      const { input } = renderBox();
      fireEvent.change(input, { target: { value: '/w @' } });
      const options = within(screen.getByRole('listbox', { name: 'Person suggestions' })).getAllByRole('option');
      expect(options.at(-1)?.textContent).toContain('Acme Legal');
      expect(options.at(-1)?.textContent).toContain('Contact');
      expect(options[0]?.textContent).not.toContain('Contact');
    });

    it('arrow keys move the highlight; clicking a row inserts it', () => {
      const { input } = renderBox();
      fireEvent.change(input, { target: { value: 'Ping @al' } });
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
      fireEvent.click(screen.getAllByRole('option')[1]!);
      expect((input as HTMLTextAreaElement).value).toBe('Ping @AliceChen ');
    });

    it('Enter accepts the highlighted person instead of submitting', () => {
      const { input } = renderBox();
      fireEvent.change(input, { target: { value: 'Ask @bo' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect((input as HTMLTextAreaElement).value).toBe('Ask @Bob ');
      expect(mockMutate).not.toHaveBeenCalled();
    });

    it('Escape closes the list without touching the text', () => {
      const { input } = renderBox();
      fireEvent.change(input, { target: { value: 'Ask @al' } });
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(screen.queryByRole('listbox')).toBeNull();
      expect((input as HTMLTextAreaElement).value).toBe('Ask @al');
    });

    it('offers no suggestion once the handle is fully typed', () => {
      const { input } = renderBox();
      fireEvent.change(input, { target: { value: 'Ask @dev-2' } });
      expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('suggests synced Jira issues for # and inserts the key', () => {
      const { input } = renderBox();
      fireEvent.change(input, { target: { value: 'Look at #LEA' } });
      const list = screen.getByRole('listbox', { name: 'Issue suggestions' });
      expect(within(list).getAllByRole('option')[0]?.textContent).toContain('LEAD-42');
      expect(within(list).getAllByRole('option')[0]?.textContent).toContain('Login fails on Safari');
      fireEvent.keyDown(input, { key: 'Tab' });
      expect((input as HTMLTextAreaElement).value).toBe('Look at #LEAD-42 ');
    });

    it('waits for two characters before searching issues', () => {
      const { input } = renderBox();
      fireEvent.change(input, { target: { value: 'Look at #L' } });
      expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('does not trigger inside a word', () => {
      const { input } = renderBox();
      fireEvent.change(input, { target: { value: 'mail bob@al' } });
      expect(screen.queryByRole('listbox')).toBeNull();
    });
  });
});

describe('progressive capture guidance', () => {
  it('keeps plain-title capture obvious and preserves a draft while examples are opened', () => {
    render(<CaptureBox onClose={vi.fn()} />, { wrapper: TestWrapper });
    const input = screen.getByRole('textbox', { name: 'Capture' });
    expect(input).toHaveAttribute('placeholder', 'What do you need to do?');
    expect(input).toHaveAccessibleDescription('A title is enough. Extras are optional.');
    const summary = screen.getByText('Examples');
    const details = summary.closest('details')!;
    expect(details.open).toBe(false);
    fireEvent.change(input, { target: { value: 'Keep my draft' } });
    fireEvent.click(summary);
    expect(details.open).toBe(true); expect(input).toHaveValue('Keep my draft');
    expect(screen.getByText('Review the rollout checklist !tomorrow')).toBeInTheDocument();
  });
});
