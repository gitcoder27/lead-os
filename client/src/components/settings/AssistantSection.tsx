import { useEffect, useState, type ReactNode } from 'react';
import { CheckCircle2, Loader2, Save } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import {
  useAssistantConfig,
  useTestAssistantConfig,
  useUpdateAssistantConfig,
} from '@/hooks/useAssistantConfig';
import type { AssistantResponseStyle, UpdateAiAssistantConfigRequest } from '@/types';

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

export function AssistantSection() {
  const { data: config } = useAssistantConfig();
  const updateConfig = useUpdateAssistantConfig();
  const testConfig = useTestAssistantConfig();
  const { addToast } = useToast();

  const [enabled, setEnabled] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [maxToolIterations, setMaxToolIterations] = useState(6);
  const [responseStyle, setResponseStyle] = useState<AssistantResponseStyle>('concise');
  const [suggestFollowups, setSuggestFollowups] = useState(true);
  const [apiKey, setApiKey] = useState('');
  const [touched, setTouched] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (config && !touched) {
      setEnabled(config.enabled);
      setBaseUrl(config.baseUrl);
      setModel(config.model);
      setMaxToolIterations(config.maxToolIterations);
      setResponseStyle(config.responseStyle);
      setSuggestFollowups(config.suggestFollowups);
    }
  }, [config, touched]);

  const markTouched = () => setTouched(true);
  const trimmedBaseUrl = baseUrl.trim();
  const trimmedModel = model.trim();
  const trimmedApiKey = apiKey.trim();
  const hasApiKey = Boolean(config?.hasApiKey);

  const handleTest = async () => {
    setTesting(true);
    try {
      const result = await testConfig.mutateAsync({
        ...(trimmedBaseUrl ? { baseUrl: trimmedBaseUrl } : {}),
        ...(trimmedModel ? { model: trimmedModel } : {}),
        ...(trimmedApiKey ? { apiKey: trimmedApiKey } : {}),
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
      setTesting(false);
    }
  };

  const handleSave = async () => {
    const patch: UpdateAiAssistantConfigRequest = {};
    if (!config || enabled !== config.enabled) {
      patch.enabled = enabled;
    }
    if (!config || trimmedBaseUrl !== config.baseUrl) {
      patch.baseUrl = trimmedBaseUrl;
    }
    if (!config || trimmedModel !== config.model) {
      patch.model = trimmedModel;
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
    if (trimmedApiKey) {
      patch.apiKey = trimmedApiKey;
    }

    setSaving(true);
    try {
      await updateConfig.mutateAsync(patch);
      if (trimmedApiKey) {
        setApiKey('');
      }
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
        </div>
      </div>

      {/* Provider details */}
      <div>
        <GroupLabel>Provider</GroupLabel>
        <p className="mt-1 mb-3 text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          Any OpenAI-compatible chat-completions endpoint works. Requests are made server-side; the key never reaches
          the browser after saving.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <LabeledInput label="Provider" id="ai-provider">
            <select id="ai-provider" value="openai-compatible" disabled className={inputClass} style={inputStyle}>
              <option value="openai-compatible">OpenAI-compatible</option>
            </select>
          </LabeledInput>
          <LabeledInput label="Model" id="ai-model">
            <input
              id="ai-model"
              type="text"
              value={model}
              onChange={(e) => {
                markTouched();
                setModel(e.target.value);
              }}
              placeholder="glm-5.3-flash"
              className={`${inputClass} font-mono`}
              style={inputStyle}
            />
          </LabeledInput>
          <div className="sm:col-span-2">
            <LabeledInput label="Base URL" id="ai-base-url">
              <input
                id="ai-base-url"
                type="url"
                value={baseUrl}
                onChange={(e) => {
                  markTouched();
                  setBaseUrl(e.target.value);
                }}
                placeholder="https://api.z.ai/api/paas/v4"
                className={`${inputClass} font-mono`}
                style={inputStyle}
              />
            </LabeledInput>
          </div>
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

      {/* API key */}
      <div>
        <div className="flex items-center justify-between">
          <GroupLabel>API Key</GroupLabel>
          {hasApiKey ? (
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
              style={{ background: 'var(--settings-success-soft-bg)', color: 'var(--success)' }}
            >
              Stored
            </span>
          ) : null}
        </div>
        <p className="mt-1 mb-3 text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          The saved key is encrypted at rest and never displayed. Paste a new key to replace it.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="ai-api-key"
            type="password"
            value={apiKey}
            onChange={(e) => {
              markTouched();
              setApiKey(e.target.value);
            }}
            placeholder={hasApiKey ? '•••••••• (stored)' : 'sk-…'}
            autoComplete="off"
            className="min-w-0 flex-1 rounded-lg px-3 py-1.5 font-mono text-[12.5px] outline-none"
            style={inputStyle}
          />
          <button
            type="button"
            onClick={() => void handleTest()}
            disabled={testing}
            className="flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-colors disabled:opacity-50"
            style={{
              background: 'var(--settings-accent-soft-bg)',
              color: 'var(--accent)',
              border: 'var(--settings-accent-soft-border)',
            }}
          >
            {testing ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
            Test connection
          </button>
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
