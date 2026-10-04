import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  Check,
  CircleCheck,
  Eye,
  EyeOff,
  Loader2,
  Moon,
  PlugZap,
  Search,
  ShieldPlus,
  Sun,
  UserCog,
  Users,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { useToast } from '@/context/ToastContext';
import { useConfig } from '@/hooks/useConfig';
import { api } from '@/lib/api';
import { DEVELOPER_LOGIN_URL } from '@/lib/constants';
import { useTriggerSync } from '@/hooks/useTriggerSync';
import { useTeamMode } from '@/hooks/useTeamMode';
import { MIN_PASSWORD_LENGTH } from '@/lib/password';
import type { AuthUser, TeamModeUpdateRequest } from '@/types';
import { LeadOSMark } from '@/components/brand/LeadOSMark';

interface DiscoveredUser {
  accountId: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
}

interface SetupWizardProps {
  onComplete: () => Promise<void> | void;
}

type WizardStep =
  | 'manager-account'
  | 'jira-connection'
  | 'manager-mapping'
  | 'team-members'
  | 'developer-access'
  | 'syncing';

/** docs/56 P2-01: "Just me" only needs the account; "Me and a team" adds the developer-access step. */
type WorkspaceKind = 'solo' | 'team';

type ConfigQuerySnapshot = {
  data?: {
    jiraApiToken?: string;
  };
};

interface StepContentProps {
  step: WizardStep;
  workspaceKind: WorkspaceKind;
  setWorkspaceKind: (value: WorkspaceKind) => void;
  managerUsername: string;
  setManagerUsername: (value: string) => void;
  managerDisplayName: string;
  setManagerDisplayName: (value: string) => void;
  managerPassword: string;
  setManagerPassword: (value: string) => void;
  creatingManager: boolean;
  handleCreateManager: () => void;
  jiraBaseUrl: string;
  setJiraBaseUrl: (value: string) => void;
  jiraProjectKey: string;
  setJiraProjectKey: (value: string) => void;
  jiraEmail: string;
  setJiraEmail: (value: string) => void;
  jiraApiToken: string;
  setJiraApiToken: (value: string) => void;
  configQuery: ConfigQuerySnapshot;
  setConnectionValidated: (value: boolean) => void;
  connectionValidated: boolean;
  testingConnection: boolean;
  handleTestConnection: () => void;
  savingConnection: boolean;
  handleSaveConnection: () => void;
  includeManagerJira: boolean;
  setIncludeManagerJira: (value: boolean) => void;
  selectedManagerJiraAccountId: string;
  setSelectedManagerJiraAccountId: (value: string) => void;
  discoveredUsers: DiscoveredUser[];
  discoveringUsers: boolean;
  loadDiscoverableUsers: (search?: string) => Promise<DiscoveredUser[]>;
  discoverQuery: string;
  setDiscoverQuery: (value: string) => void;
  filteredDiscoveredUsers: DiscoveredUser[];
  selectedDeveloperIds: Set<string>;
  setSelectedDeveloperIds: Dispatch<SetStateAction<Set<string>>>;
  savingDevelopers: boolean;
  newAccountUsername: string;
  setNewAccountUsername: (value: string) => void;
  newAccountDisplayName: string;
  setNewAccountDisplayName: (value: string) => void;
  newAccountPassword: string;
  setNewAccountPassword: (value: string) => void;
  newAccountDeveloperId: string;
  setNewAccountDeveloperId: (value: string) => void;
  trackedDevelopers: DiscoveredUser[];
  eligibleDeveloperAccounts: DiscoveredUser[];
  creatingDeveloperAccess: boolean;
  handleCreateDeveloperAccount: () => void;
  appUsers: AuthUser[];
  loadingUsers: boolean;
}

interface StepFooterProps {
  step: WizardStep;
  workspaceKind: WorkspaceKind;
  goToStep: (step: WizardStep) => void;
  creatingManager: boolean;
  handleCreateManager: () => void;
  managerUsername: string;
  managerDisplayName: string;
  managerPassword: string;
  savingConnection: boolean;
  handleSaveConnection: () => void;
  handleSkip: () => void;
  jiraBaseUrl: string;
  jiraEmail: string;
  jiraProjectKey: string;
  jiraApiToken: string;
  configQuery: ConfigQuerySnapshot;
  handleSaveManagerMapping: () => void;
  savingDevelopers: boolean;
  handleSaveTrackedDevelopers: () => void;
  handleFinish: () => void;
  triggerSyncPending: boolean;
}

const TEAM_STEP_ORDER: Exclude<WizardStep, 'syncing'>[] = [
  'manager-account',
  'jira-connection',
  'manager-mapping',
  'team-members',
  'developer-access',
];

/** Solo workspaces have no developer logins, so the last step is left out. */
const SOLO_STEP_ORDER = TEAM_STEP_ORDER.filter((key) => key !== 'developer-access');

const WORKSPACE_KIND_OPTIONS: Array<{ value: WorkspaceKind; title: string; description: string }> = [
  {
    value: 'solo',
    title: 'Just me',
    description: 'Your own tasks, notes and follow-ups. You only need an account, and you can add people or Jira later.',
  },
  {
    value: 'team',
    title: 'Me and a team',
    description: 'Also plan your team’s days, and optionally give developers a login to their own My Day.',
  },
];

const stepOrderFor = (kind: WorkspaceKind) => (kind === 'team' ? TEAM_STEP_ORDER : SOLO_STEP_ORDER);

/** docs/56 UX-14: steps that only exist with a Jira connection; uncounted ("with Jira") until it is saved. */
const JIRA_ONLY_STEPS = new Set<WizardStep>(['manager-mapping', 'team-members']);

const STEP_COPY: Record<Exclude<WizardStep, 'syncing'>, { title: string; description: string; icon: typeof BriefcaseBusiness }> = {
  'manager-account': {
    title: 'Create manager account',
    description: 'Start with your account. Jira, team members and developer logins are all optional and can come later.',
    icon: BriefcaseBusiness,
  },
  'jira-connection': {
    title: 'Connect Jira',
    description: 'Jira is optional. Connect it for defect sync, or skip it and start with your own tasks and notes.',
    icon: PlugZap,
  },
  'manager-mapping': {
    title: 'Manager sync scope',
    description: 'Map a Jira identity only if manager-owned assignments should appear in sync scope.',
    icon: UserCog,
  },
  'team-members': {
    title: 'Build team roster',
    description: 'Choose synced Jira people now, or add team members manually from Settings later.',
    icon: Users,
  },
  'developer-access': {
    title: 'Developer access',
    description: 'Create My Day access for developers who will update their own daily workspace.',
    icon: ShieldPlus,
  },
};

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const { user, isAuthenticated, refreshSession } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { addToast } = useToast();
  const triggerSync = useTriggerSync();
  const configQuery = useConfig({ enabled: isAuthenticated && user?.role === 'manager' });

  const teamMode = useTeamMode();
  const [workspaceKind, setWorkspaceKind] = useState<WorkspaceKind>(teamMode === 'collab' ? 'team' : 'solo');
  const stepOrder = stepOrderFor(workspaceKind);
  const [jiraSavedHere, setJiraSavedHere] = useState(false);
  const jiraReady = jiraSavedHere || Boolean(configQuery.data?.jiraBaseUrl && configQuery.data?.jiraApiToken);
  // The "Step N of M" count: Jira-only steps join it once Jira is saved, so "Just me" never overstates the work.
  const countedSteps = jiraReady ? stepOrder : stepOrder.filter((key) => !JIRA_ONLY_STEPS.has(key));
  const stepNumber = (key: WizardStep): number | null => {
    const index = countedSteps.indexOf(key as Exclude<WizardStep, 'syncing'>);
    return index === -1 ? null : index + 1;
  };

  const [step, setStep] = useState<WizardStep>(
    isAuthenticated && user?.role === 'manager' ? 'jira-connection' : 'manager-account'
  );
  const [errorMessage, setErrorMessage] = useState('');

  const [managerUsername, setManagerUsername] = useState('');
  const [managerDisplayName, setManagerDisplayName] = useState('');
  const [managerPassword, setManagerPassword] = useState('');
  const [creatingManager, setCreatingManager] = useState(false);

  const [jiraBaseUrl, setJiraBaseUrl] = useState('');
  const [jiraEmail, setJiraEmail] = useState('');
  const [jiraApiToken, setJiraApiToken] = useState('');
  const [jiraProjectKey, setJiraProjectKey] = useState('');
  const [testingConnection, setTestingConnection] = useState(false);
  const [savingConnection, setSavingConnection] = useState(false);
  const [connectionValidated, setConnectionValidated] = useState(false);

  const [discoveringUsers, setDiscoveringUsers] = useState(false);
  const [discoverQuery, setDiscoverQuery] = useState('');
  const [discoveredUsers, setDiscoveredUsers] = useState<DiscoveredUser[]>([]);

  const [includeManagerJira, setIncludeManagerJira] = useState(false);
  const [selectedManagerJiraAccountId, setSelectedManagerJiraAccountId] = useState('');

  const [selectedDeveloperIds, setSelectedDeveloperIds] = useState<Set<string>>(new Set());
  const [savingDevelopers, setSavingDevelopers] = useState(false);

  const [appUsers, setAppUsers] = useState<AuthUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [newAccountUsername, setNewAccountUsername] = useState('');
  const [newAccountDisplayName, setNewAccountDisplayName] = useState('');
  const [newAccountPassword, setNewAccountPassword] = useState('');
  const [newAccountDeveloperId, setNewAccountDeveloperId] = useState('');
  const [creatingDeveloperAccess, setCreatingDeveloperAccess] = useState(false);

  useEffect(() => {
    if (isAuthenticated && user?.role === 'manager' && step === 'manager-account') {
      setStep('jira-connection');
    }
  }, [isAuthenticated, step, user]);

  useEffect(() => {
    if (!configQuery.data) {
      return;
    }

    setJiraBaseUrl((value) => value || configQuery.data?.jiraBaseUrl || '');
    setJiraEmail((value) => value || configQuery.data?.jiraEmail || '');
    setJiraProjectKey((value) => value || configQuery.data?.jiraProjectKey || '');
    setSelectedManagerJiraAccountId((value) => value || configQuery.data?.managerJiraAccountId || '');
    if (configQuery.data.managerJiraAccountId) {
      setIncludeManagerJira(true);
    }
  }, [configQuery.data]);

  useEffect(() => {
    if (step !== 'developer-access' || !isAuthenticated || user?.role !== 'manager') {
      return;
    }

    let cancelled = false;
    setLoadingUsers(true);
    api
      .get<{ users: AuthUser[] }>('/auth/users')
      .then((response) => {
        if (!cancelled) {
          setAppUsers(response.users ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAppUsers([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingUsers(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, step, user]);

  const filteredDiscoveredUsers = useMemo(() => {
    const query = discoverQuery.trim().toLowerCase();
    const baseUsers = includeManagerJira && selectedManagerJiraAccountId
      ? discoveredUsers.filter((candidate) => candidate.accountId !== selectedManagerJiraAccountId)
      : discoveredUsers;

    if (!query) {
      return baseUsers;
    }

    return baseUsers.filter((candidate) =>
      candidate.displayName.toLowerCase().includes(query) ||
      (candidate.email?.toLowerCase().includes(query) ?? false)
    );
  }, [discoverQuery, discoveredUsers, includeManagerJira, selectedManagerJiraAccountId]);

  const trackedDevelopers = useMemo(
    () => discoveredUsers.filter((candidate) => selectedDeveloperIds.has(candidate.accountId)),
    [discoveredUsers, selectedDeveloperIds]
  );

  const trackedDeveloperIdSet = useMemo(
    () => new Set(trackedDevelopers.map((candidate) => candidate.accountId)),
    [trackedDevelopers]
  );

  const existingDeveloperAccountIds = useMemo(
    () => new Set(appUsers.map((account) => account.developerAccountId).filter(Boolean)),
    [appUsers]
  );

  const eligibleDeveloperAccounts = useMemo(
    () => trackedDevelopers.filter((candidate) => !existingDeveloperAccountIds.has(candidate.accountId)),
    [existingDeveloperAccountIds, trackedDevelopers]
  );

  const currentStepIndex = stepOrder.indexOf(step === 'syncing' ? stepOrder[stepOrder.length - 1]! : step);

  const clearError = () => setErrorMessage('');

  const loadDiscoverableUsers = async (search = '') => {
    setDiscoveringUsers(true);
    setErrorMessage('');

    try {
      const response = await api.post<{ users: DiscoveredUser[] }>('/team/discover', {
        query: search.trim() || undefined,
        maxResults: 100,
      });
      setDiscoveredUsers(response.users ?? []);
      return response.users ?? [];
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to discover Jira users';
      setErrorMessage(message);
      throw error;
    } finally {
      setDiscoveringUsers(false);
    }
  };

  const goToStep = (nextStep: WizardStep) => {
    clearError();
    setStep(nextStep);
  };

  const handleCreateManager = async () => {
    if (!managerUsername.trim() || !managerDisplayName.trim() || managerPassword.length < MIN_PASSWORD_LENGTH) {
      return;
    }

    setCreatingManager(true);
    setErrorMessage('');

    try {
      await api.post('/auth/register', {
        username: managerUsername.trim(),
        displayName: managerDisplayName.trim(),
        password: managerPassword,
        role: 'manager',
      });
      await refreshSession();
      addToast({
        type: 'success',
        title: 'Manager account created',
        message: 'You are signed in. Connect Jira now, or skip it and start on Today.',
      });
      goToStep('jira-connection');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to create manager account');
    } finally {
      setCreatingManager(false);
    }
  };

  const handleTestConnection = async () => {
    const token = jiraApiToken.trim();
    const hasSavedToken = Boolean(configQuery.data?.jiraApiToken);
    if (!jiraBaseUrl || !jiraEmail || (!token && !hasSavedToken) || !jiraProjectKey) {
      return;
    }

    setTestingConnection(true);
    setErrorMessage('');

    try {
      await api.post('/config/test', {
        jiraBaseUrl,
        jiraEmail,
        ...(token ? { jiraApiToken: token } : {}),
        jiraProjectKey,
      });
      setConnectionValidated(true);
      addToast({
        type: 'success',
        title: 'Jira connection confirmed',
        message: 'The workspace can now save this Jira connection.',
      });
    } catch (error) {
      setConnectionValidated(false);
      setErrorMessage(error instanceof Error ? error.message : 'Connection test failed');
    } finally {
      setTestingConnection(false);
    }
  };

  const handleSaveConnection = async () => {
    setSavingConnection(true);
    setErrorMessage('');

    try {
      await api.put('/config', {
        jiraBaseUrl,
        jiraEmail,
        jiraProjectKey,
        jiraApiToken: jiraApiToken && jiraApiToken !== '****' ? jiraApiToken : undefined,
      });
      await configQuery.refetch();
      await loadDiscoverableUsers();
      addToast({
        type: 'success',
        title: 'Jira connection saved',
        message: 'Now choose whether the manager should also be included in sync scope.',
      });
      setJiraSavedHere(true);
      goToStep('manager-mapping');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save Jira connection');
    } finally {
      setSavingConnection(false);
    }
  };

  const handleSaveManagerMapping = async () => {
    if (includeManagerJira && !selectedManagerJiraAccountId) {
      setErrorMessage('Select a Jira identity for the manager or continue without manager mapping.');
      return;
    }

    try {
      await api.put('/config/settings', {
        managerJiraAccountId: includeManagerJira ? selectedManagerJiraAccountId : '',
      });
      await configQuery.refetch();
      if (discoveredUsers.length === 0) {
        await loadDiscoverableUsers();
      }
      addToast({
        type: 'success',
        title: 'Sync scope manager mapping saved',
        message: includeManagerJira
          ? 'Manager assignments will be included in sync scope.'
          : 'The workspace will sync only tracked developers.',
      });
      goToStep('team-members');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save manager Jira mapping');
    }
  };

  const handleSaveTrackedDevelopers = async () => {
    setSavingDevelopers(true);
    setErrorMessage('');

    try {
      await api.post('/team/developers', {
        developers: trackedDevelopers,
      });
      addToast({
        type: 'success',
        title: 'Tracked developers saved',
        message: `${trackedDevelopers.length} team member${trackedDevelopers.length === 1 ? '' : 's'} will be tracked.`,
      });
      if (workspaceKind === 'team') {
        goToStep('developer-access');
      } else {
        void handleFinish();
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save tracked developers');
    } finally {
      setSavingDevelopers(false);
    }
  };

  const handleCreateDeveloperAccount = async () => {
    if (!newAccountUsername.trim() || !newAccountDisplayName.trim() || newAccountPassword.length < MIN_PASSWORD_LENGTH || !newAccountDeveloperId) {
      return;
    }

    setCreatingDeveloperAccess(true);
    setErrorMessage('');

    try {
      const response = await api.post<{ user: AuthUser }>('/auth/register', {
        username: newAccountUsername.trim(),
        displayName: newAccountDisplayName.trim(),
        password: newAccountPassword,
        role: 'developer',
        developerAccountId: newAccountDeveloperId,
      });
      setAppUsers((current) => [...current, response.user]);
      setNewAccountUsername('');
      setNewAccountDisplayName('');
      setNewAccountPassword('');
      setNewAccountDeveloperId('');
      addToast({
        type: 'success',
        title: 'Developer access created',
        message: `Created login access for ${response.user.displayName}.`,
      });
      await switchToCollab();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to create developer access');
    } finally {
      setCreatingDeveloperAccess(false);
    }
  };

  /** docs/56 Decisions #1: a developer login makes the workspace collaborative. */
  const switchToCollab = async () => {
    if (teamMode === 'collab') {
      return;
    }
    try {
      await api.put('/config/team-mode', { teamMode: 'collab' } satisfies TeamModeUpdateRequest);
      await refreshSession();
    } catch {
      addToast({
        type: 'error',
        title: 'Team mode not switched',
        message: 'The login was created, but the workspace is still in solo mode. Switch it in Settings → Team Members.',
      });
    }
  };

  const handleFinish = async () => {
    setStep('syncing');
    setErrorMessage('');

    try {
      await triggerSync.mutateAsync();
      await onComplete();
    } catch (error) {
      setStep(stepOrder[stepOrder.length - 1]!);
      setErrorMessage(error instanceof Error ? error.message : 'Initial Jira sync failed');
    }
  };

  /** "Skip for now": finish the wizard without a Jira sync. */
  const handleSkip = async () => {
    setErrorMessage('');
    await onComplete();
  };

  const activeStepKey: Exclude<WizardStep, 'syncing'> = step === 'syncing' ? stepOrder[stepOrder.length - 1]! : step;
  const activeStepMeta = STEP_COPY[activeStepKey];

  /* ── Syncing overlay ─────────────────────────────── */
  if (step === 'syncing') {
    return (
      <div
        className="relative flex min-h-full items-center justify-center overflow-hidden px-4 py-8"
        style={{
          background: `radial-gradient(circle at 30% 20%, rgba(245, 158, 11, 0.18), transparent 40%), radial-gradient(circle at 70% 80%, rgba(6, 182, 212, 0.14), transparent 50%), var(--bg-canvas)`,
        }}
      >
        <OrbDecoration />
        <motion.div
          className="relative z-10 text-center"
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <div
            className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-[22px]"
            style={{
              background: 'rgba(245, 158, 11, 0.14)',
              boxShadow: '0 0 40px rgba(245, 158, 11, 0.12)',
            }}
          >
            <Loader2 size={28} className="animate-spin" style={{ color: '#fbbf24' }} />
          </div>
          <h2 className="text-[26px] font-semibold tracking-tight md:text-[32px]" style={{ color: 'var(--text-primary)' }}>
            Syncing your workspace
          </h2>
          <p className="mx-auto mt-4 max-w-sm text-[14px] leading-7" style={{ color: 'var(--text-secondary)' }}>
            Pulling Jira data into the manager surface. This usually takes a moment.
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div
      className="relative flex min-h-full items-center justify-center overflow-hidden px-4 py-8"
      style={{
        background: `radial-gradient(circle at 30% 20%, rgba(245, 158, 11, 0.18), transparent 40%), radial-gradient(circle at 70% 80%, rgba(6, 182, 212, 0.14), transparent 50%), var(--bg-canvas)`,
      }}
    >
      <OrbDecoration />

      {/* Theme toggle */}
      <button
        type="button"
        onClick={toggleTheme}
        className="absolute right-5 top-5 z-20 inline-flex items-center gap-2 rounded-full border px-3 py-2 text-[13px] font-semibold transition-colors"
        style={{
          background: 'color-mix(in srgb, var(--bg-primary) 88%, transparent)',
          color: 'var(--text-primary)',
          borderColor: 'var(--border-strong)',
        }}
        aria-label="Toggle theme"
        title="Toggle theme"
      >
        {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        {theme === 'dark' ? 'Light mode' : 'Dark mode'}
      </button>

      {/* Centered wizard content */}
      <div className="relative z-10 flex w-full max-w-[540px] flex-col" style={{ maxHeight: 'calc(100vh - 64px)' }}>
        {/* Branding header */}
        <motion.div
          className="mb-6 text-center"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="mb-4 inline-flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-[14px]"
              style={{
                background: 'rgba(245, 158, 11, 0.18)',
                color: '#fbbf24',
                boxShadow: '0 0 24px rgba(245, 158, 11, 0.14)',
              }}
            >
              <LeadOSMark size={26} />
            </div>
            <div className="text-left">
              <div className="text-[12px] font-semibold uppercase tracking-[0.3em]" style={{ color: '#fbbf24' }}>
                Workspace Setup
              </div>
              <div className="text-[13px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                LeadOS
              </div>
            </div>
          </div>
        </motion.div>

        {/* Step progress indicator */}
        <motion.div
          className="mb-5"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="flex items-center justify-center gap-2">
            {stepOrder.map((stepKey, index) => {
              const meta = STEP_COPY[stepKey];
              const Icon = meta.icon;
              const isActive = stepKey === activeStepKey;
              const isComplete = index < currentStepIndex;

              return (
                <div key={stepKey} className="flex items-center gap-2">
                  <div
                    className="flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[12px] font-semibold transition-all duration-300"
                    style={{
                      borderColor: isActive
                        ? 'rgba(251, 191, 36, 0.5)'
                        : isComplete
                          ? 'rgba(34, 197, 94, 0.35)'
                          : 'var(--border)',
                      background: isActive
                        ? 'rgba(251, 191, 36, 0.12)'
                        : isComplete
                          ? 'rgba(34, 197, 94, 0.08)'
                          : 'transparent',
                      color: isActive
                        ? '#fbbf24'
                        : isComplete
                          ? '#4ade80'
                          : 'var(--text-muted)',
                    }}
                    title={meta.title}
                  >
                    {isComplete ? <Check size={11} /> : <Icon size={11} />}
                    <span className={stepNumber(stepKey) === null ? undefined : 'hidden sm:inline'}>{stepNumber(stepKey) ?? 'with Jira'}</span>
                  </div>
                  {index < stepOrder.length - 1 && (
                    <div
                      className="h-px w-4 transition-colors duration-300"
                      style={{
                        background: index < currentStepIndex
                          ? 'rgba(34, 197, 94, 0.4)'
                          : 'var(--border)',
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </motion.div>

        {/* Main card */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[28px] border"
          style={{
            borderColor: 'var(--border-strong)',
            background: 'color-mix(in srgb, var(--bg-primary) 92%, transparent)',
            boxShadow: 'var(--panel-shadow)',
            backdropFilter: 'blur(20px)',
          }}
        >
          {/* Accent line */}
          <div
            className="absolute inset-x-8 top-0 h-px"
            style={{ background: 'linear-gradient(90deg, transparent, #fbbf24, transparent)' }}
          />

          {/* Step header — always visible */}
          <div className="shrink-0 px-7 pb-0 pt-7 md:px-9 md:pt-9">
            <div className="text-[12px] font-semibold uppercase tracking-[0.24em]" style={{ color: '#fbbf24' }}>
              {stepNumber(activeStepKey) !== null ? `Step ${stepNumber(activeStepKey)} of ${countedSteps.length}` : 'With Jira'}
            </div>
            <h2 className="mt-2 text-[24px] font-semibold leading-tight tracking-tight md:text-[28px]" style={{ color: 'var(--text-primary)' }}>
              {activeStepMeta.title}
            </h2>
            <p className="mt-2 text-[13px] leading-6" style={{ color: 'var(--text-secondary)' }}>
              {activeStepMeta.description}
            </p>

            {errorMessage && (
              <motion.div
                role="alert"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 rounded-[14px] border px-4 py-3 text-[13px]"
                style={{
                  borderColor: 'rgba(239, 68, 68, 0.35)',
                  background: 'rgba(239, 68, 68, 0.08)',
                  color: '#fca5a5',
                }}
              >
                {errorMessage}
              </motion.div>
            )}
          </div>

          {/* Scrollable step content */}
          <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6 md:px-9">
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              >
                <StepContent
                  step={step}
                  workspaceKind={workspaceKind}
                  setWorkspaceKind={setWorkspaceKind}
                  managerUsername={managerUsername}
                  setManagerUsername={setManagerUsername}
                  managerDisplayName={managerDisplayName}
                  setManagerDisplayName={setManagerDisplayName}
                  managerPassword={managerPassword}
                  setManagerPassword={setManagerPassword}
                  creatingManager={creatingManager}
                  handleCreateManager={handleCreateManager}
                  jiraBaseUrl={jiraBaseUrl}
                  setJiraBaseUrl={setJiraBaseUrl}
                  jiraProjectKey={jiraProjectKey}
                  setJiraProjectKey={setJiraProjectKey}
                  jiraEmail={jiraEmail}
                  setJiraEmail={setJiraEmail}
                  jiraApiToken={jiraApiToken}
                  setJiraApiToken={setJiraApiToken}
                  configQuery={configQuery}
                  setConnectionValidated={setConnectionValidated}
                  connectionValidated={connectionValidated}
                  testingConnection={testingConnection}
                  handleTestConnection={handleTestConnection}
                  savingConnection={savingConnection}
                  handleSaveConnection={handleSaveConnection}
                  includeManagerJira={includeManagerJira}
                  setIncludeManagerJira={setIncludeManagerJira}
                  selectedManagerJiraAccountId={selectedManagerJiraAccountId}
                  setSelectedManagerJiraAccountId={setSelectedManagerJiraAccountId}
                  discoveredUsers={discoveredUsers}
                  discoveringUsers={discoveringUsers}
                  loadDiscoverableUsers={loadDiscoverableUsers}
                  discoverQuery={discoverQuery}
                  setDiscoverQuery={setDiscoverQuery}
                  filteredDiscoveredUsers={filteredDiscoveredUsers}
                  selectedDeveloperIds={selectedDeveloperIds}
                  setSelectedDeveloperIds={setSelectedDeveloperIds}
                  savingDevelopers={savingDevelopers}
                  newAccountUsername={newAccountUsername}
                  setNewAccountUsername={setNewAccountUsername}
                  newAccountDisplayName={newAccountDisplayName}
                  setNewAccountDisplayName={setNewAccountDisplayName}
                  newAccountPassword={newAccountPassword}
                  setNewAccountPassword={setNewAccountPassword}
                  newAccountDeveloperId={newAccountDeveloperId}
                  setNewAccountDeveloperId={setNewAccountDeveloperId}
                  trackedDevelopers={trackedDevelopers}
                  eligibleDeveloperAccounts={eligibleDeveloperAccounts}
                  creatingDeveloperAccess={creatingDeveloperAccess}
                  handleCreateDeveloperAccount={handleCreateDeveloperAccount}
                  appUsers={appUsers}
                  loadingUsers={loadingUsers}
                />
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Fixed footer with navigation — always visible */}
          <StepFooter
            step={step}
            workspaceKind={workspaceKind}
            goToStep={goToStep}
            creatingManager={creatingManager}
            handleCreateManager={handleCreateManager}
            managerUsername={managerUsername}
            managerDisplayName={managerDisplayName}
            managerPassword={managerPassword}
            savingConnection={savingConnection}
            handleSaveConnection={handleSaveConnection}
            handleSkip={handleSkip}
            jiraBaseUrl={jiraBaseUrl}
            jiraEmail={jiraEmail}
            jiraProjectKey={jiraProjectKey}
            jiraApiToken={jiraApiToken}
            configQuery={configQuery}
            handleSaveManagerMapping={handleSaveManagerMapping}
            savingDevelopers={savingDevelopers}
            handleSaveTrackedDevelopers={handleSaveTrackedDevelopers}
            handleFinish={handleFinish}
            triggerSyncPending={triggerSync.isPending}
          />
        </motion.section>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   Sub-components
   ══════════════════════════════════════════════════════ */

function OrbDecoration() {
  return (
    <>
      <motion.div
        className="pointer-events-none absolute rounded-full blur-3xl"
        style={{
          width: 500,
          height: 500,
          top: '-10%',
          left: '-8%',
          background: 'radial-gradient(circle, rgba(245, 158, 11, 0.06), transparent 70%)',
        }}
        animate={{ x: [0, 40, 0], y: [0, 30, 0] }}
        transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="pointer-events-none absolute rounded-full blur-3xl"
        style={{
          width: 400,
          height: 400,
          bottom: '-10%',
          right: '-5%',
          background: 'radial-gradient(circle, rgba(6, 182, 212, 0.06), transparent 70%)',
        }}
        animate={{ x: [0, -30, 0], y: [0, -40, 0] }}
        transition={{ duration: 25, repeat: Infinity, ease: 'easeInOut' }}
      />
    </>
  );
}

/* ── Step content (form body only — no footer buttons) ── */

function StepContent(props: StepContentProps) {
  const { step } = props;

  switch (step) {
    case 'manager-account':
      return (
        <div className="space-y-5">
          <fieldset className="space-y-2">
            <legend className="mb-2 text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
              How will you use LeadOS?
            </legend>
            {WORKSPACE_KIND_OPTIONS.map((option) => {
              const selected = props.workspaceKind === option.value;
              return (
                <label
                  key={option.value}
                  className="flex cursor-pointer items-start gap-3 rounded-[16px] border p-4 transition-colors"
                  style={{
                    borderColor: selected ? 'rgba(251, 191, 36, 0.4)' : 'var(--border)',
                    background: selected ? 'rgba(251, 191, 36, 0.06)' : 'var(--bg-tertiary)',
                  }}
                >
                  <input
                    type="radio"
                    name="workspace-kind"
                    value={option.value}
                    checked={selected}
                    onChange={() => props.setWorkspaceKind(option.value)}
                    className="mt-0.5 accent-amber-400"
                  />
                  <span>
                    <span className="block text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>{option.title}</span>
                    <span className="mt-1 block text-[13px] leading-5" style={{ color: 'var(--text-secondary)' }}>{option.description}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>
          <Field label="Username">
            <input
              value={props.managerUsername}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => props.setManagerUsername(e.target.value)}
              placeholder="manager"
              autoFocus
              className={fieldClassName}
              style={fieldStyle}
            />
          </Field>
          <Field label="Display name">
            <input
              value={props.managerDisplayName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => props.setManagerDisplayName(e.target.value)}
              placeholder="Taylor Morgan"
              className={fieldClassName}
              style={fieldStyle}
            />
          </Field>
          <Field label="Password">
            <PasswordInput
              value={props.managerPassword}
              onChange={props.setManagerPassword}
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            />
          </Field>
        </div>
      );

    case 'jira-connection':
      return (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Jira base URL">
              <input
                value={props.jiraBaseUrl}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  props.setJiraBaseUrl(e.target.value);
                  props.setConnectionValidated(false);
                }}
                placeholder="https://tenant.atlassian.net"
                className={fieldClassName}
                style={fieldStyle}
              />
            </Field>
            <Field label="Project key">
              <input
                value={props.jiraProjectKey}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  props.setJiraProjectKey(e.target.value.toUpperCase());
                  props.setConnectionValidated(false);
                }}
                placeholder="AM"
                className={fieldClassName}
                style={fieldStyle}
              />
            </Field>
          </div>
          <Field label="Jira email">
            <input
              type="email"
              value={props.jiraEmail}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                props.setJiraEmail(e.target.value);
                props.setConnectionValidated(false);
              }}
              placeholder="jira-sync@example.com"
              className={fieldClassName}
              style={fieldStyle}
            />
          </Field>
          <Field label="API token">
            <PasswordInput
              value={props.jiraApiToken}
              onChange={(v: string) => {
                props.setJiraApiToken(v);
                props.setConnectionValidated(false);
              }}
              placeholder={props.configQuery.data?.jiraApiToken ? 'Leave blank to keep saved token' : 'Paste API token'}
            />
          </Field>
          <div className="rounded-[14px] border px-4 py-3 text-[13px] leading-5" style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--bg-tertiary) 72%, transparent)', color: 'var(--text-secondary)' }}>
            Skip this step to start with Today, your tasks and notes. Jira can be connected later from Settings.
          </div>
          <button
            type="button"
            onClick={props.handleTestConnection}
            disabled={!props.jiraBaseUrl || !props.jiraEmail || !props.jiraProjectKey || (!props.jiraApiToken && !props.configQuery.data?.jiraApiToken) || props.testingConnection}
            className={secondaryBtnClassName}
            style={secondaryBtnStyle}
          >
            {props.testingConnection ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={14} />}
            {props.connectionValidated ? 'Connection confirmed' : 'Test connection'}
            {props.connectionValidated && <Check size={14} style={{ color: '#4ade80' }} />}
          </button>
        </div>
      );

    case 'manager-mapping':
      return (
        <div className="space-y-5">
          <label
            className="flex cursor-pointer items-start gap-3 rounded-[16px] border p-4 transition-colors"
            style={{
              borderColor: props.includeManagerJira ? 'rgba(251, 191, 36, 0.4)' : 'var(--border)',
              background: props.includeManagerJira ? 'rgba(251, 191, 36, 0.06)' : 'var(--bg-tertiary)',
            }}
          >
            <input
              type="checkbox"
              checked={props.includeManagerJira}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                props.setIncludeManagerJira(e.target.checked);
                if (!e.target.checked) props.setSelectedManagerJiraAccountId('');
              }}
              className="mt-0.5 accent-amber-400"
            />
            <span>
              <span className="block text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                Include manager&apos;s Jira assignments
              </span>
              <span className="mt-1 block text-[13px] leading-5" style={{ color: 'var(--text-secondary)' }}>
                Leave off if using a service account or if the manager stays outside tracked scope.
              </span>
            </span>
          </label>

          {props.includeManagerJira && (
            <>
              <button
                type="button"
                onClick={() => void props.loadDiscoverableUsers()}
                disabled={props.discoveringUsers}
                className={secondaryBtnClassName}
                style={secondaryBtnStyle}
              >
                {props.discoveringUsers ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                Refresh Jira users
              </button>
              <div className="max-h-[240px] space-y-2 overflow-y-auto rounded-[14px] pr-1">
                {props.discoveredUsers.map((candidate: DiscoveredUser) => {
                  const selected = props.selectedManagerJiraAccountId === candidate.accountId;
                  return (
                    <UserRow
                      key={candidate.accountId}
                      user={candidate}
                      selected={selected}
                      accent="amber"
                      onClick={() => props.setSelectedManagerJiraAccountId(candidate.accountId)}
                    />
                  );
                })}
              </div>
            </>
          )}
        </div>
      );

    case 'team-members':
      return (
        <div className="flex flex-col gap-4">
          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
            <input
              value={props.discoverQuery}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => props.setDiscoverQuery(e.target.value)}
              placeholder="Search Jira users…"
              className={`${fieldClassName} pl-10`}
              style={fieldStyle}
            />
          </div>

          {/* Selection counter badge */}
          <div
            className="flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-semibold"
            style={{
              background: props.selectedDeveloperIds.size > 0 ? 'rgba(6, 182, 212, 0.1)' : 'var(--bg-tertiary)',
              color: props.selectedDeveloperIds.size > 0 ? 'var(--accent)' : 'var(--text-muted)',
              border: `1px solid ${props.selectedDeveloperIds.size > 0 ? 'rgba(6, 182, 212, 0.3)' : 'var(--border)'}`,
              alignSelf: 'flex-start',
            }}
          >
            <Users size={12} />
            {props.selectedDeveloperIds.size} selected
          </div>

          {/* Scrollable user list — key fix: constrained height with proper overflow */}
          <div
            className="space-y-2 overflow-y-auto pr-1"
            style={{ maxHeight: 'calc(100vh - 540px)', minHeight: 160 }}
          >
            {props.filteredDiscoveredUsers.length === 0 ? (
              <div className="py-8 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>
                {props.discoverQuery ? 'No matching users found.' : 'No Jira users discovered. Save an empty roster and add people manually from Settings.'}
              </div>
            ) : (
              props.filteredDiscoveredUsers.map((candidate: DiscoveredUser) => {
                const selected = props.selectedDeveloperIds.has(candidate.accountId);
                return (
                  <UserRow
                    key={candidate.accountId}
                    user={candidate}
                    selected={selected}
                    accent="cyan"
                    onClick={() => {
                      props.setSelectedDeveloperIds((current: Set<string>) => {
                        const next = new Set(current);
                        if (next.has(candidate.accountId)) {
                          next.delete(candidate.accountId);
                        } else {
                          next.add(candidate.accountId);
                        }
                        return next;
                      });
                    }}
                  />
                );
              })
            )}
          </div>
        </div>
      );

    case 'developer-access':
      return (
        <div className="space-y-5">
          <div
            className="rounded-[14px] border p-4"
            style={{
              borderColor: 'rgba(6, 182, 212, 0.25)',
              background: 'rgba(6, 182, 212, 0.05)',
            }}
          >
            <div className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
              Developer login link
            </div>
            <div className="mt-1 text-[13px] leading-5" style={{ color: 'var(--text-secondary)' }}>
              Share <span className="rounded-md px-1.5 py-0.5 font-mono text-[12px]" style={{ background: 'var(--bg-tertiary)' }}>{DEVELOPER_LOGIN_URL}</span> with developers after accounts are created.
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Username">
              <input
                value={props.newAccountUsername}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => props.setNewAccountUsername(e.target.value)}
                placeholder="jamie"
                className={fieldClassName}
                style={fieldStyle}
              />
            </Field>
            <Field label="Display name">
              <input
                value={props.newAccountDisplayName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => props.setNewAccountDisplayName(e.target.value)}
                placeholder="Jamie Chen"
                className={fieldClassName}
                style={fieldStyle}
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Password">
              <PasswordInput
                value={props.newAccountPassword}
                onChange={props.setNewAccountPassword}
                placeholder={`Temporary password (${MIN_PASSWORD_LENGTH}+ characters)`}
              />
            </Field>
            <Field label="Tracked developer">
              <select
                value={props.newAccountDeveloperId}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                  const id = e.target.value;
                  props.setNewAccountDeveloperId(id);
                  const matched = props.trackedDevelopers.find((c: DiscoveredUser) => c.accountId === id);
                  if (matched && !props.newAccountDisplayName) {
                    props.setNewAccountDisplayName(matched.displayName);
                  }
                }}
                className={fieldClassName}
                style={fieldStyle}
              >
                <option value="">Select developer</option>
                {props.eligibleDeveloperAccounts.map((c: DiscoveredUser) => (
                  <option key={c.accountId} value={c.accountId}>{c.displayName}</option>
                ))}
              </select>
            </Field>
          </div>
          <button
            type="button"
            onClick={props.handleCreateDeveloperAccount}
            disabled={!props.newAccountUsername.trim() || !props.newAccountDisplayName.trim() || props.newAccountPassword.length < MIN_PASSWORD_LENGTH || !props.newAccountDeveloperId || props.creatingDeveloperAccess}
            className={primaryBtnClassName}
            style={primaryBtnStyle}
          >
            {props.creatingDeveloperAccess ? <Loader2 size={14} className="animate-spin" /> : <ShieldPlus size={14} />}
            Create developer access
          </button>

          {/* Existing accounts list */}
          <div className="rounded-[16px] border" style={{ borderColor: 'var(--border)' }}>
            <div className="border-b px-4 py-2.5 text-[13px] font-semibold uppercase tracking-wider" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
              Existing accounts
            </div>
            <div className="max-h-[180px] overflow-y-auto p-3">
              {props.loadingUsers ? (
                <div className="flex items-center gap-2 py-3 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                  <Loader2 size={14} className="animate-spin" /> Loading…
                </div>
              ) : props.appUsers.length === 0 ? (
                <div className="py-3 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>No accounts yet.</div>
              ) : (
                <div className="space-y-1.5">
                  {props.appUsers.map((account: import('@/types').AuthUser) => (
                    <div
                      key={account.username}
                      className="flex items-center justify-between rounded-[12px] px-3 py-2"
                      style={{ background: 'var(--bg-tertiary)' }}
                    >
                      <div>
                        <div className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                          {account.displayName}
                        </div>
                        <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                          @{account.username} {account.developerAccountId ? `· ${account.developerAccountId}` : '· manager'}
                        </div>
                      </div>
                      <span
                        className="rounded-full px-2 py-0.5 text-[12px] font-semibold uppercase"
                        style={{
                          background: account.role === 'manager' ? 'rgba(245, 158, 11, 0.14)' : 'rgba(6, 182, 212, 0.14)',
                          color: account.role === 'manager' ? 'var(--warning)' : 'var(--accent)',
                        }}
                      >
                        {account.role}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      );

    default:
      return null;
  }
}

/* ── Persistent footer with nav buttons ──────────── */

function StepFooter(props: StepFooterProps) {
  const { step } = props;

  let backAction: (() => void) | undefined;
  let backLabel: string | undefined;
  let primaryAction: () => void;
  let primaryLabel: string;
  let primaryDisabled = false;
  let primaryLoading = false;
  let tertiaryAction: (() => void) | undefined;
  let tertiaryLabel: string | undefined;

  switch (step) {
    case 'manager-account':
      primaryLabel = props.creatingManager ? 'Creating…' : 'Create Account';
      primaryLoading = props.creatingManager;
      primaryDisabled = !props.managerUsername.trim() || !props.managerDisplayName.trim() || props.managerPassword.length < MIN_PASSWORD_LENGTH || props.creatingManager;
      primaryAction = props.handleCreateManager;
      break;
    case 'jira-connection':
      primaryLabel = props.savingConnection ? 'Saving…' : 'Save & Continue';
      primaryLoading = props.savingConnection;
      primaryDisabled = !props.jiraBaseUrl || !props.jiraEmail || !props.jiraProjectKey || (!props.jiraApiToken && !props.configQuery.data?.jiraApiToken) || props.savingConnection;
      primaryAction = props.handleSaveConnection;
      tertiaryLabel = 'Skip for now';
      tertiaryAction = props.handleSkip;
      break;
    case 'manager-mapping':
      backLabel = 'Back';
      backAction = () => props.goToStep('jira-connection');
      primaryLabel = 'Continue';
      primaryAction = props.handleSaveManagerMapping;
      break;
    case 'team-members':
      backLabel = 'Back';
      backAction = () => props.goToStep('manager-mapping');
      primaryLabel = props.savingDevelopers ? 'Saving…' : props.workspaceKind === 'team' ? 'Save Team' : 'Save & Finish';
      primaryLoading = props.savingDevelopers;
      primaryDisabled = props.savingDevelopers;
      primaryAction = props.handleSaveTrackedDevelopers;
      break;
    case 'developer-access':
      backLabel = 'Back';
      backAction = () => props.goToStep('team-members');
      tertiaryLabel = 'Skip for now';
      tertiaryAction = props.handleSkip;
      primaryLabel = 'Finish & Sync';
      primaryDisabled = props.triggerSyncPending;
      primaryAction = props.handleFinish;
      break;
    default:
      primaryLabel = 'Continue';
      primaryAction = () => {};
  }

  return (
    <div
      className="shrink-0 border-t px-7 py-4 md:px-9"
      style={{
        borderColor: 'var(--border)',
        background: 'color-mix(in srgb, var(--bg-primary) 96%, transparent)',
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {backLabel && backAction && (
            <button type="button" onClick={backAction} className={secondaryBtnClassName} style={secondaryBtnStyle}>
              <ArrowLeft size={14} />
              {backLabel}
            </button>
          )}
          {tertiaryLabel && tertiaryAction && (
            <button
              type="button"
              onClick={tertiaryAction}
              className="rounded-[14px] px-3.5 py-2.5 text-[13px] font-medium transition-colors"
              style={{ color: 'var(--text-secondary)' }}
            >
              {tertiaryLabel}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={primaryAction}
          disabled={primaryDisabled}
          className={primaryBtnClassName}
          style={primaryBtnStyle}
        >
          {primaryLoading ? <Loader2 size={14} className="animate-spin" /> : null}
          {primaryLabel}
          {!primaryLoading && <ArrowRight size={14} />}
        </button>
      </div>
    </div>
  );
}

/* ── Reusable user row ────────────────────────────── */

function UserRow({
  user,
  selected,
  accent,
  onClick,
}: {
  user: DiscoveredUser;
  selected: boolean;
  accent: 'amber' | 'cyan';
  onClick: () => void;
}) {
  const colors = accent === 'amber'
    ? { border: 'rgba(251, 191, 36, 0.45)', bg: 'rgba(251, 191, 36, 0.1)', check: '#fbbf24' }
    : { border: 'rgba(6, 182, 212, 0.45)', bg: 'rgba(6, 182, 212, 0.1)', check: 'var(--accent)' };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className="flex w-full items-center justify-between rounded-[14px] border px-4 py-3 text-left transition-all duration-200"
      style={{
        borderColor: selected ? colors.border : 'var(--border)',
        background: selected ? colors.bg : 'var(--bg-tertiary)',
      }}
    >
      <div className="min-w-0">
        <div className="truncate text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          {user.displayName}
        </div>
        <div className="truncate text-[12px]" style={{ color: 'var(--text-secondary)' }}>
          {user.email || user.accountId}
        </div>
      </div>
      {selected && <CircleCheck size={16} className="ml-2 shrink-0" style={{ color: colors.check }} />}
    </button>
  );
}

/* ── Shared small components ─────────────────────── */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[13px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function PasswordInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${fieldClassName} pr-12`}
        style={fieldStyle}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1.5"
        style={{ color: 'var(--text-muted)' }}
        aria-label={show ? 'Hide' : 'Show'}
      >
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}

/* ── Style constants ─────────────────────────────── */

const fieldClassName = 'w-full rounded-[16px] border px-4 py-3 text-[14px] outline-none transition-colors';
const fieldStyle = {
  background: 'var(--bg-tertiary)',
  color: 'var(--text-primary)',
  borderColor: 'var(--border)',
};

const primaryBtnClassName = 'inline-flex items-center justify-center gap-2 rounded-[16px] px-5 py-3 text-[13px] font-semibold transition-all disabled:opacity-40';
const primaryBtnStyle = {
  background: 'linear-gradient(135deg, var(--warning), color-mix(in srgb, var(--warning) 60%, white))',
  color: '#111827',
  boxShadow: '0 4px 20px rgba(245, 158, 11, 0.18)',
};

const secondaryBtnClassName = 'inline-flex items-center justify-center gap-2 rounded-[16px] px-4 py-3 text-[13px] font-semibold transition-colors disabled:opacity-40';
const secondaryBtnStyle = {
  background: 'var(--bg-tertiary)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border)',
};
