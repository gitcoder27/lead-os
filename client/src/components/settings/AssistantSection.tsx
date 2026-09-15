import { useEffect, useState, type ReactNode } from 'react';
import { CheckCircle2, Loader2, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import {
  useAssistantConfig,
  useTestAssistantConfig,
  useUpdateAssistantConfig,
} from '@/hooks/useAssistantConfig';
import type { AiProviderProfile, AssistantResponseStyle, UpdateAiAssistantConfigRequest } from '@/types';

function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--text-muted)' }}>
      {children}
    </h3>
  );
}

function LabeledInput({ label, id, children }: { label: string; id?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const inputClass = 'w-full rounded-lg px-3 py-1.5 text-[12.5px] outline-none';
const inputStyle = {
  background: 'var(--settings-input-bg)',
  color: 'var(--text-primary)',
  border: 'var(--settings-input-border)',
} as const;

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return baseUrl;
  }
}

function ToggleRow({
  title,
  description,
  checked,
  onChange,
  ariaLabel,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <div
      className="flex items-center justify-between gap-4 rounded-xl px-3.5 py-3"
      style={{ background: 'var(--settings-input-bg)', border: 'var(--settings-inset-border)' }}
    >
      <div className="min-w-0">
        <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          {title}
        </p>
        <p className="mt-0.5 text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
          {description}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        onClick={() => onChange(!checked)}
        className="relative h-6 w-11 shrink-0 rounded-full transition-colors duration-150"
        style={{
          background: checked ? 'var(--accent)' : 'var(--bg-tertiary)',
          border: checked ? '1px solid var(--accent)' : '1px solid var(--border-strong)',
        }}
      >
        <span
          className="absolute top-1/2 -translate-y-1/2 rounded-full transition-all duration-150"
          style={{
            left: checked ? 'calc(100% - 21px)' : '3px',
            width: '18px',
            height: '18px',
            background: checked ? '#fff' : 'var(--text-secondary)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
          }}
        />
      </button>
    </div>
  );
}

interface ProviderFormState {
  open: boolean;
  id: string | null;
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}

const CLOSED_PROVIDER_FORM: ProviderFormState = { open: false, id: null, name: '', baseUrl: '', model: '', apiKey: '' };

export function AssistantSection() {
  const { data: config } = useAssistantConfig();
  const updateConfig = useUpdateAssistantConfig();
  const testConfig = useTestAssistantConfig();
  const { addToast } = useToast();

  const [enabled, setEnabled] = useState(false);
  const [maxToolIterations, setMaxToolIterations] = useState(6);
  const [responseStyle, setResponseStyle] = useState<AssistantResponseStyle>('concise');
  const [suggestFollowups, setSuggestFollowups] = useState(true);
  const [autoConfirm, setAutoConfirm] = useState(false);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const [providerForm, setProviderForm] = useState<ProviderFormState>(CLOSED_PROVIDER_FORM);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [providerBusy, setProviderBusy] = useState<'save' | 'test' | 'delete' | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);

  useEffect(() => {
    if (config && !touched) {
      setEnabled(config.enabled);
      setMaxToolIterations(config.maxToolIterations);
      setResponseStyle(config.responseStyle);
      setSuggestFollowups(config.suggestFollowups);
      setAutoConfirm(config.autoConfirm);
    }
  }, [config, touched]);

  const markTouched = () => setTouched(true);
  const providers = config?.providers ?? [];
  const activeProviderId = config?.activeProviderId ?? null;

  const openAddProvider = () => {
    setProviderForm({ open: true, id: null, name: '', baseUrl: '', model: '', apiKey: '' });
    setConfirmingDelete(false);
  };

  const openEditProvider = (provider: AiProviderProfile) => {
    setProviderForm({ open: true, id: provider.id, name: provider.name, baseUrl: provider.baseUrl, model: provider.model, apiKey: '' });
    setConfirmingDelete(false);
  };

  const trimmedProviderBaseUrl = providerForm.baseUrl.trim();
  const trimmedProviderModel = providerForm.model.trim();
  const trimmedProviderApiKey = providerForm.apiKey.trim();
  const editingProvider = providers.find((p) => p.id === providerForm.id);
  const canSaveProvider = Boolean(trimmedProviderBaseUrl && trimmedProviderModel);

  const handleSetActive = async (provider: AiProviderProfile) => {
    if (provider.id === activeProviderId || activatingId) {
      return;
    }
    setActivatingId(provider.id);
    try {
      await updateConfig.mutateAsync({ activeProviderId: provider.id });
      addToast({ type: 'success', title: 'Copilot provider switched', message: `Now using ${provider.name}.` });
    } catch (err) {
      addToast({ type: 'error', title: 'Failed to switch provider', message: err instanceof Error ? err.message : 'Unable to switch provider' });
    } finally {
      setActivatingId(null);
    }
  };

  const handleSaveProvider = async () => {
    if (!canSaveProvider) {
      return;
    }
    setProviderBusy('save');
    try {
      await updateConfig.mutateAsync({
        upsertProvider: {
          ...(providerForm.id ? { id: providerForm.id } : {}),
          ...(providerForm.name.trim() ? { name: providerForm.name.trim() } : {}),
          baseUrl: trimmedProviderBaseUrl,
          model: trimmedProviderModel,
          ...(trimmedProviderApiKey ? { apiKey: trimmedProviderApiKey } : {}),
        },
      });
      setProviderForm(CLOSED_PROVIDER_FORM);
      setConfirmingDelete(false);
      addToast({ type: 'success', title: 'Provider saved', message: 'The Copilot provider profile has been updated.' });
    } catch (err) {
      addToast({ type: 'error', title: 'Failed to save provider', message: err instanceof Error ? err.message : 'Unable to save provider' });
    } finally {
      setProviderBusy(null);
    }
  };

  const handleDeleteProvider = async () => {
    if (!providerForm.id) {
      return;
    }
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setProviderBusy('delete');
    try {
      await updateConfig.mutateAsync({ removeProviderId: providerForm.id });
      setProviderForm(CLOSED_PROVIDER_FORM);
      setConfirmingDelete(false);
      addToast({ type: 'success', title: 'Provider removed', message: 'The provider profile and its stored key were deleted.' });
    } catch (err) {
      addToast({ type: 'error', title: 'Failed to remove provider', message: err instanceof Error ? err.message : 'Unable to remove provider' });
    } finally {
      setProviderBusy(null);
    }
  };

  const handleTestProvider = async () => {
    setProviderBusy('test');
    try {
      const result = await testConfig.mutateAsync({
        ...(providerForm.id ? { providerId: providerForm.id } : {}),
        ...(trimmedProviderBaseUrl ? { baseUrl: trimmedProviderBaseUrl } : {}),
        ...(trimmedProviderModel ? { model: trimmedProviderModel } : {}),
        ...(trimmedProviderApiKey ? { apiKey: trimmedProviderApiKey } : {}),
      });
      addToast({
        type: 'success',
        title: 'Copilot connection verified',
        message: `Connected to ${result.model} in ${result.latencyMs} ms.`,
      });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Copilot connection failed',
        message: err instanceof Error ? err.message : 'Unable to reach the AI provider.',
      });
    } finally {
      setProviderBusy(null);
    }
  };

  const handleSave = async () => {
    const patch: UpdateAiAssistantConfigRequest = {};
    if (!config || enabled !== config.enabled) {
      patch.enabled = enabled;
    }
    const iterations = Math.min(10, Math.max(1, Math.round(maxToolIterations)));
    if (!config || iterations !== config.maxToolIterations) {
      patch.maxToolIterations = iterations;
    }
    if (!config || responseStyle !== config.responseStyle) {
      patch.responseStyle = responseStyle;
    }
    if (!config || suggestFollowups !== config.suggestFollowups) {
      patch.suggestFollowups = suggestFollowups;
    }
    if (!config || autoConfirm !== config.autoConfirm) {
      patch.autoConfirm = autoConfirm;
    }

    setSaving(true);
    try {
      await updateConfig.mutateAsync(patch);
      setTouched(false);
      addToast({ type: 'success', title: 'Copilot settings saved', message: 'The assistant configuration has been updated.' });
    } catch (err) {
      addToast({ type: 'error', title: 'Failed to save Copilot settings', message: err instanceof Error ? err.message : 'Unable to save settings' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-[720px] space-y-7">
      {/* Enable toggle */}
      <div>
        <GroupLabel>Assistant</GroupLabel>
        <p className="mt-1 mb-3 text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          LeadOS Copilot answers questions about this workspace and proposes actions that only run after you confirm
          them. It needs an OpenAI-compatible API key.
        </p>
        <div className="space-y-2">
          <ToggleRow
            title="Enable Copilot"
            description={
              enabled
                ? 'On — managers can open the Copilot dock (Ctrl/⌘+J).'
                : 'Off — the Copilot dock shows a setup prompt instead.'
            }
            checked={enabled}
            onChange={(next) => {
              markTouched();
              setEnabled(next);
            }}
            ariaLabel="Toggle Copilot"
          />
          <ToggleRow
            title="Follow-up suggestions"
            description="Show 2–3 next-step chips under each answer."
            checked={suggestFollowups}
            onChange={(next) => {
              markTouched();
              setSuggestFollowups(next);
            }}
            ariaLabel="Toggle follow-up suggestions"
          />
          <ToggleRow
            title="Full access — auto-confirm actions"
            description={
              autoConfirm
                ? 'On — Copilot runs write actions (desk items, check-ins, Jira changes) immediately, no confirmation asked.'
                : 'Off — Copilot proposes write actions and waits for you to confirm each one.'
            }
            checked={autoConfirm}
            onChange={(next) => {
              markTouched();
              setAutoConfirm(next);
            }}
            ariaLabel="Toggle full access auto-confirm"
          />
        </div>
      </div>

      {/* Providers */}
      <div>
        <GroupLabel>Providers</GroupLabel>
        <p className="mt-1 mb-3 text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          Any OpenAI-compatible chat-completions endpoint works. Save one provider per account — each keeps its own
          endpoint, model, and encrypted key — then pick which one Copilot uses.
        </p>
        <div className="space-y-2">
          {providers.map((provider) => {
            const isActive = provider.id === activeProviderId;
            return (
              <div
                key={provider.id}
                className="flex items-center gap-3 rounded-xl px-3.5 py-3"
                style={{ background: 'var(--settings-input-bg)', border: 'var(--settings-inset-border)' }}
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  aria-label={`Set ${provider.name} as the active provider`}
                  onClick={() => void handleSetActive(provider)}
                  disabled={isActive || activatingId !== null}
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full disabled:cursor-default"
                  style={{
                    border: isActive ? '1px solid var(--accent)' : '1px solid var(--border-strong)',
                    background: 'transparent',
                  }}
                  title={isActive ? 'Active provider' : `Switch Copilot to ${provider.name}`}
                >
                  {isActive ? (
                    <span className="block h-2 w-2 rounded-full" style={{ background: 'var(--accent)' }} />
                  ) : activatingId === provider.id ? (
                    <Loader2 size={10} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
                  ) : null}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {provider.name}
                    </p>
                    {isActive ? (
                      <span
                        className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
                        style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}
                      >
                        Active
                      </span>
                    ) : null}
                    {!provider.hasApiKey ? (
                      <span
                        className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
                        style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
                      >
                        No key
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate font-mono text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                    {provider.model} · {hostOf(provider.baseUrl)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openEditProvider(provider)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors"
                  style={{
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-secondary)',
                  }}
                  title={`Edit ${provider.name}`}
                  aria-label={`Edit provider ${provider.name}`}
                >
                  <Pencil size={12} />
                </button>
              </div>
            );
          })}
          {providers.length === 0 ? (
            <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              No providers saved yet — add one below.
            </p>
          ) : null}
          <button
            type="button"
            onClick={openAddProvider}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-colors"
            style={{
              background: 'var(--settings-accent-soft-bg)',
              color: 'var(--accent)',
              border: 'var(--settings-accent-soft-border)',
            }}
          >
            <Plus size={13} />
            Add provider
          </button>
        </div>

        {providerForm.open ? (
          <div
            className="mt-3 space-y-3 rounded-xl p-3.5"
            style={{ background: 'var(--settings-input-bg)', border: 'var(--settings-inset-border)' }}
          >
            <p className="text-[12.5px] font-semibold" style={{ color: 'var(--text-primary)' }}>
              {providerForm.id ? `Edit ${editingProvider?.name ?? 'provider'}` : 'New provider'}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <LabeledInput label="Name" id="ai-provider-name">
                <input
                  id="ai-provider-name"
                  type="text"
                  value={providerForm.name}
                  onChange={(e) => setProviderForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g. ZAI or DeepSeek"
                  className={inputClass}
                  style={inputStyle}
                />
              </LabeledInput>
              <LabeledInput label="Model" id="ai-provider-model">
                <input
                  id="ai-provider-model"
                  type="text"
                  value={providerForm.model}
                  onChange={(e) => setProviderForm((prev) => ({ ...prev, model: e.target.value }))}
                  placeholder="glm-5.3-flash"
                  className={`${inputClass} font-mono`}
                  style={inputStyle}
                />
              </LabeledInput>
              <div className="sm:col-span-2">
                <LabeledInput label="Base URL" id="ai-provider-base-url">
                  <input
                    id="ai-provider-base-url"
                    type="url"
                    value={providerForm.baseUrl}
                    onChange={(e) => setProviderForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
                    placeholder="https://api.z.ai/api/paas/v4"
                    className={`${inputClass} font-mono`}
                    style={inputStyle}
                  />
                </LabeledInput>
              </div>
              <div className="sm:col-span-2">
                <LabeledInput
                  label={editingProvider?.hasApiKey ? 'API key (stored — paste to replace)' : 'API key'}
                  id="ai-provider-api-key"
                >
                  <input
                    id="ai-provider-api-key"
                    type="password"
                    value={providerForm.apiKey}
                    onChange={(e) => setProviderForm((prev) => ({ ...prev, apiKey: e.target.value }))}
                    placeholder={editingProvider?.hasApiKey ? '•••••••• (stored)' : 'sk-…'}
                    autoComplete="off"
                    className={`${inputClass} font-mono`}
                    style={inputStyle}
                  />
                </LabeledInput>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleSaveProvider()}
                disabled={!canSaveProvider || providerBusy !== null}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-colors disabled:opacity-50"
                style={{
                  background: 'var(--settings-cta-primary-bg)',
                  color: 'var(--settings-cta-primary-text)',
                  border: 'var(--settings-cta-border)',
                }}
              >
                {providerBusy === 'save' ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                {providerForm.id ? 'Save provider' : 'Add provider'}
              </button>
              <button
                type="button"
                onClick={() => void handleTestProvider()}
                disabled={providerBusy !== null}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-colors disabled:opacity-50"
                style={{
                  background: 'var(--settings-accent-soft-bg)',
                  color: 'var(--accent)',
                  border: 'var(--settings-accent-soft-border)',
                }}
              >
                {providerBusy === 'test' ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                Test connection
              </button>
              {providerForm.id ? (
                <button
                  type="button"
                  onClick={() => void handleDeleteProvider()}
                  disabled={providerBusy !== null}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-colors disabled:opacity-50"
                  style={{
                    background: 'transparent',
                    color: 'var(--danger)',
                    border: '1px solid color-mix(in srgb, var(--danger) 40%, transparent)',
                  }}
                >
                  {providerBusy === 'delete' ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  {confirmingDelete ? 'Confirm delete' : 'Delete'}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setProviderForm(CLOSED_PROVIDER_FORM);
                  setConfirmingDelete(false);
                }}
                disabled={providerBusy !== null}
                className="rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-colors disabled:opacity-50"
                style={{ color: 'var(--text-secondary)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Behavior */}
      <div>
        <GroupLabel>Behavior</GroupLabel>
        <p className="mt-1 mb-3 text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          Shared across providers. Requests are made server-side; keys never reach the browser after saving.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <LabeledInput label="Max tool iterations" id="ai-max-tool-iterations">
            <input
              id="ai-max-tool-iterations"
              type="number"
              min={1}
              max={10}
              value={maxToolIterations}
              onChange={(e) => {
                markTouched();
                setMaxToolIterations(Number(e.target.value));
              }}
              className={inputClass}
              style={inputStyle}
            />
          </LabeledInput>
          <LabeledInput label="Response style" id="ai-response-style">
            <select
              id="ai-response-style"
              value={responseStyle}
              onChange={(e) => {
                markTouched();
                setResponseStyle(e.target.value as AssistantResponseStyle);
              }}
              className={inputClass}
              style={inputStyle}
            >
              <option value="concise">Concise — lead with the answer</option>
              <option value="detailed">Detailed — fuller context</option>
            </select>
          </LabeledInput>
        </div>
      </div>

      {/* Save */}
      <div>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-[12.5px] font-semibold transition-colors disabled:opacity-50"
          style={{
            background: 'var(--settings-cta-primary-bg)',
            color: 'var(--settings-cta-primary-text)',
            border: 'var(--settings-cta-border)',
          }}
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          Save
        </button>
      </div>
    </div>
  );
}
