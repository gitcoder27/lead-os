import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Save,
  RefreshCw,
  Search,
  AlertTriangle,
  Check,
  Loader2,
  LogOut,
  UserPlus,
  UserMinus,
  Users,
  Shield,
  ChevronDown,
  Copy,
  CheckCircle2,
  Dices,
  Eye,
  EyeOff,
  RefreshCcw,
  Tag,
  Tags,
  Globe,
  Pencil,
  PanelTop,
  Sparkles,
  X,
} from 'lucide-react';
import { useConfig } from '@/hooks/useConfig';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import { useTriggerSync } from '@/hooks/useTriggerSync';
import { useToast } from '@/context/ToastContext';
import { useAuth } from '@/context/AuthContext';
import { DEVELOPER_LOGIN_URL } from '@/lib/constants';
import { useDevelopers } from '@/hooks/useDevelopers';
import {
  useAddManualDeveloper,
  useAddTeamDevelopers,
  useAppUsers,
  useCreateAppUser,
  useDeleteAppUser,
  useDiscoverJiraFields,
  useDiscoverTeamMembers,
  useRemoveTeamDeveloper,
  useResetSettingsConfig,
  useSaveSettingsConfig,
  useTestJiraConnection,
  useUpdateTeamDeveloper,
  type DiscoveredUser,
  type JiraField,
} from '@/hooks/useSettingsActions';
import { TagManagementSection } from '@/components/settings/TagManagementSection';
import { LabelsSection } from '@/components/settings/LabelsSection';
import { SettingsMaintenanceSection } from '@/components/settings/SettingsMaintenanceSection';
import { NavigationSection } from '@/components/settings/NavigationSection';
import { AssistantSection } from '@/components/settings/AssistantSection';
import { useAssistantConfig } from '@/hooks/useAssistantConfig';
import { useTasksPhase3 } from '@/hooks/useTasksPhase3';
import type { AuthUser, Developer, JiraSyncScopeMode } from '@/types';

type FieldPickerTarget = 'dueDate' | 'aspenSeverity';
type SectionId = 'navigation' | 'connection' | 'sync' | 'assistant' | 'team' | 'tags' | 'labels' | 'maintenance' | 'access';
type CreatableUserRole = Extract<AuthUser['role'], 'manager' | 'developer'>;
const DEFAULT_SYNC_SCOPE_MODE: JiraSyncScopeMode = 'team_assignees';

const SECTION_IDS: readonly SectionId[] = ['navigation', 'connection', 'sync', 'assistant', 'team', 'tags', 'labels', 'maintenance', 'access'];

function isSectionId(value: string | null | undefined): value is SectionId {
  return value !== null && value !== undefined && (SECTION_IDS as readonly string[]).includes(value);
}

/** ?section= deep-link — reads the current URL, falling back to the default section. */
function sectionFromLocation(): SectionId {
  const param = new URLSearchParams(window.location.search).get('section');
  return isSectionId(param) ? param : 'connection';
}

interface SettingsPageProps {
  /** Live retarget from onOpenTarget — e.g. Copilot's "Open Settings" while already on /settings. */
  requestedSection?: { section?: string; nonce: number };
}

export function SettingsPage({ requestedSection }: SettingsPageProps = {}) {
  const DISCOVER_PAGE_SIZE = 50;
  const DISCOVER_SEARCH_DEBOUNCE_MS = 350;
  const { user, logout } = useAuth();
  const tasksPhase3 = useTasksPhase3();
  const { data: config, refetch: refetchConfig } = useConfig();
  const { data: assistantConfig } = useAssistantConfig();
  const { data: syncStatus } = useSyncStatus();
  const triggerSync = useTriggerSync();
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const appUsersQuery = useAppUsers();
  const { mutateAsync: createAppUser } = useCreateAppUser();
  const { mutateAsync: deleteAppUser } = useDeleteAppUser();
  const { mutateAsync: testJiraConnection } = useTestJiraConnection();
  const { mutateAsync: discoverJiraFields } = useDiscoverJiraFields();
  const { mutateAsync: saveSettingsConfig } = useSaveSettingsConfig();
  const { mutateAsync: resetSettingsConfig } = useResetSettingsConfig();
  const { mutateAsync: discoverTeamMembers } = useDiscoverTeamMembers();
  const { mutateAsync: addTeamDevelopers } = useAddTeamDevelopers();
  const { mutateAsync: addManualDeveloper } = useAddManualDeveloper();
  const { mutateAsync: updateTeamDeveloper } = useUpdateTeamDeveloper();
  const { mutateAsync: removeTeamDeveloper } = useRemoveTeamDeveloper();

  const [jql, setJql] = useState('');
  const [syncScopeMode, setSyncScopeMode] = useState<JiraSyncScopeMode>(DEFAULT_SYNC_SCOPE_MODE);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(true);
  const [savingAutoSync, setSavingAutoSync] = useState(false);
  const [jiraBaseUrl, setJiraBaseUrl] = useState('');
  const [jiraEmail, setJiraEmail] = useState('');
  const [jiraProjectKey, setJiraProjectKey] = useState('');
  const [devDueDateField, setDevDueDateField] = useState('');
  const [aspenSeverityField, setAspenSeverityField] = useState('');
  const [managerJiraAccountId, setManagerJiraAccountId] = useState('');
  const [jiraApiTokenInput, setJiraApiTokenInput] = useState('');
  const [checkingJiraConnection, setCheckingJiraConnection] = useState(false);
  const [managerSearch, setManagerSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [fields, setFields] = useState<JiraField[]>([]);
  const [loadingFields, setLoadingFields] = useState(false);
  const [fieldSearch, setFieldSearch] = useState('');
  const [fieldPickerTarget, setFieldPickerTarget] = useState<FieldPickerTarget | null>(null);
  const { data: developers = [], isLoading: loadingDevelopers } = useDevelopers();

  const [teamSearch, setTeamSearch] = useState('');
  const [manualMemberName, setManualMemberName] = useState('');
  const [manualMemberEmail, setManualMemberEmail] = useState('');
  const [manualMemberJiraAccountId, setManualMemberJiraAccountId] = useState('');
  const [savingManualMember, setSavingManualMember] = useState(false);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editingMemberName, setEditingMemberName] = useState('');
  const [editingMemberEmail, setEditingMemberEmail] = useState('');
  const [editingMemberJiraAccountId, setEditingMemberJiraAccountId] = useState('');
  const [savingMemberId, setSavingMemberId] = useState<string | null>(null);
  const [discoveredUsers, setDiscoveredUsers] = useState<DiscoveredUser[]>([]);
  const [discoveredSearch, setDiscoveredSearch] = useState('');
  const [discoveringTeam, setDiscoveringTeam] = useState(false);
  const [loadingMoreTeam, setLoadingMoreTeam] = useState(false);
  const [discoverTeamError, setDiscoverTeamError] = useState('');
  const [discoverHasMore, setDiscoverHasMore] = useState(false);
  const [discoverNextStartAt, setDiscoverNextStartAt] = useState(0);
  const [debouncedDiscoveredSearch, setDebouncedDiscoveredSearch] = useState('');
  const [selectedAddUsers, setSelectedAddUsers] = useState<Set<string>>(new Set());
  const [savingTeam, setSavingTeam] = useState(false);
  const [confirmRemoveAccountId, setConfirmRemoveAccountId] = useState<string | null>(null);
  const [removingAccountId, setRemovingAccountId] = useState<string | null>(null);
  const discoverRequestRef = useRef(0);

  const appUsers = appUsersQuery.data ?? [];
  const loadingUsers = appUsersQuery.isLoading;
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<CreatableUserRole>('developer');
  const [newDevAccountId, setNewDevAccountId] = useState('');
  const [creatingUser, setCreatingUser] = useState(false);
  const [confirmDeleteUsername, setConfirmDeleteUsername] = useState<string | null>(null);
  const [deletingUsername, setDeletingUsername] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionId>(sectionFromLocation);
  const [showPasswordGen, setShowPasswordGen] = useState(false);
  const [showNewPw, setShowNewPw] = useState(true);
  const [copiedPw, setCopiedPw] = useState(false);
  const [pwLength, setPwLength] = useState(12);
  const [pwUppercase, setPwUppercase] = useState(true);
  const [pwLowercase, setPwLowercase] = useState(true);
  const [pwDigits, setPwDigits] = useState(true);
  const [pwSymbols, setPwSymbols] = useState(true);

  const trimmedJiraBaseUrl = jiraBaseUrl.trim();
  const trimmedJiraEmail = jiraEmail.trim();
  const trimmedJiraProjectKey = jiraProjectKey.trim();
  const activeMemberIds = useMemo(() => new Set(developers.map((developer) => developer.accountId)), [developers]);
  const canUseJiraDirectory = Boolean(config?.jiraBaseUrl && config?.jiraEmail && config?.jiraProjectKey && config?.jiraApiToken);
  const syncErrorMessage = syncStatus?.status === 'error' ? syncStatus.errorMessage : undefined;
  const connectionNeedsAttention = Boolean(syncErrorMessage);
  const canTestJiraConnection = Boolean(trimmedJiraBaseUrl && trimmedJiraEmail && (jiraApiTokenInput.trim() || config?.jiraApiToken));

  const filteredDevelopers = useMemo(
    () =>
      developers.filter(
        (developer) =>
          developer.displayName.toLowerCase().includes(teamSearch.toLowerCase()) ||
          (developer.email?.toLowerCase().includes(teamSearch.toLowerCase()) ?? false)
      ),
    [developers, teamSearch]
  );

  const teamActionLoading = savingTeam || savingManualMember || Boolean(removingAccountId) || Boolean(savingMemberId) || loadingMoreTeam || triggerSync.isPending;
  const addableSelectionCount = useMemo(
    () => Array.from(selectedAddUsers).filter((accountId) => !activeMemberIds.has(accountId)).length,
    [selectedAddUsers, activeMemberIds]
  );

  useEffect(() => {
    if (config) {
      setJiraBaseUrl(config.jiraBaseUrl || '');
      setJiraEmail(config.jiraEmail || '');
      setJiraProjectKey(config.jiraProjectKey || '');
      setJql(config.jiraSyncJql || '');
      setSyncScopeMode(config.jiraSyncScopeMode || DEFAULT_SYNC_SCOPE_MODE);
      setAutoSyncEnabled(config.jiraAutoSyncEnabled ?? true);
      setDevDueDateField(config.jiraDevDueDateField || 'customfield_10128');
      setAspenSeverityField(config.jiraAspenSeverityField || '');
      setManagerJiraAccountId(config.managerJiraAccountId || '');
    }
  }, [config]);

  const handleToggleAutoSync = async (nextEnabled: boolean) => {
    const previous = autoSyncEnabled;
    setAutoSyncEnabled(nextEnabled);
    setSavingAutoSync(true);
    try {
      await saveSettingsConfig({ jiraAutoSyncEnabled: nextEnabled });
      await refetchConfig();
      await queryClient.invalidateQueries({ queryKey: ['syncStatus'] });
      addToast({
        type: 'success',
        title: nextEnabled ? 'Auto-sync enabled' : 'Auto-sync disabled',
        message: nextEnabled
          ? 'LeadOS will refresh Jira issues on its regular schedule again.'
          : 'Scheduled Jira syncs are off. Use the refresh button for manual syncs.',
      });
    } catch (err) {
      setAutoSyncEnabled(previous);
      addToast({ type: 'error', title: 'Failed to update auto-sync', message: err instanceof Error ? err.message : 'Unable to save settings' });
    } finally {
      setSavingAutoSync(false);
    }
  };

  const handleCreateUser = async () => {
    if (!newUsername.trim() || !newDisplayName.trim() || !newPassword.trim()) return;
    if (newRole === 'developer' && !newDevAccountId) {
      addToast({ type: 'error', title: 'Missing team member', message: 'Developer accounts must be linked to an active team member.' });
      return;
    }
    setCreatingUser(true);
    try {
      const res = await createAppUser({
        username: newUsername.trim(),
        password: newPassword.trim(),
        displayName: newDisplayName.trim(),
        role: newRole,
        ...(newRole === 'developer' ? { developerAccountId: newDevAccountId } : {}),
      });
      setNewUsername('');
      setNewDisplayName('');
      setNewPassword('');
      setNewRole('developer');
      setNewDevAccountId('');
      setShowCreateUser(false);
      addToast({ type: 'success', title: 'User created', message: `Account "${res.user.username}" created successfully.` });
    } catch (err) {
      addToast({ type: 'error', title: 'Failed to create user', message: err instanceof Error ? err.message : 'Request failed' });
    } finally {
      setCreatingUser(false);
    }
  };

  const handleCopyDevLink = () => {
    navigator.clipboard.writeText(DEVELOPER_LOGIN_URL).then(() => {
      setCopiedLink(true);
      addToast({ type: 'success', title: 'Link copied', message: DEVELOPER_LOGIN_URL });
      setTimeout(() => setCopiedLink(false), 2000);
    });
  };

  const handleDeleteUser = useCallback(async (user: AuthUser) => {
    setDeletingUsername(user.username);
    try {
      await deleteAppUser(user.username);
      setConfirmDeleteUsername((current) => (current === user.username ? null : current));
      addToast({
        type: 'success',
        title: 'Developer account deleted',
        message: `Removed "${user.displayName}" from app access.`,
      });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Failed to delete account',
        message: err instanceof Error ? err.message : 'Request failed',
      });
    } finally {
      setDeletingUsername(null);
    }
  }, [addToast, deleteAppUser]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedDiscoveredSearch(discoveredSearch.trim());
    }, DISCOVER_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [discoveredSearch]);

  // Deep-links like /settings?section=assistant — both on mount and when a
  // requestedSection target arrives while the page is already mounted.
  useEffect(() => {
    if (isSectionId(requestedSection?.section)) {
      setActiveSection(requestedSection.section);
    }
  }, [requestedSection]);

  const handleDiscoverFields = useCallback(async (target: FieldPickerTarget) => {
    setFieldPickerTarget(target);
    setFieldSearch('');
    setLoadingFields(true);
    try {
      const fields = await discoverJiraFields();
      setFields(fields);
    } catch (err) {
      setFieldPickerTarget(null);
      addToast({ type: 'error', title: 'Failed to fetch Jira fields', message: err instanceof Error ? err.message : 'Request failed' });
    } finally {
      setLoadingFields(false);
    }
  }, [addToast, discoverJiraFields]);

  const handleCheckJiraConnection = async () => {
    const candidateToken = jiraApiTokenInput.trim();
    if (!trimmedJiraBaseUrl || !trimmedJiraEmail) {
      addToast({ type: 'error', title: 'Missing Jira connection', message: 'Base URL and email must be configured before testing a new API token.' });
      return;
    }
    if (!candidateToken && !config?.jiraApiToken) {
      addToast({ type: 'error', title: 'Missing Jira token', message: 'Paste a Jira API token before testing this connection.' });
      return;
    }

    setCheckingJiraConnection(true);
    try {
      const result = await testJiraConnection({
        jiraBaseUrl: trimmedJiraBaseUrl,
        jiraEmail: trimmedJiraEmail,
        ...(trimmedJiraProjectKey ? { jiraProjectKey: trimmedJiraProjectKey } : {}),
        ...(candidateToken ? { jiraApiToken: candidateToken } : {}),
      });
      const displayName = result.user?.displayName ?? trimmedJiraEmail ?? 'Jira';
      addToast({ type: 'success', title: 'Jira connection verified', message: `${displayName} can authenticate with Jira.` });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Jira connection needs attention',
        message: err instanceof Error ? err.message : 'Unable to verify the Jira API token.',
      });
    } finally {
      setCheckingJiraConnection(false);
    }
  };

  const handleSave = async (): Promise<boolean> => {
    setSaving(true);
    try {
      const trimmedToken = jiraApiTokenInput.trim();
      await saveSettingsConfig({
        ...(trimmedJiraBaseUrl ? { jiraBaseUrl: trimmedJiraBaseUrl } : {}),
        ...(trimmedJiraEmail ? { jiraEmail: trimmedJiraEmail } : {}),
        ...(trimmedJiraProjectKey ? { jiraProjectKey: trimmedJiraProjectKey } : {}),
        jiraSyncScopeMode: syncScopeMode,
        jiraSyncJql: jql,
        jiraDevDueDateField: devDueDateField,
        jiraAspenSeverityField: aspenSeverityField,
        managerJiraAccountId: managerJiraAccountId.trim(),
        jiraAutoSyncEnabled: autoSyncEnabled,
        ...(trimmedToken ? { jiraApiToken: trimmedToken } : {}),
      });
      if (trimmedToken) {
        setJiraApiTokenInput('');
      }
      await refetchConfig();
      addToast({
        type: 'success',
        title: 'Settings saved',
        message: trimmedToken ? 'Your Jira sync settings and new API token have been saved.' : 'Your Jira sync settings have been saved.',
      });
      return true;
    } catch (err) {
      addToast({ type: 'error', title: 'Failed to save settings', message: err instanceof Error ? err.message : 'Unable to save settings' });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAndSync = async () => {
    const saved = await handleSave();
    if (!saved) {
      return;
    }

    try {
      await triggerSync.mutateAsync();
      addToast({ type: 'success', title: 'Sync triggered with new settings', message: 'Issue sync has started.' });
    } catch (err) {
      addToast({ type: 'error', title: err instanceof Error ? err.message : 'Sync failed', message: 'Could not sync with updated settings.' });
    }
  };

  const handleResetConfig = async () => {
    if (!window.confirm('This will clear Jira configuration and return you to onboarding. Continue?')) {
      return;
    }

    setResetting(true);
    try {
      await resetSettingsConfig();
      await queryClient.invalidateQueries({ queryKey: ['config'] });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['issues'] }),
        queryClient.invalidateQueries({ queryKey: ['overview'] }),
        queryClient.invalidateQueries({ queryKey: ['workload'] }),
        queryClient.invalidateQueries({ queryKey: ['alerts'] }),
      ]);
      addToast({ type: 'success', title: 'Configuration reset', message: 'Re-run setup to configure a new Jira account.' });
    } catch (err) {
      addToast({ type: 'error', title: 'Failed to reset configuration', message: err instanceof Error ? err.message : 'Please try again.' });
    } finally {
      setResetting(false);
    }
  };

  const handleManagerLogout = useCallback(async () => {
    setLoggingOut(true);
    try {
      await logout();
      queryClient.clear();
      window.history.replaceState(null, '', '/');
      window.location.reload();
    } catch (err) {
      setLoggingOut(false);
      addToast({
        type: 'error',
        title: 'Failed to log out',
        message: err instanceof Error ? err.message : 'Request failed',
      });
    }
  }, [addToast, logout, queryClient]);

  const filteredFields = fields.filter(
    (field) =>
      field.name.toLowerCase().includes(fieldSearch.toLowerCase()) ||
      field.id.toLowerCase().includes(fieldSearch.toLowerCase())
  );

  const currentFieldValue = fieldPickerTarget === 'aspenSeverity' ? aspenSeverityField : devDueDateField;
  const preferredKeywords = fieldPickerTarget === 'aspenSeverity' ? ['severity', 'aspen'] : ['due', 'date'];

  const preferredFields = filteredFields.filter(
    (field) =>
      field.custom &&
      (preferredKeywords.some((keyword) => field.name.toLowerCase().includes(keyword)) ||
        field.id === currentFieldValue)
  );

  const otherFields = filteredFields.filter(
    (field) => field.custom && !preferredFields.includes(field)
  );

  const handleFieldSelection = useCallback((fieldId: string) => {
    if (fieldPickerTarget === 'aspenSeverity') {
      setAspenSeverityField(fieldId);
    } else {
      setDevDueDateField(fieldId);
    }
    setFieldPickerTarget(null);
  }, [fieldPickerTarget]);

  const invalidateTeamScopeData = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['developers'] }),
      queryClient.invalidateQueries({ queryKey: ['issues'] }),
      queryClient.invalidateQueries({ queryKey: ['workload'] }),
      queryClient.invalidateQueries({ queryKey: ['overview'] }),
      queryClient.invalidateQueries({ queryKey: ['alerts'] }),
      queryClient.invalidateQueries({ queryKey: ['syncStatus'] }),
      queryClient.invalidateQueries({ queryKey: ['team-tracker'] }),
      queryClient.invalidateQueries({ queryKey: ['manager-desk'] }),
      queryClient.invalidateQueries({ queryKey: ['my-day'] }),
    ]);
  }, [queryClient]);

  const syncTeamMembershipChange = useCallback(async (successMessage: string) => {
    try {
      await triggerSync.mutateAsync();
      await invalidateTeamScopeData();
      addToast({
        type: 'success',
        title: 'Team updated and synced',
        message: successMessage,
      });
    } catch (err) {
      await invalidateTeamScopeData();
      addToast({
        type: 'error',
        title: 'Team updated but sync failed',
        message: err instanceof Error
          ? `The membership change was saved, but the immediate sync failed: ${err.message}`
          : 'The membership change was saved, but the immediate sync failed.',
      });
    }
  }, [addToast, invalidateTeamScopeData, triggerSync]);

  const handleDiscoverTeamMembers = useCallback(
    async (options?: { query?: string; startAt?: number; append?: boolean; silentEmpty?: boolean }) => {
      const query = options?.query ?? '';
      const startAt = options?.startAt ?? 0;
      const append = options?.append ?? false;
      const requestId = ++discoverRequestRef.current;

      if (!canUseJiraDirectory) {
        setDiscoveredUsers([]);
        setDiscoverHasMore(false);
        setDiscoverTeamError('');
        return;
      }

      if (append) {
        setLoadingMoreTeam(true);
      } else {
        setDiscoveringTeam(true);
        setDiscoverTeamError('');
      }

      try {
        const res = await discoverTeamMembers({
          query,
          startAt,
          maxResults: DISCOVER_PAGE_SIZE,
        });

        if (requestId !== discoverRequestRef.current) {
          return;
        }

        setDiscoverHasMore(res.hasMore);
        setDiscoverNextStartAt(startAt + res.users.length);
        if (!append) {
          setSelectedAddUsers(new Set());
        }
        setDiscoveredUsers((prev) => {
          if (!append) {
            return res.users;
          }
          const merged = new Map(prev.map((user) => [user.accountId, user]));
          for (const user of res.users) {
            merged.set(user.accountId, user);
          }
          return Array.from(merged.values());
        });

        if (!append && res.users.length === 0 && !options?.silentEmpty) {
          addToast({ type: 'warning', title: 'No team members found', message: 'No Jira users matched this search.' });
        }
      } catch (error) {
        if (requestId !== discoverRequestRef.current) {
          return;
        }
        setDiscoverTeamError(error instanceof Error ? error.message : 'Failed to discover Jira users');
        setDiscoverHasMore(false);
        if (!append) {
          setDiscoveredUsers([]);
        }
        addToast({ type: 'error', title: 'Failed to discover team members', message: error instanceof Error ? error.message : 'Request failed' });
      } finally {
        if (requestId !== discoverRequestRef.current) {
          return;
        }
        if (append) {
          setLoadingMoreTeam(false);
        } else {
          setDiscoveringTeam(false);
        }
      }
    },
    [addToast, canUseJiraDirectory, discoverTeamMembers]
  );

  useEffect(() => {
    void handleDiscoverTeamMembers({
      query: debouncedDiscoveredSearch,
      startAt: 0,
      append: false,
      silentEmpty: debouncedDiscoveredSearch.length === 0,
    });
  }, [debouncedDiscoveredSearch, handleDiscoverTeamMembers]);

  const handleToggleAddUser = useCallback((accountId: string) => {
    setSelectedAddUsers((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) {
        next.delete(accountId);
      } else {
        next.add(accountId);
      }
      return next;
    });
  }, []);

  const handleSelectAllDiscovered = useCallback(() => {
    setSelectedAddUsers(
      new Set(discoveredUsers.filter((user) => !activeMemberIds.has(user.accountId)).map((user) => user.accountId))
    );
  }, [activeMemberIds, discoveredUsers]);

  const handleClearAddSelection = useCallback(() => {
    setSelectedAddUsers(new Set());
  }, []);

  const handleAddSelectedDevelopers = useCallback(async () => {
    if (selectedAddUsers.size === 0) {
      return;
    }

    setSavingTeam(true);
    try {
      const candidates = discoveredUsers.filter((user) => selectedAddUsers.has(user.accountId));
      const newMembers = candidates.filter((user) => !activeMemberIds.has(user.accountId));
      if (newMembers.length === 0) {
        addToast({
          type: 'info',
          title: 'No new members',
          message: 'Selected users are already on your team.',
        });
        setSelectedAddUsers(new Set());
        return;
      }

      await addTeamDevelopers(newMembers);
      setSelectedAddUsers(new Set());
      await syncTeamMembershipChange(
        `Added ${newMembers.length} team member${newMembers.length === 1 ? '' : 's'} and synced issues.`
      );
    } catch (err) {
      addToast({ type: 'error', title: 'Failed to add team members', message: err instanceof Error ? err.message : 'Request failed' });
    } finally {
      setSavingTeam(false);
    }
  }, [activeMemberIds, addTeamDevelopers, discoveredUsers, selectedAddUsers, addToast, syncTeamMembershipChange]);

  const handleAddManualMember = useCallback(async () => {
    if (!manualMemberName.trim()) {
      return;
    }

    setSavingManualMember(true);
    try {
      await addManualDeveloper({
        displayName: manualMemberName.trim(),
        email: manualMemberEmail.trim(),
        ...(manualMemberJiraAccountId.trim() ? { jiraAccountId: manualMemberJiraAccountId.trim() } : {}),
      });
      setManualMemberName('');
      setManualMemberEmail('');
      setManualMemberJiraAccountId('');
      await invalidateTeamScopeData();
      addToast({
        type: 'success',
        title: 'Team member added',
        message: 'Manual team member is ready for Team, Desk, and My Day workflows.',
      });
    } catch (err) {
      addToast({ type: 'error', title: 'Failed to add team member', message: err instanceof Error ? err.message : 'Request failed' });
    } finally {
      setSavingManualMember(false);
    }
  }, [addManualDeveloper, addToast, invalidateTeamScopeData, manualMemberEmail, manualMemberJiraAccountId, manualMemberName]);

  const startEditingMember = useCallback((member: Developer) => {
    setConfirmRemoveAccountId(null);
    setEditingMemberId(member.accountId);
    setEditingMemberName(member.displayName);
    setEditingMemberEmail(member.email ?? '');
    setEditingMemberJiraAccountId(member.jiraAccountId ?? (member.source === 'manual' ? '' : member.accountId));
  }, []);

  const cancelEditingMember = useCallback(() => {
    setEditingMemberId(null);
    setEditingMemberName('');
    setEditingMemberEmail('');
    setEditingMemberJiraAccountId('');
  }, []);

  const handleSaveEditedMember = useCallback(async () => {
    if (!editingMemberId || !editingMemberName.trim()) {
      return;
    }

    setSavingMemberId(editingMemberId);
    try {
      await updateTeamDeveloper({
        accountId: editingMemberId,
        displayName: editingMemberName.trim(),
        email: editingMemberEmail.trim(),
        jiraAccountId: editingMemberJiraAccountId.trim(),
      });
      cancelEditingMember();
      await invalidateTeamScopeData();
      addToast({
        type: 'success',
        title: 'Team member updated',
        message: 'Team member details are up to date.',
      });
    } catch (err) {
      addToast({ type: 'error', title: 'Failed to update team member', message: err instanceof Error ? err.message : 'Request failed' });
    } finally {
      setSavingMemberId(null);
    }
  }, [addToast, cancelEditingMember, editingMemberEmail, editingMemberId, editingMemberJiraAccountId, editingMemberName, invalidateTeamScopeData, updateTeamDeveloper]);

  const handleRemoveMember = useCallback(async (accountId: string) => {
    setRemovingAccountId(accountId);
    try {
      await removeTeamDeveloper(accountId);
      setConfirmRemoveAccountId((current) => (current === accountId ? null : current));
      await syncTeamMembershipChange('Developer removed from tracked team and synced issues.');
    } catch (err) {
      addToast({ type: 'error', title: 'Failed to remove developer', message: err instanceof Error ? err.message : 'Request failed' });
    } finally {
      setRemovingAccountId(null);
    }
  }, [addToast, removeTeamDeveloper, syncTeamMembershipChange]);

  const hasChanges = saving || triggerSync.isPending || resetting || teamActionLoading || checkingJiraConnection;

  const knownJiraUsers = useMemo(() => {
    const merged = new Map<string, DiscoveredUser>();

    for (const developer of developers) {
      const jiraAccountId = developer.jiraAccountId ?? (developer.source === 'manual' ? undefined : developer.accountId);
      if (!jiraAccountId) {
        continue;
      }
      merged.set(jiraAccountId, {
        accountId: jiraAccountId,
        displayName: developer.displayName,
        email: developer.email,
        avatarUrl: developer.avatarUrl,
      });
    }

    for (const user of discoveredUsers) {
      const existing = merged.get(user.accountId);
      merged.set(user.accountId, existing ? { ...existing, ...user } : user);
    }

    return Array.from(merged.values());
  }, [developers, discoveredUsers]);

  const selectedManagerProfile = useMemo(
    () => knownJiraUsers.find((user) => user.accountId === managerJiraAccountId) ?? null,
    [knownJiraUsers, managerJiraAccountId]
  );

  const managerSuggestions = useMemo(() => {
    const term = managerSearch.trim().toLowerCase();
    const filtered = term
      ? knownJiraUsers.filter((user) =>
          user.displayName.toLowerCase().includes(term) ||
          user.accountId.toLowerCase().includes(term) ||
          (user.email?.toLowerCase().includes(term) ?? false)
        )
      : knownJiraUsers;

    if (selectedManagerProfile && !filtered.some((user) => user.accountId === selectedManagerProfile.accountId)) {
      return [selectedManagerProfile, ...filtered].slice(0, 6);
    }

    return filtered.slice(0, 6);
  }, [knownJiraUsers, managerSearch, selectedManagerProfile]);

  const connectionLabel = useMemo(() => {
    if (!trimmedJiraBaseUrl) {
      return 'Connection pending';
    }

    try {
      return new URL(trimmedJiraBaseUrl).host;
    } catch {
      return trimmedJiraBaseUrl;
    }
  }, [trimmedJiraBaseUrl]);

  const syncScopeLabel = syncScopeMode === 'base_query' ? 'Base query' : 'Team assignees';

  const SECTION_LABELS: Record<SectionId, { title: string; description: string }> = {
    navigation: { title: 'Navigation', description: 'Choose which pages stay in the top bar and arrange their order.' },
    connection: { title: 'Jira Connection', description: 'Review the active workspace and set the lead manager identity.' },
    sync: { title: 'Sync Scope', description: 'Control scheduled Jira syncs, the base defect query, and custom field mapping.' },
    assistant: { title: 'Copilot', description: 'AI assistant provider, model, and API key.' },
    team: { title: 'Team Members', description: 'Manage tracked developers for workload, routing, and sync scope.' },
    tags: { title: 'Defect Tags', description: 'Review the shared tag library and safely remove labels.' },
    labels: { title: 'Task Labels', description: 'Manage the shared task label library — add, rename, recolor, or remove labels.' },
    maintenance: { title: 'Data Maintenance', description: 'Preview and run rare cleanup resets for Manager Desk and Team Tracker.' },
    access: { title: 'Developer Access', description: 'Create developer accounts and manage app user access.' },
  };

  const navItems: Array<{ id: SectionId; icon: ReactNode; label: string; status: string | null; sv: 'success' | 'warning' | 'muted' }> = [
    { id: 'navigation', icon: <PanelTop size={13} />, label: 'Navigation', status: null, sv: 'muted' },
    { id: 'connection', icon: <Globe size={13} />, label: 'Jira Connection', status: connectionNeedsAttention ? 'Needs attention' : connectionLabel !== 'Connection pending' ? connectionLabel : null, sv: connectionNeedsAttention ? 'warning' : config?.jiraBaseUrl ? 'success' : 'muted' },
    { id: 'sync', icon: <RefreshCw size={13} />, label: 'Sync Scope', status: !autoSyncEnabled ? 'Auto-sync off' : jql ? syncScopeLabel : 'No query', sv: !autoSyncEnabled ? 'muted' : jql ? 'muted' : 'warning' },
    { id: 'assistant', icon: <Sparkles size={13} />, label: 'Copilot', status: assistantConfig?.enabled && assistantConfig?.hasApiKey ? 'On' : 'Off', sv: assistantConfig?.enabled && assistantConfig?.hasApiKey ? 'success' : 'muted' },
    { id: 'team', icon: <Users size={13} />, label: 'Team Members', status: `${developers.length} tracked`, sv: 'muted' },
    { id: 'tags', icon: <Tag size={13} />, label: 'Defect Tags', status: null, sv: 'muted' },
    ...(tasksPhase3 ? [{ id: 'labels' as const, icon: <Tags size={13} />, label: 'Task Labels', status: null, sv: 'muted' as const }] : []),
    { id: 'maintenance', icon: <AlertTriangle size={13} />, label: 'Data Maintenance', status: 'Danger zone', sv: 'warning' },
    { id: 'access', icon: <Shield size={13} />, label: 'Developer Access', status: !loadingUsers ? `${appUsers.length} user${appUsers.length !== 1 ? 's' : ''}` : null, sv: 'muted' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      className="flex h-full min-h-0 flex-col overflow-hidden"
      style={{
        background: 'var(--bg-primary)',
        ['--settings-shell-bg' as string]: 'linear-gradient(180deg, color-mix(in srgb, var(--bg-primary) 92%, var(--accent) 8%) 0%, color-mix(in srgb, var(--bg-secondary) 94%, transparent) 100%)',
        ['--settings-shell-border' as string]: '1px solid color-mix(in srgb, var(--border-strong) 88%, transparent)',
        ['--settings-shell-shadow' as string]: '0 18px 44px color-mix(in srgb, var(--text-primary) 8%, transparent)',
        ['--settings-soft-bg' as string]: 'color-mix(in srgb, var(--bg-tertiary) 84%, var(--bg-primary))',
        ['--settings-soft-border' as string]: '1px solid color-mix(in srgb, var(--border-strong) 82%, transparent)',
        ['--settings-deep-bg' as string]: 'color-mix(in srgb, var(--bg-secondary) 90%, var(--bg-primary))',
        ['--settings-deep-border' as string]: '1px solid color-mix(in srgb, var(--border-strong) 86%, transparent)',
        ['--settings-input-bg' as string]: 'color-mix(in srgb, var(--bg-primary) 82%, var(--bg-secondary) 18%)',
        ['--settings-input-border' as string]: '1px solid color-mix(in srgb, var(--border-strong) 86%, transparent)',
        ['--settings-neutral-chip-bg' as string]: 'color-mix(in srgb, var(--bg-primary) 88%, var(--bg-secondary) 12%)',
        ['--settings-accent-chip-bg' as string]: 'color-mix(in srgb, var(--accent) 12%, var(--bg-primary))',
        ['--settings-subtle-shadow' as string]: '0 10px 24px color-mix(in srgb, var(--text-primary) 6%, transparent)',
        ['--settings-pane-bg' as string]: 'color-mix(in srgb, var(--bg-secondary) 58%, var(--bg-primary) 42%)',
        ['--settings-pane-strong-bg' as string]: 'linear-gradient(180deg, color-mix(in srgb, var(--bg-secondary) 78%, var(--bg-primary) 22%) 0%, color-mix(in srgb, var(--bg-primary) 90%, transparent) 100%)',
        ['--settings-pane-border' as string]: '1px solid color-mix(in srgb, var(--border-strong) 84%, transparent)',
        ['--settings-inset-bg' as string]: 'color-mix(in srgb, var(--bg-tertiary) 72%, var(--bg-primary) 28%)',
        ['--settings-inset-border' as string]: '1px solid color-mix(in srgb, var(--border-strong) 76%, transparent)',
        ['--settings-row-even-bg' as string]: 'color-mix(in srgb, var(--bg-secondary) 62%, var(--bg-primary) 38%)',
        ['--settings-row-odd-bg' as string]: 'color-mix(in srgb, var(--bg-secondary) 48%, var(--bg-primary) 52%)',
        ['--settings-row-divider' as string]: '1px solid color-mix(in srgb, var(--border-strong) 72%, transparent)',
        ['--settings-accent-soft-bg' as string]: 'color-mix(in srgb, var(--accent) 12%, var(--bg-primary))',
        ['--settings-accent-soft-border' as string]: '1px solid color-mix(in srgb, var(--accent) 22%, var(--border-strong))',
        ['--settings-success-soft-bg' as string]: 'color-mix(in srgb, var(--success) 10%, var(--bg-primary))',
        ['--settings-success-soft-border' as string]: '1px solid color-mix(in srgb, var(--success) 24%, var(--border-strong))',
        ['--settings-warning-soft-bg' as string]: 'color-mix(in srgb, var(--warning) 12%, var(--bg-primary))',
        ['--settings-warning-soft-border' as string]: '1px solid color-mix(in srgb, var(--warning) 24%, var(--border-strong))',
        ['--settings-danger-soft-bg' as string]: 'color-mix(in srgb, var(--danger) 10%, var(--bg-primary))',
        ['--settings-danger-soft-border' as string]: '1px solid color-mix(in srgb, var(--danger) 24%, var(--border-strong))',
        ['--settings-code-bg' as string]: 'color-mix(in srgb, var(--bg-secondary) 68%, var(--bg-primary) 32%)',
        ['--settings-hero-badge-bg' as string]: 'color-mix(in srgb, var(--accent) 12%, var(--bg-primary))',
        ['--settings-hero-badge-border' as string]: '1px solid color-mix(in srgb, var(--accent) 24%, var(--border-strong))',
        ['--settings-hero-badge-text' as string]: 'var(--accent)',
        ['--settings-cta-bg' as string]: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 24%, var(--bg-primary)), color-mix(in srgb, var(--success) 18%, var(--bg-primary)))',
        ['--settings-cta-border' as string]: '1px solid color-mix(in srgb, var(--success) 28%, var(--border-strong))',
        ['--settings-cta-text' as string]: 'color-mix(in srgb, var(--text-primary) 92%, var(--bg-primary) 8%)',
        ['--settings-cta-primary-bg' as string]: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 90%, white 10%), color-mix(in srgb, var(--info) 72%, var(--accent) 28%))',
        ['--settings-cta-primary-text' as string]: '#f8fbff',
      }}
    >
      {/* ── SIDEBAR + CONTENT ───────────────────────────────── */}
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden md:flex-row">

        {/* ── SIDEBAR ─────────────────────────────────────────── */}
        <aside
          className="flex w-full shrink-0 flex-col overflow-hidden md:w-[214px]"
          style={{
            borderRight: 'var(--settings-pane-border)',
            background: 'color-mix(in srgb, var(--bg-secondary) 72%, var(--bg-primary) 28%)',
          }}
        >
          {/* Sidebar header */}
          <div
            className="flex items-center gap-2 border-b px-3 py-2.5"
            style={{ borderColor: 'var(--border-strong)' }}
          >
            <div
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded"
              style={{ background: 'var(--settings-accent-soft-bg)', color: 'var(--accent)', border: 'var(--settings-accent-soft-border)' }}
            >
              <Globe size={11} />
            </div>
            <span className="text-[13px] font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              Settings
            </span>
          </div>

          {/* Nav items */}
          <nav className="flex gap-1 overflow-x-auto p-1.5 md:flex-1 md:flex-col md:overflow-x-visible md:overflow-y-auto">
            {navItems.map((item) => {
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveSection(item.id)}
                  className="relative flex min-w-[168px] items-start gap-2 rounded-md py-1.5 text-left transition-all md:mb-0.5 md:w-full md:min-w-0 md:last:mb-0"
                  aria-current={isActive ? 'page' : undefined}
                  style={{
                    background: isActive ? 'color-mix(in srgb, var(--accent) 10%, var(--bg-primary))' : 'transparent',
                    borderLeft: `2px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
                    paddingLeft: '9px',
                    paddingRight: '10px',
                  }}
                >
                  <span className="mt-[1px] shrink-0" style={{ color: isActive ? 'var(--accent)' : 'var(--text-muted)' }}>
                    {item.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium leading-snug" style={{ color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                      {item.label}
                    </p>
                    {item.status ? (
                      <p
                        className="mt-0.5 truncate text-[11px]"
                        style={{ color: item.sv === 'success' ? 'var(--success)' : item.sv === 'warning' ? 'var(--warning)' : 'var(--text-muted)' }}
                      >
                        {item.status}
                      </p>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </nav>

          {/* User footer */}
          <div className="hidden border-t p-2.5 md:block" style={{ borderColor: 'var(--border-strong)' }}>
            <div className="flex items-center gap-2">
              <div
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10.5px] font-bold"
                style={{ background: 'var(--settings-warning-soft-bg)', color: 'var(--warning)' }}
              >
                {(user?.displayName ?? '').split(' ').map((p) => p[0] ?? '').join('').slice(0, 2).toUpperCase() || 'M'}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium" style={{ color: 'var(--text-primary)' }}>
                  {user?.displayName || 'Manager'}
                </p>
                <p className="truncate text-[10.5px]" style={{ color: 'var(--text-muted)' }}>
                  @{user?.username}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleManagerLogout()}
                disabled={hasChanges || loggingOut}
                title="Log out"
                aria-label="Log out"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-40"
                style={{ background: 'var(--settings-danger-soft-bg)', color: 'var(--danger-muted)', border: 'var(--settings-danger-soft-border)' }}
              >
                {loggingOut ? <Loader2 size={11} className="animate-spin" /> : <LogOut size={11} />}
              </button>
            </div>
          </div>
        </aside>

        {/* ── CONTENT ─────────────────────────────────────────── */}
        <div className="flex flex-1 min-w-0 min-h-0 flex-col overflow-hidden">
          {/* Section title bar */}
          <div
            className="shrink-0 border-b px-5 py-2"
            style={{ borderColor: 'var(--border-strong)', background: 'color-mix(in srgb, var(--bg-secondary) 42%, var(--bg-primary) 58%)' }}
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={activeSection + '-hdr'}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
              >
                <h2 className="text-[13px] font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
                  {SECTION_LABELS[activeSection].title}
                </h2>
                <p className="mt-0.5 text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                  {SECTION_LABELS[activeSection].description}
                </p>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Scrollable section content */}
          <AnimatePresence mode="wait">
            <motion.div
              key={activeSection}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="flex-1 overflow-y-auto px-5 py-4"
            >

              {/* ── NAVIGATION ────── */}
              {activeSection === 'navigation' ? (
                <NavigationSection />
              ) : null}

              {/* ── CONNECTION ────── */}
              {activeSection === 'connection' ? (
                <div className="max-w-[720px] space-y-7">
                  {/* Active connection */}
                  <div>
                    <SettingsGroupLabel>Active Connection</SettingsGroupLabel>
                    <div className="mt-2.5 overflow-hidden rounded-xl" style={{ border: 'var(--settings-pane-border)' }}>
                      {([
                        { label: 'Workspace', value: connectionLabel },
                        { label: 'Jira email', value: trimmedJiraEmail || '-' },
                        { label: 'Project key', value: trimmedJiraProjectKey || '—' },
                        { label: 'API token', value: config?.jiraApiToken ? 'Saved' : 'Not saved' },
                        { label: 'Sync scope', value: syncScopeMode === 'base_query' ? 'Base query only.' : 'Team assignees appended at sync time.' },
                      ] as Array<{ label: string; value: string }>).map((row, idx) => (
                        <div
                          key={row.label}
                          className="flex items-start gap-4 px-4 py-2"
                          style={{ borderTop: idx > 0 ? 'var(--settings-row-divider)' : 'none' }}
                        >
                          <span className="w-[110px] shrink-0 text-[12px] font-medium" style={{ color: 'var(--text-muted)' }}>
                            {row.label}
                          </span>
                          <span className="text-[12.5px]" style={{ color: 'var(--text-primary)' }}>
                            {row.value}
                          </span>
                        </div>
                      ))}
                    </div>
                    <p className="mt-2 text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                      {syncScopeMode === 'base_query'
                        ? 'The saved query defines the Jira defect universe for this workspace.'
                        : 'Team assignees and the manager lead identity are appended automatically at sync time.'}
                    </p>
                  </div>

                  {syncErrorMessage ? (
                    <div
                      className="rounded-xl p-3"
                      style={{ background: 'var(--settings-danger-soft-bg)', border: 'var(--settings-danger-soft-border)' }}
                    >
                      <div className="flex items-start gap-2">
                        <AlertTriangle size={14} className="mt-0.5 shrink-0" style={{ color: 'var(--danger-muted)' }} />
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold" style={{ color: 'var(--danger-muted)' }}>
                            Jira sync is failing
                          </p>
                          <p className="mt-1 text-[12px] leading-relaxed" style={{ color: 'var(--danger-muted)' }}>
                            {syncErrorMessage}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {/* Connection details */}
                  <div>
                    <SettingsGroupLabel>Connection Details</SettingsGroupLabel>
                    <p className="mt-1 mb-3 text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                      Edit the Jira site and project used by this workspace. Save before running a sync.
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <SettingsLabeledInput label="Jira base URL" id="jira-base-url">
                        <input
                          id="jira-base-url"
                          type="url"
                          value={jiraBaseUrl}
                          onChange={(e) => setJiraBaseUrl(e.target.value)}
                          placeholder="https://tenant.atlassian.net"
                          className="w-full rounded-lg px-3 py-1.5 font-mono text-[12.5px] outline-none"
                          style={{ background: 'var(--settings-input-bg)', color: 'var(--text-primary)', border: 'var(--settings-input-border)' }}
                        />
                      </SettingsLabeledInput>
                      <SettingsLabeledInput label="Project key" id="jira-project-key">
                        <input
                          id="jira-project-key"
                          type="text"
                          value={jiraProjectKey}
                          onChange={(e) => setJiraProjectKey(e.target.value)}
                          placeholder="AM"
                          className="w-full rounded-lg px-3 py-1.5 font-mono text-[12.5px] outline-none"
                          style={{ background: 'var(--settings-input-bg)', color: 'var(--text-primary)', border: 'var(--settings-input-border)' }}
                        />
                      </SettingsLabeledInput>
                      <div className="sm:col-span-2">
                        <SettingsLabeledInput label="Jira email" id="jira-email">
                          <input
                            id="jira-email"
                            type="email"
                            value={jiraEmail}
                            onChange={(e) => setJiraEmail(e.target.value)}
                            placeholder="manager@example.com"
                            autoComplete="email"
                            className="w-full rounded-lg px-3 py-1.5 text-[12.5px] outline-none"
                            style={{ background: 'var(--settings-input-bg)', color: 'var(--text-primary)', border: 'var(--settings-input-border)' }}
                          />
                        </SettingsLabeledInput>
                      </div>
                    </div>
                  </div>

                  {/* API token */}
                  <div>
                    <SettingsGroupLabel>Jira API Token</SettingsGroupLabel>
                    <p className="mt-1 mb-3 text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                      Paste a new token here when Jira access changes. The saved token is never displayed.
                    </p>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        id="jira-api-token"
                        type="password"
                        value={jiraApiTokenInput}
                        onChange={(e) => setJiraApiTokenInput(e.target.value)}
                        placeholder={config?.jiraApiToken ? 'New API token' : 'API token'}
                        autoComplete="off"
                        className="min-w-0 flex-1 rounded-lg px-3 py-1.5 font-mono text-[12.5px] outline-none"
                        style={{ background: 'var(--settings-input-bg)', color: 'var(--text-primary)', border: 'var(--settings-input-border)' }}
                      />
                      <button
                        type="button"
                        onClick={() => void handleCheckJiraConnection()}
                        disabled={checkingJiraConnection || !canTestJiraConnection}
                        className="flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-colors disabled:opacity-50"
                        style={{ background: 'var(--settings-accent-soft-bg)', color: 'var(--accent)', border: 'var(--settings-accent-soft-border)' }}
                      >
                        {checkingJiraConnection ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                        {jiraApiTokenInput.trim() ? 'Test new token' : 'Check saved token'}
                      </button>
                    </div>
                    <p className="mt-2 text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                      After testing a new token, use Save &amp; Sync to store it and refresh Jira defects.
                    </p>
                  </div>

                  {/* Manager identity */}
                  <div>
                    <div className="flex items-center justify-between">
                      <SettingsGroupLabel>Manager Jira Identity</SettingsGroupLabel>
                      {managerJiraAccountId ? (
                        <button
                          type="button"
                          onClick={() => setManagerJiraAccountId('')}
                          className="text-[12px] font-medium transition-opacity hover:opacity-70"
                          style={{ color: 'var(--danger-muted)' }}
                        >
                          Clear
                        </button>
                      ) : null}
                    </div>
                    <p className="mt-1 mb-3 text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                      Link the manager account Jira should treat as the lead when assembling sync scope and Manager Desk context.
                    </p>
                    <div className="space-y-2">
                      <input
                        id="manager-jira-identity"
                        type="text"
                        value={managerJiraAccountId}
                        onChange={(e) => setManagerJiraAccountId(e.target.value)}
                        placeholder="Paste or edit the Jira account id"
                        className="w-full rounded-lg px-3 py-1.5 font-mono text-[12.5px] outline-none"
                        style={{ background: 'var(--settings-input-bg)', color: 'var(--text-primary)', border: 'var(--settings-input-border)' }}
                      />
                      <div className="relative">
                        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                        <input
                          type="text"
                          value={managerSearch}
                          onChange={(e) => setManagerSearch(e.target.value)}
                          placeholder="Filter known Jira people"
                          className="w-full rounded-lg py-1.5 pl-8 pr-3 text-[12.5px] outline-none"
                          style={{ background: 'var(--settings-input-bg)', color: 'var(--text-primary)', border: 'var(--settings-input-border)' }}
                        />
                      </div>
                    </div>
                    <div className="mt-3">
                      <div className="mb-1.5 flex items-center justify-between">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>
                          Directory picks
                        </p>
                        {discoveringTeam ? (
                          <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                            <Loader2 size={10} className="animate-spin" /> Refreshing
                          </span>
                        ) : null}
                      </div>
                      <div className="overflow-hidden rounded-xl" style={{ border: 'var(--settings-inset-border)' }}>
                        {managerSuggestions.length > 0 ? (
                          managerSuggestions.map((u, idx) => (
                            <button
                              key={u.accountId}
                              type="button"
                              onClick={() => setManagerJiraAccountId(u.accountId)}
                              className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors"
                              style={{
                                background: u.accountId === managerJiraAccountId ? 'var(--settings-accent-soft-bg)' : idx % 2 === 0 ? 'var(--settings-row-even-bg)' : 'var(--settings-row-odd-bg)',
                                borderTop: idx > 0 ? 'var(--settings-row-divider)' : 'none',
                              }}
                            >
                              <IdentityAvatar user={u} accent={u.accountId === managerJiraAccountId ? 'var(--accent)' : 'var(--text-muted)'} />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[12.5px] font-medium" style={{ color: 'var(--text-primary)' }}>{u.displayName}</p>
                                <p className="truncate text-[11px]" style={{ color: 'var(--text-muted)' }}>{u.email ?? u.accountId}</p>
                              </div>
                              {u.accountId === managerJiraAccountId ? (
                                <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: 'var(--settings-accent-soft-bg)', color: 'var(--accent)' }}>
                                  Active
                                </span>
                              ) : null}
                            </button>
                          ))
                        ) : (
                          <div className="px-4 py-3 text-[12px]" style={{ color: 'var(--text-muted)' }}>
                            No profiles match. Paste an account id directly above.
                          </div>
                        )}
                      </div>
                      {selectedManagerProfile ? (
                        <p className="mt-2 text-[12px]" style={{ color: 'var(--success)' }}>
                          <span className="font-semibold">{selectedManagerProfile.displayName}</span> is linked as the manager Jira identity.
                        </p>
                      ) : managerJiraAccountId ? (
                        <p className="mt-2 text-[12px]" style={{ color: 'var(--warning)' }}>
                          Account id saved manually — not in the current directory snapshot.
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}

              {/* ── COPILOT ────── */}
              {activeSection === 'assistant' ? (
                <AssistantSection />
              ) : null}

              {/* ── SYNC SCOPE ────── */}
              {activeSection === 'sync' ? (
                <div className="max-w-[720px] space-y-7">
                  {/* Auto sync */}
                  <div>
                    <SettingsGroupLabel>Auto Sync</SettingsGroupLabel>
                    <p className="mt-1 mb-3 text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                      When enabled, LeadOS refreshes Jira issues automatically on a schedule. Turn it off if you only
                      track people and daily work here — no Jira calls are made until you run a manual sync.
                    </p>
                    <div
                      className="flex items-center justify-between gap-4 rounded-xl px-3.5 py-3"
                      style={{ background: 'var(--settings-input-bg)', border: 'var(--settings-inset-border)' }}
                    >
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                          Scheduled Jira sync
                        </p>
                        <p className="mt-0.5 text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                          {autoSyncEnabled
                            ? 'On — Jira issues refresh automatically.'
                            : 'Off — manual sync only, via the refresh button.'}
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={autoSyncEnabled}
                        aria-label="Toggle Jira auto-sync"
                        disabled={savingAutoSync}
                        onClick={() => void handleToggleAutoSync(!autoSyncEnabled)}
                        className="relative h-6 w-11 shrink-0 rounded-full transition-colors duration-150 disabled:opacity-50"
                        style={{
                          background: autoSyncEnabled ? 'var(--accent)' : 'var(--bg-tertiary)',
                          border: autoSyncEnabled ? '1px solid var(--accent)' : '1px solid var(--border-strong)',
                        }}
                      >
                        <span
                          className="absolute top-1/2 -translate-y-1/2 rounded-full transition-all duration-150"
                          style={{
                            left: autoSyncEnabled ? 'calc(100% - 21px)' : '3px',
                            width: '18px',
                            height: '18px',
                            background: autoSyncEnabled ? '#fff' : 'var(--text-secondary)',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                          }}
                        />
                      </button>
                    </div>
                  </div>

                  {/* Scope mode */}
                  <div>
                    <SettingsGroupLabel>Scope Mode</SettingsGroupLabel>
                    <p className="mt-1 mb-3 text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                      Choose whether Jira sync is limited to the tracked roster or driven directly by the base query.
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {([
                        {
                          id: 'team_assignees' as const,
                          icon: <Users size={14} />,
                          label: 'Team assignees',
                          badge: 'Default',
                          description: 'Append active team members and the manager identity. Empty roster returns no defects.',
                        },
                        {
                          id: 'base_query' as const,
                          icon: <Globe size={14} />,
                          label: 'Base query',
                          badge: 'Exact JQL',
                          description: 'Run the base query without added assignee filters. Team roster stays optional.',
                        },
                      ]).map((option) => {
                        const selected = syncScopeMode === option.id;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => setSyncScopeMode(option.id)}
                            className="group rounded-xl px-3.5 py-3 text-left transition-all active:scale-[0.99]"
                            style={{
                              border: selected ? '1px solid color-mix(in srgb, var(--accent) 48%, transparent)' : 'var(--settings-inset-border)',
                              background: selected ? 'var(--settings-accent-soft-bg)' : 'var(--settings-input-bg)',
                              color: 'var(--text-primary)',
                            }}
                          >
                            <span className="flex items-center gap-2">
                              <span
                                className="flex h-7 w-7 items-center justify-center rounded-lg"
                                style={{
                                  background: selected ? 'var(--accent)' : 'var(--bg-tertiary)',
                                  color: selected ? '#fff' : 'var(--text-secondary)',
                                }}
                              >
                                {option.icon}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block text-[13px] font-semibold leading-5">{option.label}</span>
                                <span
                                  className="mt-0.5 inline-flex rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase"
                                  style={{
                                    letterSpacing: '0.08em',
                                    background: selected ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'var(--bg-tertiary)',
                                    color: selected ? 'var(--accent)' : 'var(--text-muted)',
                                  }}
                                >
                                  {option.badge}
                                </span>
                              </span>
                              {selected ? <Check size={14} style={{ color: 'var(--accent)' }} /> : null}
                            </span>
                            <span className="mt-2 block text-[12px] leading-5" style={{ color: 'var(--text-secondary)' }}>
                              {option.description}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Base query */}
                  <div>
                    <SettingsGroupLabel>Base JQL Query</SettingsGroupLabel>
                    <p className="mt-1 mb-3 text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                      {syncScopeMode === 'base_query'
                        ? 'This query is sent to Jira without LeadOS adding assignee filters.'
                        : 'Keep this query focused on the defect universe. LeadOS will append team assignees and manager lead logic.'}
                    </p>
                    <textarea
                      id="jira-base-query"
                      value={jql}
                      onChange={(e) => setJql(e.target.value)}
                      rows={7}
                      spellCheck={false}
                      className="w-full resize-y rounded-lg px-3 py-2.5 font-mono text-[12.5px] leading-relaxed outline-none"
                      style={{ background: 'var(--settings-input-bg)', color: 'var(--text-primary)', border: 'var(--settings-input-border)', minHeight: '120px' }}
                      placeholder="project = PROJ AND issuetype = Bug AND statusCategory != Done"
                    />
                    <p className="mt-2 text-[12px]" style={{ color: 'var(--text-muted)' }}>
                      Use{' '}
                      <code className="rounded px-1 py-0.5 font-mono text-[11.5px]" style={{ background: 'var(--settings-code-bg)', color: 'var(--accent)' }}>
                        {'{ PROJECT_KEY }'}
                      </code>{' '}
                      to insert the configured project key dynamically.
                    </p>
                  </div>

                  {/* Custom fields */}
                  <div>
                    <SettingsGroupLabel>Custom Field Mapping</SettingsGroupLabel>
                    <p className="mt-1 mb-3 text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                      Map custom Jira fields surfaced during triage. Use Discover to browse available fields.
                    </p>
                    <div className="space-y-2">
                      <CompactFieldRow
                        label="Dev Due Date"
                        description="Date field shown as development due date in triage."
                        value={devDueDateField}
                        onChange={setDevDueDateField}
                        onDiscover={() => handleDiscoverFields('dueDate')}
                        loading={loadingFields && fieldPickerTarget === 'dueDate'}
                        active={fieldPickerTarget === 'dueDate'}
                        placeholder="customfield_10128"
                      />
                      <CompactFieldRow
                        label="ASPEN Severity"
                        description="Field displayed at the top of triage properties."
                        value={aspenSeverityField}
                        onChange={setAspenSeverityField}
                        onDiscover={() => handleDiscoverFields('aspenSeverity')}
                        loading={loadingFields && fieldPickerTarget === 'aspenSeverity'}
                        active={fieldPickerTarget === 'aspenSeverity'}
                        placeholder="customfield_XXXXX"
                      />
                    </div>
                  </div>

                  {/* Field picker */}
                  {fieldPickerTarget ? (
                    <div className="overflow-hidden rounded-xl" style={{ border: 'var(--settings-inset-border)', background: 'var(--settings-inset-bg)' }}>
                      <div
                        className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                        style={{ borderColor: 'color-mix(in srgb, var(--border-strong) 78%, transparent)' }}
                      >
                        <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                          {fieldPickerTarget === 'aspenSeverity' ? 'ASPEN Severity' : 'Dev Due Date'} — field picker
                        </p>
                        <div className="flex items-center gap-2">
                          <div className="relative flex-1 sm:min-w-[200px]">
                            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                            <input
                              type="text"
                              value={fieldSearch}
                              onChange={(e) => setFieldSearch(e.target.value)}
                              placeholder="Search fields…"
                              className="w-full rounded-lg py-1.5 pl-8 pr-3 text-[13px] outline-none"
                              style={{ background: 'var(--settings-input-bg)', color: 'var(--text-primary)', border: 'var(--settings-input-border)' }}
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => setFieldPickerTarget(null)}
                            className="rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors"
                            style={{ background: 'var(--settings-neutral-chip-bg)', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)' }}
                          >
                            Close
                          </button>
                        </div>
                      </div>
                      <div className="max-h-[260px] overflow-y-auto">
                        {preferredFields.length > 0 ? (
                          <FieldListGroup title="Likely matches" accent fields={preferredFields} currentFieldValue={currentFieldValue} onSelect={handleFieldSelection} />
                        ) : null}
                        {otherFields.length > 0 ? (
                          <FieldListGroup title="Other custom fields" fields={otherFields.slice(0, 50)} currentFieldValue={currentFieldValue} onSelect={handleFieldSelection} />
                        ) : null}
                        {otherFields.length > 50 ? (
                          <p className="px-4 py-2 text-[12px]" style={{ color: 'var(--text-muted)' }}>+{otherFields.length - 50} more — narrow the search.</p>
                        ) : null}
                        {preferredFields.length === 0 && otherFields.length === 0 ? (
                          <p className="px-4 py-4 text-[13px]" style={{ color: 'var(--text-muted)' }}>No custom fields match this search.</p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* ── TEAM MEMBERS ────── */}
              {activeSection === 'team' ? (
                <div className="grid items-start gap-5 lg:grid-cols-2">
                  {/* Tracked team */}
                  <div className="min-w-0">
                    <div className="mb-2.5 flex items-center justify-between">
                      <SettingsGroupLabel>Tracked Team</SettingsGroupLabel>
                      <span
                        className="rounded-full px-2 py-0.5 text-[11.5px] font-semibold"
                        style={{ background: 'var(--settings-accent-soft-bg)', color: 'var(--accent)', border: 'var(--settings-accent-soft-border)' }}
                      >
                        {developers.length}
                      </span>
                    </div>
                    <div className="relative mb-2">
                      <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                      <input
                        type="text"
                        value={teamSearch}
                        onChange={(e) => setTeamSearch(e.target.value)}
                        placeholder="Search team"
                        aria-label="Search current team"
                        className="w-full rounded-lg py-1.5 pl-8 pr-3 text-[12.5px] outline-none"
                        style={{ background: 'var(--settings-input-bg)', color: 'var(--text-primary)', border: 'var(--settings-input-border)' }}
                      />
                    </div>
                    <div className="overflow-hidden rounded-xl" style={{ border: 'var(--settings-inset-border)' }}>
                      {loadingDevelopers ? (
                        <p className="px-4 py-4 text-[13px]" style={{ color: 'var(--text-muted)' }}>Loading team…</p>
                      ) : filteredDevelopers.length === 0 ? (
                        <p className="px-4 py-4 text-[13px]" style={{ color: 'var(--text-muted)' }}>
                          {developers.length === 0 ? 'No team members yet.' : 'No members match this search.'}
                        </p>
                      ) : (
                        filteredDevelopers.map((member, idx) => {
                          const isRemoving = removingAccountId === member.accountId;
                          const isEditing = editingMemberId === member.accountId;
                          const isSavingEdit = savingMemberId === member.accountId;
                          return (
                            <div
                              key={member.accountId}
                              className="flex items-start gap-2 px-3 py-1.5"
                              style={{ background: idx % 2 === 0 ? 'var(--settings-row-even-bg)' : 'var(--settings-row-odd-bg)', borderTop: idx > 0 ? 'var(--settings-row-divider)' : 'none' }}
                            >
                              <IdentityAvatar user={member} accent="var(--accent)" />
                              {isEditing ? (
                                <div className="min-w-0 flex-1">
                                  <div className="grid gap-1.5">
                                    <input
                                      type="text"
                                      value={editingMemberName}
                                      onChange={(e) => setEditingMemberName(e.target.value)}
                                      aria-label="Edit team member name"
                                      className="w-full rounded-md px-2 py-1.5 text-[12px] outline-none"
                                      style={{ background: 'var(--settings-input-bg)', color: 'var(--text-primary)', border: 'var(--settings-input-border)' }}
                                    />
                                    <input
                                      type="email"
                                      value={editingMemberEmail}
                                      onChange={(e) => setEditingMemberEmail(e.target.value)}
                                      placeholder="Email optional"
                                      aria-label="Edit team member email"
                                      className="w-full rounded-md px-2 py-1.5 text-[12px] outline-none"
                                      style={{ background: 'var(--settings-input-bg)', color: 'var(--text-primary)', border: 'var(--settings-input-border)' }}
                                    />
                                    <input
                                      type="text"
                                      value={editingMemberJiraAccountId}
                                      onChange={(e) => setEditingMemberJiraAccountId(e.target.value)}
                                      placeholder="Jira account ID optional"
                                      aria-label="Edit team member Jira account ID"
                                      className="w-full rounded-md px-2 py-1.5 text-[12px] outline-none"
                                      style={{ background: 'var(--settings-input-bg)', color: 'var(--text-primary)', border: 'var(--settings-input-border)' }}
                                    />
                                  </div>
                                  <div className="mt-1.5 flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => void handleSaveEditedMember()}
                                      disabled={!editingMemberName.trim() || isSavingEdit}
                                      aria-label="Save team member changes"
                                      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] font-semibold disabled:opacity-50"
                                      style={{ background: 'var(--settings-success-soft-bg)', color: 'var(--success)', border: 'var(--settings-success-soft-border)' }}
                                    >
                                      {isSavingEdit ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />} Save
                                    </button>
                                    <button
                                      type="button"
                                      onClick={cancelEditingMember}
                                      disabled={isSavingEdit}
                                      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] font-semibold disabled:opacity-50"
                                      style={{ background: 'var(--settings-neutral-chip-bg)', color: 'var(--text-muted)', border: '1px solid var(--border-strong)' }}
                                    >
                                      <X size={11} /> Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>{member.displayName}</p>
                                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                      <p className="truncate text-[11px]" style={{ color: 'var(--text-muted)' }}>{member.email ?? member.accountId}</p>
                                      <span
                                        className="rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold"
                                        style={{
                                          background: member.source === 'manual' ? 'var(--settings-neutral-chip-bg)' : 'var(--settings-accent-soft-bg)',
                                          color: member.source === 'manual' ? 'var(--text-muted)' : 'var(--accent)',
                                          border: member.source === 'manual' ? '1px solid var(--border-strong)' : 'var(--settings-accent-soft-border)',
                                        }}
                                      >
                                        {member.jiraAccountId || member.source !== 'manual' ? 'Jira linked' : 'Manual'}
                                      </span>
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => startEditingMember(member)}
                                    disabled={teamActionLoading}
                                    title="Edit team member"
                                    aria-label={`Edit ${member.displayName}`}
                                    className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors disabled:opacity-40"
                                    style={{ background: 'var(--settings-neutral-chip-bg)', color: 'var(--text-muted)', border: '1px solid var(--border-strong)' }}
                                  >
                                    <Pencil size={12} />
                                  </button>
                                  <TeamMemberRemoveAction
                                    member={member}
                                    confirming={confirmRemoveAccountId === member.accountId}
                                    removing={isRemoving}
                                    disabled={teamActionLoading && !isRemoving}
                                    onStartConfirm={() => setConfirmRemoveAccountId(member.accountId)}
                                    onCancel={() => setConfirmRemoveAccountId((current) => (current === member.accountId ? null : current))}
                                    onConfirm={() => void handleRemoveMember(member.accountId)}
                                  />
                                </>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>

                    <div className="mt-3 rounded-xl p-3" style={{ border: 'var(--settings-inset-border)', background: 'var(--settings-inset-bg)' }}>
                      <SettingsGroupLabel>Add Manually</SettingsGroupLabel>
                      <p className="mt-1 text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                        Add a person before linking Jira. They can be used in Team, Desk, and developer access immediately.
                      </p>
                      <div className="mt-3 grid gap-2">
                        <input
                          type="text"
                          value={manualMemberName}
                          onChange={(e) => setManualMemberName(e.target.value)}
                          placeholder="Display name"
                          aria-label="Manual team member name"
                          className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
                          style={{ background: 'var(--settings-input-bg)', color: 'var(--text-primary)', border: 'var(--settings-input-border)' }}
                        />
                        <input
                          type="email"
                          value={manualMemberEmail}
                          onChange={(e) => setManualMemberEmail(e.target.value)}
                          placeholder="Email optional"
                          aria-label="Manual team member email"
                          className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
                          style={{ background: 'var(--settings-input-bg)', color: 'var(--text-primary)', border: 'var(--settings-input-border)' }}
                        />
                        <input
                          type="text"
                          value={manualMemberJiraAccountId}
                          onChange={(e) => setManualMemberJiraAccountId(e.target.value)}
                          placeholder="Jira account ID optional"
                          aria-label="Manual team member Jira account ID"
                          className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
                          style={{ background: 'var(--settings-input-bg)', color: 'var(--text-primary)', border: 'var(--settings-input-border)' }}
                        />
                        <button
                          type="button"
                          onClick={handleAddManualMember}
                          disabled={!manualMemberName.trim() || savingManualMember}
                          className="flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-[13px] font-semibold transition-colors disabled:opacity-50"
                          style={{ background: 'var(--settings-neutral-chip-bg)', color: 'var(--text-primary)', border: '1px solid var(--border-strong)' }}
                        >
                          {savingManualMember ? <><Loader2 size={13} className="animate-spin" /> Adding…</> : <><UserPlus size={13} /> Add manual member</>}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Jira directory */}
                  <div className="min-w-0">
                    <div className="mb-2.5 flex items-center justify-between">
                      <SettingsGroupLabel>Jira Directory</SettingsGroupLabel>
                      <button
                        type="button"
                        onClick={() => handleDiscoverTeamMembers({ query: discoveredSearch.trim(), startAt: 0, append: false, silentEmpty: false })}
                        disabled={!canUseJiraDirectory || teamActionLoading || discoveringTeam}
                        className="rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition-colors disabled:opacity-50"
                        style={{ background: 'var(--settings-accent-soft-bg)', color: 'var(--accent)', border: 'var(--settings-accent-soft-border)' }}
                      >
                        {discoveringTeam ? 'Refreshing…' : 'Refresh Jira'}
                      </button>
                    </div>
                    <div className="mb-2 flex gap-2">
                      <div className="relative flex-1">
                        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                        <input
                          type="text"
                          value={discoveredSearch}
                          onChange={(e) => setDiscoveredSearch(e.target.value)}
                          placeholder="Search Jira users"
                          aria-label="Search discoverable Jira users"
                          className="w-full rounded-lg py-1.5 pl-8 pr-3 text-[12.5px] outline-none"
                          style={{ background: 'var(--settings-input-bg)', color: 'var(--text-primary)', border: 'var(--settings-input-border)' }}
                        />
                      </div>
                      <span
                        className="flex items-center justify-center rounded-lg px-2.5 text-[11.5px] font-semibold"
                        style={{ background: 'var(--settings-neutral-chip-bg)', color: 'var(--text-muted)', border: '1px solid var(--border-strong)', whiteSpace: 'nowrap' }}
                      >
                        {addableSelectionCount} sel.
                      </span>
                    </div>

                    {discoverTeamError ? (
                      <p className="mb-2 rounded-xl px-3 py-2 text-[12px]" style={{ background: 'var(--settings-danger-soft-bg)', color: 'var(--danger-muted)', border: 'var(--settings-danger-soft-border)' }}>
                        {discoverTeamError}
                      </p>
                    ) : null}

                    {discoveringTeam ? (
                      <div className="flex items-center gap-2 rounded-xl px-3 py-3 text-[13px]" style={{ background: 'var(--settings-inset-bg)', border: 'var(--settings-inset-border)', color: 'var(--text-secondary)' }}>
                        <Loader2 size={13} className="animate-spin" style={{ color: 'var(--accent)' }} />
                        Discovering users…
                      </div>
                    ) : discoveredUsers.length === 0 ? (
                      <div className="rounded-xl border border-dashed px-4 py-5 text-[13px]" style={{ borderColor: 'color-mix(in srgb, var(--border-strong) 90%, transparent)', color: 'var(--text-muted)' }}>
                        Connect Jira to discover users, or add people manually from the tracked team panel.
                      </div>
                    ) : (
                      <>
                        <div className="mb-1.5 flex flex-wrap items-center gap-3 text-[12px]">
                          <button type="button" onClick={handleSelectAllDiscovered} className="font-semibold" style={{ color: 'var(--accent)' }}>All</button>
                          <button type="button" onClick={handleClearAddSelection} style={{ color: 'var(--text-muted)' }}>Clear</button>
                          <span className="ml-auto" style={{ color: 'var(--text-muted)' }}>{discoveredUsers.length} loaded</span>
                        </div>
                        <div className="max-h-[280px] overflow-y-auto rounded-xl" style={{ border: 'var(--settings-inset-border)' }}>
                          {discoveredUsers.map((u, idx) => {
                            const isAlready = activeMemberIds.has(u.accountId);
                            const isSel = selectedAddUsers.has(u.accountId);
                            return (
                              <button
                                key={u.accountId}
                                type="button"
                                onClick={() => !isAlready && handleToggleAddUser(u.accountId)}
                                disabled={isAlready || teamActionLoading}
                                className="flex w-full items-center gap-2 px-3 py-1.5 text-left disabled:opacity-100"
                                style={{ background: idx % 2 === 0 ? 'var(--settings-row-even-bg)' : 'var(--settings-row-odd-bg)', borderTop: idx > 0 ? 'var(--settings-row-divider)' : 'none' }}
                              >
                                <span
                                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[11px] font-semibold"
                                  style={{
                                    borderWidth: 1, borderStyle: 'solid',
                                    borderColor: isAlready || isSel ? 'color-mix(in srgb, var(--accent) 26%, var(--border-strong))' : 'color-mix(in srgb, var(--border-strong) 88%, transparent)',
                                    background: isAlready || isSel ? 'var(--settings-accent-soft-bg)' : 'transparent',
                                    color: isAlready || isSel ? 'var(--accent)' : 'var(--text-muted)',
                                  }}
                                >
                                  {isAlready || isSel ? '✓' : ''}
                                </span>
                                <IdentityAvatar user={u} accent={isSel ? 'var(--accent)' : 'var(--text-muted)'} />
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-[12.5px] font-medium" style={{ color: 'var(--text-primary)' }}>{u.displayName}</p>
                                  <p className="truncate text-[11px]" style={{ color: 'var(--text-muted)' }}>{u.email ?? u.accountId}</p>
                                </div>
                                {isAlready ? (
                                  <span className="rounded-full px-1.5 py-0.5 text-[11px] font-semibold" style={{ background: 'var(--settings-accent-soft-bg)', color: 'var(--accent)' }}>Added</span>
                                ) : null}
                              </button>
                            );
                          })}
                        </div>
                        {discoverHasMore ? (
                          <button
                            type="button"
                            onClick={() => handleDiscoverTeamMembers({ query: discoveredSearch.trim(), startAt: discoverNextStartAt, append: true, silentEmpty: true })}
                            disabled={loadingMoreTeam || discoveringTeam}
                            className="mt-2 w-full rounded-xl px-4 py-2 text-[13px] font-medium transition-colors disabled:opacity-50"
                            style={{ background: 'var(--settings-neutral-chip-bg)', color: 'var(--text-primary)', border: '1px solid var(--border-strong)' }}
                          >
                            {loadingMoreTeam ? 'Loading more…' : 'Load more users'}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={handleAddSelectedDevelopers}
                          disabled={addableSelectionCount === 0 || savingTeam}
                          className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold transition-colors disabled:opacity-50"
                          style={{ background: 'var(--settings-cta-bg)', color: 'var(--settings-cta-text)', border: 'var(--settings-cta-border)' }}
                        >
                          {savingTeam ? (
                            <><Loader2 size={13} className="animate-spin" /> Adding…</>
                          ) : (
                            <><UserPlus size={13} /> Add {addableSelectionCount > 0 ? `${addableSelectionCount} ` : ''}selected</>
                          )}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ) : null}

              {/* ── TAGS ────── */}
              {activeSection === 'tags' ? (
                <TagManagementSection />
              ) : null}

              {/* ── TASK LABELS (Phase 3) ────── */}
              {activeSection === 'labels' && tasksPhase3 ? (
                <LabelsSection />
              ) : null}

              {/* ── DATA MAINTENANCE ────── */}
              {activeSection === 'maintenance' ? (
                <SettingsMaintenanceSection active={activeSection === 'maintenance'} />
              ) : null}

              {/* ── DEVELOPER ACCESS ────── */}
              {activeSection === 'access' ? (
                <div className="max-w-[720px] space-y-7">
                  {/* Dev login link */}
                  <div>
                    <SettingsGroupLabel>Developer Login Link</SettingsGroupLabel>
                    <p className="mt-1 mb-3 text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                      Share this URL with developers. They land directly in their My Day workspace after sign-in.
                    </p>
                    <div className="flex items-center gap-2">
                      <div
                        className="min-w-0 flex-1 rounded-lg px-3 py-1.5 font-mono text-[12.5px]"
                        style={{ background: 'var(--settings-code-bg)', color: 'var(--text-primary)', border: 'var(--settings-inset-border)' }}
                      >
                        {DEVELOPER_LOGIN_URL}
                      </div>
                      <button
                        type="button"
                        onClick={handleCopyDevLink}
                        className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-colors"
                        style={{
                          background: copiedLink ? 'var(--settings-success-soft-bg)' : 'var(--settings-accent-soft-bg)',
                          color: copiedLink ? 'var(--success)' : 'var(--accent)',
                          border: copiedLink ? 'var(--settings-success-soft-border)' : 'var(--settings-accent-soft-border)',
                        }}
                      >
                        {copiedLink ? <CheckCircle2 size={13} /> : <Copy size={13} />}
                        {copiedLink ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>

                  {/* App accounts */}
                  <div>
                    <div className="mb-2.5 flex items-center justify-between">
                      <SettingsGroupLabel>App Accounts</SettingsGroupLabel>
                      <span
                        className="rounded-full px-2 py-0.5 text-[11.5px] font-semibold"
                        style={{ background: 'var(--settings-neutral-chip-bg)', color: 'var(--text-muted)', border: '1px solid var(--border-strong)' }}
                      >
                        {loadingUsers ? '…' : appUsers.length}
                      </span>
                    </div>
                    <div className="overflow-hidden rounded-xl" style={{ border: 'var(--settings-inset-border)' }}>
                      {loadingUsers ? (
                        <div className="flex items-center gap-2 px-4 py-4 text-[13px]" style={{ color: 'var(--text-muted)' }}>
                          <Loader2 size={13} className="animate-spin" /> Loading users…
                        </div>
                      ) : appUsers.length > 0 ? (
                        appUsers.map((u, idx) => (
                          <div
                            key={u.username}
                            className="flex flex-col gap-1.5 px-3 py-2 sm:flex-row sm:items-center"
                            style={{ background: idx % 2 === 0 ? 'var(--settings-row-even-bg)' : 'var(--settings-row-odd-bg)', borderTop: idx > 0 ? 'var(--settings-row-divider)' : 'none' }}
                          >
                            <div className="flex min-w-0 flex-1 items-center gap-2">
                              <div
                                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10.5px] font-bold"
                                style={{ background: u.role === 'manager' ? 'var(--settings-warning-soft-bg)' : 'var(--settings-accent-soft-bg)', color: u.role === 'manager' ? 'var(--warning)' : 'var(--accent)' }}
                              >
                                {u.displayName.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <p className="truncate text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>{u.displayName}</p>
                                  <span
                                    className="rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.1em]"
                                    style={{ background: u.role === 'manager' ? 'var(--settings-warning-soft-bg)' : 'var(--settings-accent-soft-bg)', color: u.role === 'manager' ? 'var(--warning)' : 'var(--accent)' }}
                                  >
                                    {u.role}
                                  </span>
                                  {u.developerAccountId ? (
                                    <span className="rounded-full px-1.5 py-0.5 text-[10.5px] font-medium" style={{ background: 'var(--settings-neutral-chip-bg)', color: 'var(--text-muted)', border: '1px solid var(--border-strong)' }}>
                                      Team linked
                                    </span>
                                  ) : null}
                                </div>
                                <p className="truncate text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                                  @{u.username}{u.developerAccountId ? ` · ${u.developerAccountId}` : ''}
                                </p>
                              </div>
                            </div>
                            <div className="sm:ml-auto">
                              {u.role === 'developer' ? (
                                <UserAccountDeleteAction
                                  user={u}
                                  confirming={confirmDeleteUsername === u.username}
                                  deleting={deletingUsername === u.username}
                                  onStartConfirm={() => setConfirmDeleteUsername(u.username)}
                                  onCancel={() => setConfirmDeleteUsername((c) => (c === u.username ? null : c))}
                                  onConfirm={() => void handleDeleteUser(u)}
                                />
                              ) : (
                                <div
                                  className="rounded-full px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.1em]"
                                  style={{ background: 'var(--settings-warning-soft-bg)', color: 'var(--warning)', border: 'var(--settings-warning-soft-border)' }}
                                >
                                  Manager access
                                </div>
                              )}
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="px-4 py-4 text-[13px]" style={{ color: 'var(--text-muted)' }}>No accounts found.</p>
                      )}
                    </div>
                  </div>

                  {/* Create account */}
                  <div>
                    {!showCreateUser ? (
                      <button
                        type="button"
                        onClick={() => {
                          setShowCreateUser(true);
                          setNewPassword(generateStrongPassword(pwLength, pwUppercase, pwLowercase, pwDigits, pwSymbols));
                          setShowNewPw(true);
                          setCopiedPw(false);
                          setShowPasswordGen(false);
                        }}
                        className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-colors"
                        style={{ background: 'var(--settings-accent-soft-bg)', color: 'var(--accent)', border: 'var(--settings-accent-soft-border)' }}
                      >
                        <UserPlus size={12} />
                        Create user account
                      </button>
                    ) : (
                      <div className="rounded-xl p-4" style={{ background: 'var(--settings-pane-bg)', border: 'var(--settings-accent-soft-border)' }}>
                        <div className="mb-3 flex items-center justify-between">
                          <p className="text-[12px] font-semibold uppercase tracking-[0.16em]" style={{ color: 'var(--accent)' }}>New account</p>
                          <button
                            type="button"
                            onClick={() => { setShowCreateUser(false); setNewUsername(''); setNewDisplayName(''); setNewPassword(''); setNewRole('developer'); setNewDevAccountId(''); }}
                            className="flex h-6 w-6 items-center justify-center rounded-lg transition-colors"
                            style={{ color: 'var(--text-muted)', background: 'var(--settings-neutral-chip-bg)' }}
                            aria-label="Cancel create user"
                          >
                            <X size={13} />
                          </button>
                        </div>
                        <div className="space-y-2.5">
                          <SettingsLabeledInput label="Username" id="new-username">
                            <input
                              id="new-username"
                              type="text"
                              value={newUsername}
                              onChange={(e) => setNewUsername(e.target.value)}
                              placeholder="username"
                              autoComplete="off"
                              className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
                              style={{ background: 'var(--settings-input-bg)', color: 'var(--text-primary)', border: 'var(--settings-input-border)' }}
                            />
                          </SettingsLabeledInput>
                          <SettingsLabeledInput label="Display name" id="new-displayname">
                            <input
                              id="new-displayname"
                              type="text"
                              value={newDisplayName}
                              onChange={(e) => setNewDisplayName(e.target.value)}
                              placeholder="Full name"
                              autoComplete="off"
                              className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
                              style={{ background: 'var(--settings-input-bg)', color: 'var(--text-primary)', border: 'var(--settings-input-border)' }}
                            />
                          </SettingsLabeledInput>
                          <SettingsLabeledInput label="Password" id="new-password">
                            <div className="relative">
                              <input
                                id="new-password"
                                type={showNewPw ? 'text' : 'password'}
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                placeholder="Password"
                                autoComplete="new-password"
                                className="w-full rounded-lg py-2 pl-3 pr-20 font-mono text-[13px] outline-none"
                                style={{ background: 'var(--settings-input-bg)', color: 'var(--text-primary)', border: 'var(--settings-input-border)' }}
                              />
                              <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                                <button type="button" onClick={() => { setNewPassword(generateStrongPassword(pwLength, pwUppercase, pwLowercase, pwDigits, pwSymbols)); setShowNewPw(true); setCopiedPw(false); }} className="rounded-md p-1.5" style={{ color: 'var(--accent)' }} aria-label="Generate password" title="Generate password"><Dices size={13} /></button>
                                <button type="button" onClick={() => setShowNewPw((v) => !v)} className="rounded-md p-1.5" style={{ color: 'var(--text-muted)' }} aria-label={showNewPw ? 'Hide' : 'Show'} title={showNewPw ? 'Hide password' : 'Show password'}>{showNewPw ? <EyeOff size={13} /> : <Eye size={13} />}</button>
                                {newPassword ? (
                                  <button type="button" onClick={() => { navigator.clipboard.writeText(newPassword); setCopiedPw(true); setTimeout(() => setCopiedPw(false), 2000); }} className="rounded-md p-1.5" style={{ color: copiedPw ? 'var(--success)' : 'var(--text-muted)' }} aria-label={copiedPw ? 'Copied' : 'Copy password'} title={copiedPw ? 'Copied!' : 'Copy password'}>{copiedPw ? <CheckCircle2 size={13} /> : <Copy size={13} />}</button>
                                ) : null}
                              </div>
                            </div>
                            <div className="mt-1 flex items-center gap-2">
                              <span className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>Auto-generated · {pwLength} chars</span>
                              <button type="button" onClick={() => setShowPasswordGen((v) => !v)} className="text-[11.5px] font-medium" style={{ color: 'var(--accent)' }}>
                                {showPasswordGen ? 'Hide options' : 'Customize'}
                              </button>
                            </div>
                            {showPasswordGen ? (
                              <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                                className="mt-2 overflow-hidden rounded-lg p-3"
                                style={{ background: 'var(--settings-inset-bg)', border: 'var(--settings-inset-border)' }}
                              >
                                <div className="mb-2 flex items-center justify-between">
                                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--accent)' }}>Generator options</span>
                                  <button
                                    type="button"
                                    onClick={() => { setNewPassword(generateStrongPassword(pwLength, pwUppercase, pwLowercase, pwDigits, pwSymbols)); setShowNewPw(true); setCopiedPw(false); }}
                                    className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] font-medium"
                                    style={{ background: 'var(--settings-cta-bg)', color: 'var(--settings-cta-text)', border: 'var(--settings-cta-border)' }}
                                  >
                                    <RefreshCcw size={11} /> Regenerate
                                  </button>
                                </div>
                                <div className="mb-2">
                                  <div className="flex items-center justify-between text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                                    <span>Length</span>
                                    <span className="font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{pwLength}</span>
                                  </div>
                                  <input
                                    type="range" min={8} max={32} value={pwLength}
                                    onChange={(e) => { const len = Number(e.target.value); setPwLength(len); setNewPassword(generateStrongPassword(len, pwUppercase, pwLowercase, pwDigits, pwSymbols)); setShowNewPw(true); setCopiedPw(false); }}
                                    className="mt-1 w-full accent-[var(--accent)]"
                                  />
                                  <div className="flex justify-between text-[10.5px]" style={{ color: 'var(--text-muted)' }}><span>8</span><span>32</span></div>
                                </div>
                                <div className="grid grid-cols-2 gap-1.5">
                                  <ToggleChip label="A–Z" checked={pwUppercase} onChange={(v) => { setPwUppercase(v); setNewPassword(generateStrongPassword(pwLength, v, pwLowercase, pwDigits, pwSymbols)); setCopiedPw(false); }} disabled={!pwLowercase && !pwDigits && !pwSymbols} />
                                  <ToggleChip label="a–z" checked={pwLowercase} onChange={(v) => { setPwLowercase(v); setNewPassword(generateStrongPassword(pwLength, pwUppercase, v, pwDigits, pwSymbols)); setCopiedPw(false); }} disabled={!pwUppercase && !pwDigits && !pwSymbols} />
                                  <ToggleChip label="0–9" checked={pwDigits} onChange={(v) => { setPwDigits(v); setNewPassword(generateStrongPassword(pwLength, pwUppercase, pwLowercase, v, pwSymbols)); setCopiedPw(false); }} disabled={!pwUppercase && !pwLowercase && !pwSymbols} />
                                  <ToggleChip label="!@#$" checked={pwSymbols} onChange={(v) => { setPwSymbols(v); setNewPassword(generateStrongPassword(pwLength, pwUppercase, pwLowercase, pwDigits, v)); setCopiedPw(false); }} disabled={!pwUppercase && !pwLowercase && !pwDigits} />
                                </div>
                              </motion.div>
                            ) : null}
                          </SettingsLabeledInput>

                          <div className="grid gap-2.5 sm:grid-cols-2">
                            <SettingsLabeledInput label="Role" id="new-role">
                              <div className="relative">
                                <select
                                  id="new-role"
                                  value={newRole}
                                  onChange={(e) => { setNewRole(e.target.value as CreatableUserRole); if (e.target.value === 'manager') setNewDevAccountId(''); }}
                                  className="w-full appearance-none rounded-lg px-3 py-2 text-[13px] outline-none"
                                  style={{ background: 'var(--settings-input-bg)', color: 'var(--text-primary)', border: 'var(--settings-input-border)' }}
                                >
                                  <option value="developer">Developer</option>
                                  <option value="manager">Manager</option>
                                </select>
                                <ChevronDown size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                              </div>
                            </SettingsLabeledInput>
                            {newRole === 'developer' ? (
                              <SettingsLabeledInput label="Team member" id="new-jira-profile">
                                <div className="relative">
                                  <select
                                    id="new-jira-profile"
                                    value={newDevAccountId}
                                    onChange={(e) => setNewDevAccountId(e.target.value)}
                                    className="w-full appearance-none rounded-lg px-3 py-2 text-[13px] outline-none"
                                    style={{ background: 'var(--settings-input-bg)', color: 'var(--text-primary)', border: 'var(--settings-input-border)' }}
                                  >
                                    <option value="">Select…</option>
                                    {developers.map((dev) => (
                                      <option key={dev.accountId} value={dev.accountId}>
                                        {dev.displayName}{dev.email ? ` (${dev.email})` : ''}{dev.source === 'manual' && !dev.jiraAccountId ? ' · manual' : ''}
                                      </option>
                                    ))}
                                  </select>
                                  <ChevronDown size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                                </div>
                              </SettingsLabeledInput>
                            ) : (
                              <div className="flex items-center rounded-lg px-3 py-2 text-[12px]" style={{ background: 'var(--settings-inset-bg)', color: 'var(--text-muted)', border: 'var(--settings-inset-border)' }}>
                                Managers do not need a team member link.
                              </div>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={handleCreateUser}
                          disabled={creatingUser || !newUsername.trim() || !newDisplayName.trim() || !newPassword.trim()}
                          className="mt-3.5 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold transition-colors disabled:opacity-50"
                          style={{ background: 'var(--settings-cta-bg)', color: 'var(--settings-cta-text)', border: 'var(--settings-cta-border)' }}
                        >
                          {creatingUser ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}
                          {creatingUser ? 'Creating…' : 'Create account'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ) : null}

            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* ── FOOTER — Jira save/sync only on Jira sections; other sections have their own actions ── */}
      {activeSection === 'maintenance' || activeSection === 'connection' || activeSection === 'sync' ? (
        <div
          className="shrink-0 border-t px-5 py-2"
          style={{ borderColor: 'var(--border-strong)', background: 'color-mix(in srgb, var(--bg-secondary) 74%, var(--bg-primary) 26%)' }}
        >
        {activeSection === 'maintenance' ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              Maintenance actions run immediately after typed confirmation. The standard Save footer is intentionally hidden here.
            </p>
            <button
              type="button"
              onClick={handleResetConfig}
              disabled={hasChanges}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors disabled:opacity-50"
              style={{ background: 'var(--settings-danger-soft-bg)', color: 'var(--danger-muted)', border: 'var(--settings-danger-soft-border)' }}
            >
              <AlertTriangle size={12} />
              Reset &amp; Reconfigure App
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              Save stores settings only. Save &amp; Sync also triggers an immediate Jira refresh.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleResetConfig}
                disabled={hasChanges}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors disabled:opacity-50"
                style={{ background: 'var(--settings-danger-soft-bg)', color: 'var(--danger-muted)', border: 'var(--settings-danger-soft-border)' }}
              >
                <AlertTriangle size={12} />
                Reset &amp; Reconfigure
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={hasChanges}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors disabled:opacity-50"
                style={{ background: 'var(--settings-neutral-chip-bg)', color: 'var(--text-primary)', border: '1px solid var(--border-strong)' }}
              >
                <Save size={12} />
                Save
              </button>
              <button
                type="button"
                onClick={handleSaveAndSync}
                disabled={hasChanges || triggerSync.isPending}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-colors disabled:opacity-50"
                style={{ background: 'var(--settings-cta-primary-bg)', color: 'var(--settings-cta-primary-text)' }}
              >
                <RefreshCw size={12} className={triggerSync.isPending ? 'animate-spin' : ''} />
                Save &amp; Sync
              </button>
            </div>
          </div>
        )}
        </div>
      ) : null}
    </motion.div>
  );
}

export const SettingsPanel = SettingsPage;

// ── Layout helpers ────────────────────────────────────────────

function SettingsGroupLabel({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--text-muted)' }}>
      {children}
    </h3>
  );
}

function SettingsLabeledInput({ label, id, children }: { label: string; id?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function CompactFieldRow({
  label,
  description,
  value,
  onChange,
  onDiscover,
  loading,
  active,
  placeholder,
}: {
  label: string;
  description: string;
  value: string;
  onChange: (v: string) => void;
  onDiscover: () => void;
  loading: boolean;
  active: boolean;
  placeholder: string;
}) {
  return (
    <div
      className="rounded-lg p-3"
      style={{
        background: active ? 'var(--settings-accent-chip-bg)' : 'color-mix(in srgb, var(--bg-secondary) 60%, var(--bg-primary) 40%)',
        border: active ? '1px solid color-mix(in srgb, var(--accent) 40%, var(--border))' : '1px solid var(--border)',
      }}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <p className="text-[12.5px] font-semibold" style={{ color: 'var(--text-primary)' }}>{label}</p>
          <p className="mt-0.5 text-[11.5px]" style={{ color: 'var(--text-muted)' }}>{description}</p>
        </div>
        <button
          type="button"
          onClick={onDiscover}
          className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors"
          style={{
            background: active ? 'var(--settings-accent-chip-bg)' : 'var(--settings-neutral-chip-bg)',
            color: active ? 'var(--accent)' : 'var(--text-secondary)',
            border: '1px solid var(--border)',
          }}
        >
          {loading ? <RefreshCw size={10} className="animate-spin" /> : <Search size={10} />}
          Discover
        </button>
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md px-2.5 py-1.5 font-mono text-[12.5px] outline-none"
        style={{ background: 'var(--settings-input-bg)', color: 'var(--text-primary)', border: 'var(--settings-input-border)' }}
      />
    </div>
  );
}

// ── Data helpers ──────────────────────────────────────────────

function UserAccountDeleteAction({
  user,
  confirming,
  deleting,
  onStartConfirm,
  onCancel,
  onConfirm,
}: {
  user: AuthUser;
  confirming: boolean;
  deleting: boolean;
  onStartConfirm: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (confirming) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-2"
      >
        <span className="text-[12px] font-medium" style={{ color: 'var(--danger-muted)' }}>Delete access?</span>
        <button
          type="button"
          onClick={onConfirm}
          disabled={deleting}
          className="rounded-full px-2.5 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-50"
          style={{ background: 'var(--settings-danger-soft-bg)', color: 'var(--danger-muted)', border: 'var(--settings-danger-soft-border)' }}
          aria-label={`Confirm delete account for ${user.displayName}`}
        >
          {deleting ? <span className="flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" />Deleting…</span> : 'Confirm'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={deleting}
          className="rounded-full px-2.5 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-50"
          style={{ background: 'var(--settings-neutral-chip-bg)', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)' }}
          aria-label={`Cancel deleting account for ${user.displayName}`}
        >
          Cancel
        </button>
      </motion.div>
    );
  }

  return (
    <button
      type="button"
      onClick={onStartConfirm}
      className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] font-semibold transition-colors"
      style={{ background: 'var(--settings-danger-soft-bg)', color: 'var(--danger-muted)', border: 'var(--settings-danger-soft-border)' }}
      aria-label={`Delete account for ${user.displayName}`}
    >
      <UserMinus size={12} />
      Delete
    </button>
  );
}

function TeamMemberRemoveAction({
  member,
  confirming,
  removing,
  disabled,
  onStartConfirm,
  onCancel,
  onConfirm,
}: {
  member: DiscoveredUser;
  confirming: boolean;
  removing: boolean;
  disabled: boolean;
  onStartConfirm: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!confirming || removing) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        onCancel();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCancel();
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [confirming, removing, onCancel]);

  if (confirming) {
    return (
      <motion.div
        ref={containerRef}
        initial={{ opacity: 0, x: 6 }}
        animate={{ opacity: 1, x: 0 }}
        className="flex items-center gap-1.5"
      >
        <button
          type="button"
          onClick={onConfirm}
          disabled={removing}
          className="flex h-6 w-6 items-center justify-center rounded-md transition-colors disabled:opacity-50"
          style={{ background: 'var(--settings-danger-soft-bg)', color: 'var(--danger-muted)', border: 'var(--settings-danger-soft-border)' }}
          aria-label={`Confirm removing ${member.displayName} from team`}
          title="Confirm removal"
        >
          {removing ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={removing}
          className="flex h-6 w-6 items-center justify-center rounded-md transition-colors disabled:opacity-50"
          style={{ background: 'var(--settings-input-bg)', color: 'var(--text-secondary)', border: 'var(--settings-input-border)' }}
          aria-label={`Cancel removing ${member.displayName} from team`}
          title="Cancel removal"
        >
          <X size={12} />
        </button>
      </motion.div>
    );
  }

  return (
    <button
      type="button"
      onClick={onStartConfirm}
      disabled={disabled}
      className="flex h-6 w-6 items-center justify-center rounded-md transition-colors disabled:opacity-50"
      style={{ background: 'var(--settings-input-bg)', color: 'var(--text-secondary)', border: 'var(--settings-input-border)' }}
      title="Remove from team"
      aria-label={`Remove ${member.displayName} from team`}
    >
      <UserMinus size={12} />
    </button>
  );
}

function FieldListGroup({
  title,
  fields,
  currentFieldValue,
  onSelect,
  accent = false,
}: {
  title: string;
  fields: JiraField[];
  currentFieldValue: string;
  onSelect: (fieldId: string) => void;
  accent?: boolean;
}) {
  return (
    <>
      <div
        className="px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em]"
        style={{ color: accent ? 'var(--accent)' : 'var(--text-muted)', background: 'var(--settings-neutral-chip-bg)' }}
      >
        {title}
      </div>
      {fields.map((field) => (
        <button
          key={field.id}
          type="button"
          onClick={() => onSelect(field.id)}
          className="flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors"
          style={{ background: field.id === currentFieldValue ? 'var(--settings-accent-soft-bg)' : 'transparent', borderTop: 'var(--settings-row-divider)' }}
        >
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>{field.name}</p>
            <p className="truncate font-mono text-[12px]" style={{ color: 'var(--text-muted)' }}>{field.id}</p>
          </div>
          {field.id === currentFieldValue ? (
            <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.1em]" style={{ background: 'var(--settings-accent-soft-bg)', color: 'var(--accent)' }}>
              Selected
            </span>
          ) : null}
        </button>
      ))}
    </>
  );
}

function IdentityAvatar({ user, accent }: { user: { displayName: string; avatarUrl?: string }; accent: string }) {
  if (user.avatarUrl) {
    return <img src={user.avatarUrl} alt={user.displayName} className="h-7 w-7 shrink-0 rounded-lg object-cover" />;
  }
  return (
    <div
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold"
      style={{ background: 'var(--settings-neutral-chip-bg)', color: accent, border: '1px solid var(--border-strong)' }}
    >
      {user.displayName.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase() || 'U'}
    </div>
  );
}

function generateStrongPassword(
  length: number,
  uppercase: boolean,
  lowercase: boolean,
  digits: boolean,
  symbols: boolean,
): string {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const digit = '0123456789';
  const symbol = '!@#$%^&*_+-=?';

  let pool = '';
  const required: string[] = [];

  if (uppercase) { pool += upper; required.push(upper); }
  if (lowercase) { pool += lower; required.push(lower); }
  if (digits) { pool += digit; required.push(digit); }
  if (symbols) { pool += symbol; required.push(symbol); }

  if (!pool) { pool = lower + digit; required.push(lower, digit); }

  const arr = new Uint32Array(length);
  crypto.getRandomValues(arr);

  const chars: string[] = [];
  for (let i = 0; i < length; i++) {
    chars.push(pool.charAt(arr[i]! % pool.length));
  }

  for (let i = 0; i < required.length && i < length; i++) {
    const rng = new Uint32Array(2);
    crypto.getRandomValues(rng);
    const reqSet = required[i]!;
    chars[i] = reqSet.charAt(rng[0]! % reqSet.length);
  }

  for (let i = chars.length - 1; i > 0; i--) {
    const rng = new Uint32Array(1);
    crypto.getRandomValues(rng);
    const j = rng[0]! % (i + 1);
    const tmp = chars[i]!;
    chars[i] = chars[j]!;
    chars[j] = tmp;
  }

  return chars.join('');
}

function ToggleChip({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => { if (!disabled) onChange(!checked); }}
      aria-pressed={checked}
      disabled={disabled}
      className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-all"
      style={{
        background: checked ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'var(--settings-neutral-chip-bg)',
        color: checked ? 'var(--accent)' : 'var(--text-muted)',
        border: checked ? '1px solid color-mix(in srgb, var(--accent) 28%, transparent)' : '1px solid var(--border-strong)',
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <span
        className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded text-[10px] transition-colors"
        style={{
          background: checked ? 'var(--accent)' : 'transparent',
          border: checked ? 'none' : '1.5px solid var(--border-strong)',
          color: checked ? '#fff' : 'transparent',
        }}
      >
        {checked ? '✓' : ''}
      </span>
      {label}
    </button>
  );
}
