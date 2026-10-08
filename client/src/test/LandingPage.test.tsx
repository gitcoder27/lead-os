import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { format, parseISO } from 'date-fns';
import { parseCapture, resolveCapture } from 'shared/capture-grammar';
import { LandingPage } from '@/components/landing/LandingPage';
import { CaptureDemo, demoOutcome } from '@/components/landing/CaptureDemo';
import { DEMO_PEOPLE, INTRO_EXAMPLE } from '@/components/landing/demo-data';
import { resolveAccessRequestUrl } from '@/lib/landing-config';
import { getLocalIsoDate } from '@/lib/utils';
import type * as FramerMotion from 'framer-motion';

const reducedMotion = vi.hoisted(() => ({ value: true }));
vi.mock('framer-motion', async (importOriginal) => ({
  ...(await importOriginal<typeof FramerMotion>()),
  useReducedMotion: () => reducedMotion.value,
}));

const loginMock = vi.fn();
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ login: loginMock }),
}));

const toggleTheme = vi.fn();
vi.mock('@/context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'dark', toggleTheme }),
}));

function resolve(text: string) {
  return resolveCapture(parseCapture(text, getLocalIsoDate()), { people: DEMO_PEOPLE });
}

function captureInput() {
  return screen.getByRole('textbox', { name: 'Try capture' });
}

describe('LandingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reducedMotion.value = true;
    window.history.replaceState(null, '', '/');
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('says what LeadOS is and who it is for, and names the page', () => {
    const { unmount } = render(<LandingPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Lead your team without losing the thread.' })).toBeInTheDocument();
    expect(screen.getByText(/the daily workspace for engineering managers/)).toBeInTheDocument();
    for (const name of ['Every morning starts with the same five questions.', 'Or just ask. Copilot already knows your day.', 'One day, start to finish.', 'Works with the team you have.', 'Private where it matters.', 'Start tomorrow with a plan.']) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument();
    }
    expect(document.title).toBe('LeadOS: the daily workspace for engineering managers');
    unmount();
    expect(document.title).not.toBe('LeadOS: the daily workspace for engineering managers');
  });

  it('has no Request access button until a destination is configured', () => {
    render(<LandingPage />);
    expect(screen.queryByRole('link', { name: 'Request access' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Sign in' }).length).toBeGreaterThan(1);
  });

  it('opens sign-in from the top right and closes it again', () => {
    render(<LandingPage />);
    const banner = screen.getByRole('banner');
    fireEvent.click(within(banner).getByRole('button', { name: 'Sign in' }));

    const dialog = screen.getByRole('dialog', { name: 'Sign in to LeadOS' });
    expect(within(dialog).getByLabelText('Username')).toHaveFocus();
    expect(within(dialog).getByText('Managers and engineers both sign in here.')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Sign in to LeadOS' })).not.toBeInTheDocument();
  });

  it('opens with sign-in up for /login, and dismissing it leaves the page at /', () => {
    window.history.replaceState(null, '', '/login');
    render(<LandingPage initialSignInOpen />);
    const dialog = screen.getByRole('dialog', { name: 'Sign in to LeadOS' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(window.location.pathname).toBe('/');
  });

  it('retitles the dialog while changing a password', () => {
    render(<LandingPage initialSignInOpen />);
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(screen.getByRole('dialog', { name: 'Change your password' })).toBeInTheDocument();
  });

  it('scrolls to a section in place, without changing the route', () => {
    render(<LandingPage />);
    fireEvent.click(screen.getByRole('link', { name: 'See a day in LeadOS' }));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(window.location.pathname).toBe('/');
    expect(window.location.hash).toBe('');
  });

  it('toggles the theme from the header', () => {
    render(<LandingPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(toggleTheme).toHaveBeenCalledOnce();
  });

  it('walks the day as tabs, by click and by arrow keys', () => {
    render(<LandingPage />);
    const tabs = screen.getByRole('tablist', { name: 'A day in LeadOS' });
    expect(within(tabs).getByRole('tab', { name: /08:45/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'Plan the day before it plans you' })).toBeInTheDocument();

    fireEvent.click(within(tabs).getByRole('tab', { name: /Standup/ }));
    expect(screen.getByRole('heading', { name: 'Run standup one person at a time' })).toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName(/Standup/);

    fireEvent.keyDown(within(tabs).getByRole('tab', { name: /Standup/ }), { key: 'ArrowRight' });
    expect(within(tabs).getByRole('tab', { name: /1:1/ })).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Hold 1:1s that remember last time' })).toBeInTheDocument();

    fireEvent.keyDown(within(tabs).getByRole('tab', { name: /1:1/ }), { key: 'End' });
    expect(screen.getByRole('heading', { name: 'Finish the week with the update written' })).toBeInTheDocument();
    fireEvent.keyDown(within(tabs).getByRole('tab', { name: /Weekly review/ }), { key: 'ArrowRight' });
    expect(within(tabs).getByRole('tab', { name: /08:45/ })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('Copilot section', () => {
  beforeEach(() => {
    reducedMotion.value = true;
  });

  it('names the model and shows Copilot answering from the workspace', () => {
    render(<LandingPage />);
    expect(screen.getByText('Powered by Claude Sonnet 5.5')).toBeInTheDocument();
    const dock = screen.getByRole('figure', { name: 'Copilot answering “Brief me on today”' });
    expect(within(dock).getByText('Read today snapshot')).toBeInTheDocument();
    expect(within(dock).getByText('Marcus is blocked.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Brief me on today' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('switches questions and shows the change Copilot proposes before it acts', () => {
    render(<LandingPage />);
    fireEvent.click(screen.getByRole('button', { name: /Remind me to chase Tom/ }));
    const dock = screen.getByRole('figure', { name: /Remind me to chase Tom/ });
    expect(within(dock).getByText('Capture a task')).toBeInTheDocument();
    expect(within(dock).getByText('Tom Becker')).toBeInTheDocument();
    expect(within(dock).getByText('Confirm')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Brief me on today' })).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Prep my 1:1 with Lena' }));
    expect(screen.getByText('Owning the on-call rota')).toBeInTheDocument();
  });
});

describe('CaptureDemo', () => {
  beforeEach(() => {
    reducedMotion.value = true;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the first example already parsed when motion is reduced, and never captures on its own', () => {
    render(<CaptureDemo />);
    expect(captureInput()).toHaveValue(INTRO_EXAMPLE.text);
    expect(screen.getByText('Waiting on Priya Nair')).toBeInTheDocument();
    expect(screen.queryByText(/Captured T-/)).not.toBeInTheDocument();
  });

  it('plays the first example once and lands it in Waiting', () => {
    reducedMotion.value = false;
    vi.useFakeTimers();
    render(<CaptureDemo />);
    expect(captureInput()).toHaveValue('');
    act(() => { vi.advanceTimersByTime(6000); });
    expect(screen.getByRole('status')).toHaveTextContent('Captured T-143. It waits on Priya');
    expect(screen.getByText('Ask for the RCA draft')).toBeInTheDocument();
    expect(captureInput()).toHaveValue('');
  });

  it('stops the intro as soon as the visitor takes over', () => {
    reducedMotion.value = false;
    vi.useFakeTimers();
    render(<CaptureDemo />);
    act(() => { vi.advanceTimersByTime(1200); });
    fireEvent.focus(captureInput());
    fireEvent.change(captureInput(), { target: { value: 'My own task' } });
    act(() => { vi.advanceTimersByTime(6000); });
    expect(captureInput()).toHaveValue('My own task');
    expect(screen.queryByText(/Captured T-/)).not.toBeInTheDocument();
  });

  it('files a capture the way the app would, with Enter', () => {
    render(<CaptureDemo />);
    fireEvent.change(captureInput(), { target: { value: '@marcus fix the login timeout #PAY-412 !due:mon' } });
    expect(screen.getByText('Marcus Webb')).toBeInTheDocument();
    expect(screen.getByText('PAY-412 ●')).toBeInTheDocument();
    fireEvent.keyDown(captureInput(), { key: 'Enter' });
    expect(screen.getByRole('status')).toHaveTextContent('It’s on Marcus’s plan in Team');
    expect(captureInput()).toHaveValue('');
  });

  it('puts today’s work on My plan, after the pins', () => {
    render(<CaptureDemo />);
    fireEvent.change(captureInput(), { target: { value: 'Sign the offer letters !today !!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Capture' }));
    const plan = screen.getByText('My plan').closest('section')!;
    const titles = within(plan).getAllByRole('listitem').map((row) => row.textContent ?? '');
    expect(titles[3]).toContain('Sign the offer letters');
    expect(within(plan).getByLabelText('High priority')).toBeInTheDocument();
  });

  it('fills an example when one is picked, and explains an unknown person', () => {
    render(<CaptureDemo />);
    fireEvent.click(screen.getByRole('button', { name: 'Private note' }));
    expect(captureInput()).toHaveValue('/note Lena wants to own the on-call rota');
    expect(screen.getByText("Today's note")).toBeInTheDocument();

    fireEvent.change(captureInput(), { target: { value: 'Ask @bob about the budget' } });
    expect(screen.getByText(/Nobody matches @bob\. This demo team is Priya, Marcus, Lena, Tom and Aiko\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Capture' })).toBeDisabled();
  });
});

describe('demoOutcome', () => {
  const today = getLocalIsoDate();

  it('sends each kind of capture to its lane', () => {
    expect(demoOutcome(resolve('/note keep Friday for verification'), 'T-1', today)).toMatchObject({ list: null, message: expect.stringContaining('private') });
    expect(demoOutcome(resolve('T-131: shared the draft'), 'T-1', today)).toMatchObject({ list: null, message: 'Added an update to T-131.' });
    expect(demoOutcome(resolve('Prepare the release update'), 'T-1', today)).toMatchObject({ list: null, message: expect.stringContaining('Inbox') });
    expect(demoOutcome(resolve('Read the RFC /later'), 'T-1', today)).toMatchObject({ list: null, message: expect.stringContaining('Later') });
    expect(demoOutcome(resolve('Release go/no-go /m !today'), 'T-1', today)).toMatchObject({ list: 'plan', row: { meeting: true } });
    expect(demoOutcome(resolve('Ask @tom for the numbers /w'), 'T-1', today)).toMatchObject({ list: 'waiting', row: { meta: 'Tom · since today' } });
  });

  it('names the date a plan or deadline lands on', () => {
    const tomorrow = resolve('Review the checklist !tomorrow');
    expect(demoOutcome(tomorrow, 'T-9', today).message).toBe(`Captured T-9. Planned for ${format(parseISO(tomorrow.scheduledOn!), 'EEE, MMM d')}.`);
    const due = resolve('Budget draft !due:+3d');
    expect(demoOutcome(due, 'T-9', today).message).toBe(`Captured T-9. It’s in My tasks, due ${format(parseISO(due.dueOn!), 'EEE, MMM d')}.`);
  });
});

describe('resolveAccessRequestUrl', () => {
  it('accepts https and mailto destinations only', () => {
    expect(resolveAccessRequestUrl(undefined)).toBeNull();
    expect(resolveAccessRequestUrl('  ')).toBeNull();
    expect(resolveAccessRequestUrl('https://forms.example.com/leados')).toBe('https://forms.example.com/leados');
    expect(resolveAccessRequestUrl('mailto:lead@example.com?subject=LeadOS')).toBe('mailto:lead@example.com?subject=LeadOS');
    expect(resolveAccessRequestUrl('http://example.com')).toBeNull();
    expect(resolveAccessRequestUrl('javascript:alert(1)')).toBeNull();
    expect(resolveAccessRequestUrl('not a url')).toBeNull();
  });
});
