import React, { useState, useEffect, useCallback } from 'react';
import {
  Cpu,
  Globe,
  Bell,
  Shield,
  Bot,
  Save,
  Plug,
  Eye,
  EyeOff,
  Trash2,
  Plus,
  RotateCcw,
  X,
  AlertTriangle,
  Wifi,
  RefreshCw,
  Link,
} from 'lucide-react';
import type { LLMConfig, NotificationConfig, BrowserConfig, RiskLevel, ThinkingLevel, PetProfile, PetRole, AgentCardInfo } from '../../shared/types';
import { TOOL_GROUPS, CUSTOM_PROFILE_DEFAULT_PROMPT, CUSTOM_PROFILE_DEFAULT_TOOLS } from '../../shared/constants';

/** Provider option with display label and available models */
interface ProviderOption {
  value: string;
  label: string;
  models: ModelOption[];
}

interface ModelOption {
  value: string;
  label: string;
}

/** Sentinel value used when the user picks "Custom" in a model dropdown */
const CUSTOM_MODEL_VALUE = '__custom__';

const PROVIDERS: ProviderOption[] = [
  {
    value: 'openai',
    label: 'OpenAI',
    models: [
      { value: 'gpt-4o', label: 'GPT-4o' },
      { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
      { value: 'o1', label: 'o1' },
      { value: 'o3-mini', label: 'o3 Mini' },
    ],
  },
  {
    value: 'anthropic',
    label: 'Anthropic',
    models: [
      { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
      { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
    ],
  },
  {
    value: 'google',
    label: 'Google',
    models: [
      { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
      { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
    ],
  },
  {
    value: 'deepseek',
    label: 'DeepSeek',
    models: [
      { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
      { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
      { value: 'deepseek-chat', label: 'DeepSeek Chat (compat)' },
      { value: 'deepseek-reasoner', label: 'DeepSeek Reasoner (compat)' },
    ],
  },
  {
    value: 'xai',
    label: 'xAI (Grok)',
    models: [
      { value: 'grok-3', label: 'Grok 3' },
      { value: 'grok-3-mini', label: 'Grok 3 Mini' },
    ],
  },
  {
    value: 'openrouter',
    label: 'OpenRouter',
    models: [],
  },
];

/** Status of a connection test attempt */
type ConnectionStatus = 'idle' | 'testing' | 'success' | 'error';

/** Sidebar navigation sections */
type Section = 'llm' | 'browser' | 'notifications' | 'permissions' | 'pets';

const sharedStyles: Record<string, React.CSSProperties> = {
  label: {
    display: 'block',
    fontSize: 'var(--text-xs)',
    fontWeight: 'var(--font-medium)',
    color: 'var(--text-secondary)',
    marginBottom: 'var(--space-2)',
    textTransform: 'uppercase' as const,
    letterSpacing: 'var(--tracking-wide)',
  },
  input: {
    width: '100%',
    padding: 'var(--space-3) var(--space-3)',
    background: 'var(--bg-elevated)',
    border: `1px solid var(--border)`,
    borderRadius: 'var(--radius-md)',
    color: 'var(--text-primary)',
    fontSize: 'var(--text-base)',
    fontFamily: 'inherit',
    outline: 'none',
  },
  select: {
    width: '100%',
    padding: 'var(--space-3) var(--space-3)',
    background: 'var(--bg-elevated)',
    border: `1px solid var(--border)`,
    borderRadius: 'var(--radius-md)',
    color: 'var(--text-primary)',
    fontSize: 'var(--text-base)',
    fontFamily: 'inherit',
    outline: 'none',
    cursor: 'pointer',
    appearance: 'none' as const,
    WebkitAppearance: 'none' as const,
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%23aaa' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10z'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right var(--space-3) center',
    paddingRight: 'var(--space-8)',
  },
  hint: {
    fontSize: 'var(--text-xs)',
    color: 'var(--text-tertiary)',
    marginTop: 'var(--space-1)',
  },
  field: {
    marginBottom: 'var(--space-4)',
  },
  btnRow: {
    display: 'flex',
    gap: 'var(--space-3)',
    marginTop: 'var(--space-6)',
  },
  btn: {
    padding: 'var(--space-3) var(--space-6)',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    fontSize: 'var(--text-base)',
    fontWeight: 'var(--font-medium)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'opacity var(--duration-fast) var(--ease-default)',
  },
  btnSave: {
    background: 'var(--success)',
    color: '#fff',
  },
  btnTest: {
    background: 'var(--brand)',
    color: '#fff',
  },
  statusMsg: {
    marginTop: 'var(--space-3)',
    fontSize: 'var(--text-xs)',
    padding: 'var(--space-2) var(--space-3)',
    borderRadius: 'var(--radius-sm)',
  },
  successMsg: {
    color: 'var(--success)',
    background: 'var(--success-bg)',
  },
  errorMsg: {
    color: 'var(--danger)',
    background: 'var(--danger-bg)',
  },
  infoMsg: {
    color: 'var(--warning)',
    background: 'var(--warning-bg)',
  },
};

function StatusBlock({ status, message }: { status: ConnectionStatus; message: string }) {
  if (status === 'idle' || !message) return null;
  return (
    <div style={{
      ...sharedStyles.statusMsg,
      ...(status === 'success' ? sharedStyles.successMsg
        : status === 'testing' ? sharedStyles.infoMsg
        : sharedStyles.errorMsg),
    }}>
      {message}
    </div>
  );
}

function SaveStatus({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div style={{
      ...sharedStyles.statusMsg,
      ...((message.includes('Failed') || message.includes('失败')) ? sharedStyles.errorMsg : sharedStyles.successMsg),
    }}>
      {message}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section components
// ---------------------------------------------------------------------------

function LLMSection() {
  const [provider, setProvider] = useState('openai');
  const [model, setModel] = useState('gpt-4o');
  const [customModelValue, setCustomModelValue] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle');
  const [connectionMessage, setConnectionMessage] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [hasLoaded, setHasLoaded] = useState(false);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>('low');

  const isCustomModel = model === CUSTOM_MODEL_VALUE;
  const effectiveModel = isCustomModel ? customModelValue : model;
  const currentProvider = PROVIDERS.find((p) => p.value === provider);
  const isFormValid = provider && effectiveModel && apiKey.trim().length > 0;

  useEffect(() => {
    if (!window.settingsAPI) return;
    window.settingsAPI.loadConfig().then((config) => {
      if (config) {
        const loadedProvider = config.provider || 'openai';
        const loadedModel = config.model || '';
        setProvider(loadedProvider);
        setApiKey(config.apiKey || '');
        setThinkingLevel(config.thinkingLevel || 'low');

        const providerOpt = PROVIDERS.find((p) => p.value === loadedProvider);
        const isPredefined = providerOpt
          ? providerOpt.models.some((m) => m.value === loadedModel)
          : false;

        if (providerOpt && providerOpt.models.length > 0 && isPredefined) {
          setModel(loadedModel);
        } else if (providerOpt && providerOpt.models.length > 0 && !isPredefined && loadedModel) {
          setModel(CUSTOM_MODEL_VALUE);
          setCustomModelValue(loadedModel);
        } else {
          setModel(loadedModel);
        }
      }
      setHasLoaded(true);
    }).catch(() => setHasLoaded(true));
  }, []);

  const handleSave = useCallback(async () => {
    if (!window.settingsAPI) return;
    try {
      const result = await window.settingsAPI.saveConfig({
        provider, model: effectiveModel || 'gpt-4o', apiKey, thinkingLevel,
      });
      setSaveMessage(result.success ? 'Settings saved successfully' : (result.error || 'Failed to save'));
    } catch (err: unknown) {
      setSaveMessage(err instanceof Error ? err.message : 'Failed to save');
    }
    setTimeout(() => setSaveMessage(''), 3000);
  }, [provider, effectiveModel, apiKey, thinkingLevel]);

  const handleTest = useCallback(async () => {
    if (!window.settingsAPI || !apiKey.trim()) return;
    setConnectionStatus('testing');
    setConnectionMessage('Testing connection...');
    setSaveMessage('');
    try {
      const result = await window.settingsAPI.testConnection({
        provider, model: effectiveModel || 'gpt-4o', apiKey,
      });
      setConnectionStatus(result.success ? 'success' : 'error');
      setConnectionMessage(result.success ? 'Connection successful!' : (result.error || 'Connection failed'));
    } catch (err: unknown) {
      setConnectionStatus('error');
      setConnectionMessage(err instanceof Error ? err.message : 'Connection test failed');
    }
  }, [provider, effectiveModel, apiKey]);

  if (!hasLoaded) {
    return <div style={{ color: 'var(--text-tertiary)', textAlign: 'center', marginTop: 'var(--space-10)' }}>Loading...</div>;
  }

  return (
    <>
      <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--font-semibold)', marginBottom: 'var(--space-5)', color: 'var(--text-primary)' }}>
        LLM Configuration
      </div>

      <div style={sharedStyles.field}>
        <label style={sharedStyles.label}>Provider</label>
        <select value={provider} onChange={(e) => {
          const np = e.target.value;
          setProvider(np);
          setCustomModelValue('');
          setConnectionStatus('idle'); setSaveMessage('');
          const po = PROVIDERS.find((p) => p.value === np);
          setModel(po && po.models.length > 0 ? po.models[0].value : '');
        }} style={sharedStyles.select}>
          {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </div>

      <div style={sharedStyles.field}>
        <label style={sharedStyles.label}>Model</label>
        {currentProvider && currentProvider.models.length > 0 ? (
          <>
            <select value={model} onChange={(e) => { setModel(e.target.value); setConnectionStatus('idle'); setSaveMessage(''); }} style={sharedStyles.select}>
              {currentProvider.models.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              <option value={CUSTOM_MODEL_VALUE}>Custom...</option>
            </select>
            {isCustomModel && (
              <>
                <input type="text" value={customModelValue} onChange={(e) => { setCustomModelValue(e.target.value); setConnectionStatus('idle'); setSaveMessage(''); }}
                  placeholder="Enter custom model name" style={{ ...sharedStyles.input, marginTop: 'var(--space-2)' }} />
                <div style={sharedStyles.hint}>Enter any model name supported by {currentProvider.label}</div>
              </>
            )}
          </>
        ) : (
          <>
            <input type="text" value={model} onChange={(e) => { setModel(e.target.value); setConnectionStatus('idle'); setSaveMessage(''); }}
              placeholder="Enter model ID (e.g., openai/gpt-4o)" style={sharedStyles.input} />
            <div style={sharedStyles.hint}>Enter the OpenRouter model ID in provider/model format</div>
          </>
        )}
      </div>

      <div style={sharedStyles.field}>
        <label style={sharedStyles.label}>API Key</label>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <input type={showApiKey ? 'text' : 'password'} value={apiKey}
            onChange={(e) => { setApiKey(e.target.value); setConnectionStatus('idle'); setSaveMessage(''); }}
            placeholder="Enter your API key" style={{ ...sharedStyles.input, paddingRight: 60 }} />
          <button onClick={() => setShowApiKey((p) => !p)}
            style={{ position: 'absolute', right: 'var(--space-2)', background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: 'var(--space-1) var(--space-2)', display: 'flex', alignItems: 'center' }}>
            {showApiKey ? <EyeOff size={14} strokeWidth={1.5} /> : <Eye size={14} strokeWidth={1.5} />}
          </button>
        </div>
      </div>

      <div style={sharedStyles.field}>
        <label style={sharedStyles.label}>Thinking Level</label>
        <select value={thinkingLevel} onChange={(e) => { setThinkingLevel(e.target.value as ThinkingLevel); setSaveMessage(''); }} style={sharedStyles.select}>
          <option value="off">Off</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
        </select>
        <div style={sharedStyles.hint}>Controls how much the agent &quot;thinks&quot; before responding. Higher = better reasoning but slower.</div>
      </div>

      <div style={sharedStyles.btnRow}>
        <button onClick={handleSave} disabled={!isFormValid}
          style={{ ...sharedStyles.btn, ...sharedStyles.btnSave, opacity: isFormValid ? 1 : 0.4, cursor: isFormValid ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          <Save size={14} strokeWidth={1.5} style={{ color: '#fff' }} /> Save
        </button>
        <button onClick={handleTest} disabled={!isFormValid || connectionStatus === 'testing'}
          style={{ ...sharedStyles.btn, ...sharedStyles.btnTest, opacity: isFormValid && connectionStatus !== 'testing' ? 1 : 0.5, cursor: isFormValid && connectionStatus !== 'testing' ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          <Plug size={14} strokeWidth={1.5} style={{ color: '#fff' }} /> {connectionStatus === 'testing' ? 'Testing...' : 'Test Connection'}
        </button>
      </div>

      <StatusBlock status={connectionStatus} message={connectionMessage} />
      <SaveStatus message={saveMessage} />
    </>
  );
}

function BrowserSection() {
  const [browserConfig, setBrowserConfig] = useState<BrowserConfig>({ chromePath: '', cdpPort: 9222 });
  const [connStatus, setConnStatus] = useState<ConnectionStatus>('idle');
  const [connMessage, setConnMessage] = useState('');
  const [saveMessage, setSaveMessage] = useState('');

  useEffect(() => {
    window.settingsAPI?.loadBrowserConfig?.().then((cfg) => { if (cfg) setBrowserConfig(cfg); });
  }, []);

  const handleSave = useCallback(async () => {
    if (!window.settingsAPI) return;
    try {
      const result = await window.settingsAPI.saveBrowserConfig(browserConfig);
      setSaveMessage(result.success ? 'Browser settings saved' : (result.error || 'Failed to save'));
    } catch (err: unknown) {
      setSaveMessage(err instanceof Error ? err.message : 'Failed to save');
    }
    setTimeout(() => setSaveMessage(''), 3000);
  }, [browserConfig]);

  const handleTest = useCallback(async () => {
    if (!window.settingsAPI) return;
    setConnStatus('testing'); setConnMessage('Testing connection...'); setSaveMessage('');
    try {
      const result = await window.settingsAPI.testBrowserConnection(browserConfig);
      setConnStatus(result.success ? 'success' : 'error');
      setConnMessage(result.success
        ? (result.browserInfo ? `Connected: ${result.browserInfo}` : 'Connection successful!')
        : (result.error || 'Connection failed'));
    } catch (err: unknown) {
      setConnStatus('error');
      setConnMessage(err instanceof Error ? err.message : 'Connection test failed');
    }
  }, [browserConfig]);

  return (
    <>
      <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--font-semibold)', marginBottom: 'var(--space-5)', color: 'var(--text-primary)' }}>
        Browser
      </div>

      <div style={sharedStyles.field}>
        <label style={sharedStyles.label}>Chrome / Edge Path</label>
        <input type="text" value={browserConfig.chromePath}
          onChange={(e) => { setBrowserConfig((p) => ({ ...p, chromePath: e.target.value })); setConnStatus('idle'); setSaveMessage(''); }}
          placeholder="Auto-detect (leave empty)" style={sharedStyles.input} />
        <div style={sharedStyles.hint}>Leave empty to auto-detect Edge or Chrome on your system.</div>
      </div>

      <div style={sharedStyles.field}>
        <label style={sharedStyles.label}>CDP Port</label>
        <input type="number" min={1} max={65535} value={browserConfig.cdpPort}
          onChange={(e) => {
            const val = parseInt(e.target.value, 10);
            setBrowserConfig((p) => ({ ...p, cdpPort: (val >= 1 && val <= 65535) ? val : 9222 }));
            setConnStatus('idle'); setSaveMessage('');
          }}
          placeholder="9222" style={{ ...sharedStyles.input, width: 120 }} />
        <div style={sharedStyles.hint}>Chrome must be running with --remote-debugging-port={'<port>'} for CDP to work.</div>
      </div>

      <div style={sharedStyles.btnRow}>
        <button onClick={handleSave} style={{ ...sharedStyles.btn, ...sharedStyles.btnSave, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}><Save size={14} strokeWidth={1.5} style={{ color: '#fff' }} /> Save</button>
        <button onClick={handleTest} disabled={connStatus === 'testing'}
          style={{ ...sharedStyles.btn, ...sharedStyles.btnTest, opacity: connStatus === 'testing' ? 0.5 : 1, cursor: connStatus === 'testing' ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          <Plug size={14} strokeWidth={1.5} style={{ color: '#fff' }} /> {connStatus === 'testing' ? 'Testing...' : 'Test Connection'}
        </button>
      </div>

      <StatusBlock status={connStatus} message={connMessage} />
      <SaveStatus message={saveMessage} />
    </>
  );
}

function NotificationsSection() {
  const [notifConfig, setNotifConfig] = useState<NotificationConfig>({ systemToast: true, petBubble: true, petAnimation: true });
  const [saveMessage, setSaveMessage] = useState('');

  useEffect(() => {
    window.settingsAPI?.loadNotificationConfig?.().then((cfg) => { if (cfg) setNotifConfig(cfg); });
  }, []);

  const toggle = useCallback((key: keyof NotificationConfig) => {
    setNotifConfig((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      window.settingsAPI?.saveNotificationConfig?.(next).then((r) => {
        setSaveMessage(r?.success ? 'Notification settings saved' : (r?.error || 'Failed to save'));
        setTimeout(() => setSaveMessage(''), 2000);
      });
      return next;
    });
  }, []);

  const allOff = !notifConfig.systemToast && !notifConfig.petBubble && !notifConfig.petAnimation;

  return (
    <>
      <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--font-semibold)', marginBottom: 'var(--space-5)', color: 'var(--text-primary)' }}>
        Notifications
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {[
          { key: 'systemToast' as const, label: 'System Toast', hint: 'Windows notification when task completes' },
          { key: 'petBubble' as const, label: 'Pet Bubble', hint: 'Show result summary above the pet' },
          { key: 'petAnimation' as const, label: 'Pet Animation', hint: 'Play success/failure animation on the pet' },
        ].map(({ key, label, hint }) => (
          <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', cursor: 'pointer' }}>
            <input type="checkbox" checked={notifConfig[key]} onChange={() => toggle(key)}
              style={{ width: 'var(--space-4)', height: 'var(--space-4)', cursor: 'pointer' }} />
            <div>
              <div style={{ fontSize: 'var(--text-base)', color: 'var(--text-primary)' }}>{label}</div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{hint}</div>
            </div>
          </label>
        ))}
      </div>

      {allOff && (
        <div style={{ marginTop: 'var(--space-3)', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-sm)', background: 'var(--warning-bg)', color: 'var(--warning)', fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <AlertTriangle size={14} strokeWidth={1.5} /> All notifications are off — you won&apos;t be reminded when tasks complete.
        </div>
      )}

      {saveMessage && (
        <div style={{ marginTop: 'var(--space-2)', fontSize: 'var(--text-sm)', color: saveMessage.includes('Failed') ? 'var(--danger)' : 'var(--success)' }}>
          {saveMessage}
        </div>
      )}
    </>
  );
}

function PermissionsSection() {
  const [riskLevel, setRiskLevel] = useState<RiskLevel>('medium');
  const [saveMessage, setSaveMessage] = useState('');

  useEffect(() => {
    window.settingsAPI?.loadRiskLevel?.().then((level) => { if (level) setRiskLevel(level); });
  }, []);

  const handleChange = useCallback((level: RiskLevel) => {
    setRiskLevel(level);
    setSaveMessage('');
    window.settingsAPI?.saveRiskLevel?.(level).then((r) => {
      setSaveMessage(r?.success ? 'Permission settings saved' : (r?.error || 'Failed to save'));
      setTimeout(() => setSaveMessage(''), 2000);
    });
  }, []);

  const options: { value: RiskLevel; label: string; color: string; hint: string; description: string }[] = [
    {
      value: 'low',
      label: 'Low Risk',
      color: 'var(--success)',
      hint: 'All tools require confirmation',
      description: 'Every tool call (including read-only operations) will ask for your approval before executing. Safest mode, suitable for first-time users or sensitive environments.',
    },
    {
      value: 'medium',
      label: 'Medium Risk',
      color: 'var(--warning)',
      hint: 'Critical tools require confirmation',
      description: 'Read-only tools execute automatically. Write, edit, bash, and browser operations still require your approval. Balanced mode for daily use.',
    },
    {
      value: 'high',
      label: 'High Risk',
      color: 'var(--danger)',
      hint: 'No confirmation needed',
      description: 'All tools execute automatically without any confirmation. Most autonomous mode, suitable when you trust the agent to act independently.',
    },
  ];

  return (
    <>
      <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--font-semibold)', marginBottom: 'var(--space-5)', color: 'var(--text-primary)' }}>
        Permissions
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {options.map((opt) => {
          const selected = riskLevel === opt.value;
          return (
            <div
              key={opt.value}
              onClick={() => handleChange(opt.value)}
              style={{
                padding: 'var(--space-4) var(--space-4)',
                borderRadius: 'var(--radius-nav)',
                border: `1.5px solid ${selected ? opt.color : 'var(--border-subtle)'}`,
                background: selected ? `${opt.color}12` : 'var(--bg-elevated)',
                cursor: 'pointer',
                transition: 'all var(--duration-fast)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
                <div style={{
                  width: 'var(--space-3)', height: 'var(--space-3)', borderRadius: 'var(--radius-sm)',
                  border: `2px solid ${selected ? opt.color : 'var(--border)'}`,
                  background: selected ? opt.color : 'transparent',
                  transition: 'all var(--duration-fast)',
                  flexShrink: 0,
                }} />
                <span style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--font-semibold)', color: selected ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                  {opt.label}
                </span>
                <span style={{ fontSize: 'var(--text-xs)', color: `${opt.color}bb`, marginLeft: 'auto' }}>
                  {opt.hint}
                </span>
              </div>
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', paddingLeft: 'var(--space-6)', lineHeight: 'var(--leading-relaxed)' }}>
                {opt.description}
              </div>
            </div>
          );
        })}
      </div>

      {riskLevel === 'high' && (
        <div style={{ marginTop: 'var(--space-3)', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-sm)', background: 'var(--danger-bg)', color: 'var(--danger)', fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <AlertTriangle size={14} strokeWidth={1.5} /> Warning: High risk mode allows the agent to execute all operations without confirmation, including file deletion and shell commands.
        </div>
      )}

      {saveMessage && (
        <div style={{ marginTop: 'var(--space-2)', fontSize: 'var(--text-sm)', color: saveMessage.includes('Failed') ? 'var(--danger)' : 'var(--success)' }}>
          {saveMessage}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Profiles Section — Pet profile management
// ---------------------------------------------------------------------------

const BUILT_IN_IDS = new Set(['chief', 'coder', 'scout', 'analyst']);

/** All available tools across all groups */
const ALL_TOOLS = Object.values(TOOL_GROUPS).flatMap((g) => g.tools);

/** Check if a tool belongs to any group */
function toolHasGroup(tool: string): boolean {
  return ALL_TOOLS.includes(tool);
}

const REMOTE_ROLE_COLOR = '#06b6d4'; // Cyan

function ProfilesSection() {
  const [profiles, setProfiles] = useState<PetProfile[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  // Remote agent creation state
  const [showRemoteForm, setShowRemoteForm] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState('');
  const [remoteApiKey, setRemoteApiKey] = useState('');
  const [remoteFetchStatus, setRemoteFetchStatus] = useState<ConnectionStatus>('idle');
  const [remoteFetchMessage, setRemoteFetchMessage] = useState('');
  const [remoteCard, setRemoteCard] = useState<AgentCardInfo | null>(null);

  useEffect(() => {
    window.settingsAPI?.loadProfiles?.().then((p) => {
      setProfiles(p ?? []);
      setHasLoaded(true);
    }).catch(() => setHasLoaded(true));
  }, []);

  const saveAll = useCallback(async (updated: PetProfile[]) => {
    if (!window.settingsAPI) return;
    try {
      const result = await window.settingsAPI.saveProfiles(updated);
      setProfiles(updated);
      setSaveMessage(result.success ? '配置已保存' : (result.error || '保存失败'));
    } catch (err: unknown) {
      setSaveMessage(err instanceof Error ? err.message : '保存失败');
    }
    setTimeout(() => setSaveMessage(''), 3000);
  }, []);

  const handleReset = useCallback(async () => {
    if (!window.settingsAPI) return;
    const result = await window.settingsAPI.resetProfiles();
    if (result.success) {
      setProfiles([]);
      setEditingId(null);
      setSaveMessage('已恢复默认配置');
    } else {
      setSaveMessage(result.error || '恢复失败');
    }
    setTimeout(() => setSaveMessage(''), 3000);
  }, []);

  const toggleEnabled = useCallback((id: string) => {
    const updated = profiles.map((p) =>
      p.id === id ? { ...p, enabled: p.enabled === false ? undefined : false as boolean | undefined } : p
    );
    saveAll(updated);
  }, [profiles, saveAll]);

  const updateProfile = useCallback((id: string, changes: Partial<PetProfile>) => {
    setProfiles((prev) => prev.map((p) => p.id === id ? { ...p, ...changes } : p));
  }, []);

  const saveProfile = useCallback((id: string) => {
    const profile = profiles.find((p) => p.id === id);
    if (!profile) return;
    const entry: PetProfile = { ...profile };
    const existing = profiles.findIndex((p) => p.id === id);
    let updated: PetProfile[];
    if (existing >= 0) {
      updated = [...profiles];
      updated[existing] = entry;
    } else {
      updated = [...profiles, entry];
    }
    saveAll(updated);
    setEditingId(null);
  }, [profiles, saveAll]);

  const createProfile = useCallback(() => {
    const id = `custom-${Date.now()}`;
    const newProfile: PetProfile = {
      id,
      name: 'New Pet',
      role: 'custom' as PetRole,
      systemPrompt: CUSTOM_PROFILE_DEFAULT_PROMPT.replace('{name}', 'New Pet'),
      toolNames: [...CUSTOM_PROFILE_DEFAULT_TOOLS],
      enabled: true,
      icon: 'clawd-idle.gif',
      gifPrefix: 'clawd',
    };
    saveAll([...profiles, newProfile]);
    setEditingId(id);
  }, [profiles, saveAll]);

  const deleteProfile = useCallback((id: string) => {
    const updated = profiles.filter((p) => p.id !== id);
    saveAll(updated);
    setConfirmDeleteId(null);
    if (editingId === id) setEditingId(null);
  }, [profiles, saveAll, editingId]);

  // Fetch AgentCard from remote URL
  const handleFetchAgentCard = useCallback(async () => {
    if (!remoteUrl.trim()) return;
    setRemoteFetchStatus('testing');
    setRemoteFetchMessage('正在连接远程 agent...');
    setRemoteCard(null);
    try {
      const cardUrl = remoteUrl.trim().replace(/\/+$/, '') + '/.well-known/agent-card.json';
      const resp = await fetch(cardUrl, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      const card = await resp.json();
      const info: AgentCardInfo = {
        name: card.name ?? 'Unknown Agent',
        description: card.description ?? undefined,
        url: card.url ?? remoteUrl.trim(),
        skills: card.skills?.map((s: { id: string; name: string; description?: string }) => ({
          id: s.id, name: s.name, description: s.description,
        })),
        authentication: card.authentication ? { schemes: card.authentication.schemes ?? [] } : undefined,
      };
      setRemoteCard(info);
      setRemoteFetchStatus('success');
      setRemoteFetchMessage(`已连接：${info.name}`);
    } catch (err) {
      setRemoteFetchStatus('error');
      setRemoteFetchMessage(err instanceof Error ? err.message : '连接失败');
    }
  }, [remoteUrl]);

  // Save remote agent profile
  const handleSaveRemote = useCallback(() => {
    if (!remoteCard) return;
    const id = `remote-${Date.now()}`;
    const newProfile: PetProfile = {
      id,
      name: remoteCard.name,
      role: 'remote' as PetRole,
      systemPrompt: '',
      toolNames: [],
      enabled: true,
      icon: 'clawd-idle.gif',
      gifPrefix: 'clawd',
      a2a: {
        url: remoteUrl.trim().replace(/\/+$/, ''),
        apiKey: remoteApiKey.trim() || undefined,
        agentCard: remoteCard,
      },
    };
    saveAll([...profiles, newProfile]);
    setShowRemoteForm(false);
    setRemoteUrl('');
    setRemoteApiKey('');
    setRemoteCard(null);
    setRemoteFetchStatus('idle');
    setRemoteFetchMessage('');
  }, [remoteCard, remoteUrl, remoteApiKey, profiles, saveAll]);

  // Refresh AgentCard for existing remote agent
  const handleRefreshAgentCard = useCallback(async (id: string) => {
    const profile = profiles.find((p) => p.id === id);
    if (!profile?.a2a?.url) return;
    try {
      const cardUrl = profile.a2a.url.replace(/\/+$/, '') + '/.well-known/agent-card.json';
      const resp = await fetch(cardUrl, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const card = await resp.json();
      const info: AgentCardInfo = {
        name: card.name ?? profile.name,
        description: card.description ?? undefined,
        url: card.url ?? profile.a2a.url,
        skills: card.skills?.map((s: { id: string; name: string; description?: string }) => ({
          id: s.id, name: s.name, description: s.description,
        })),
        authentication: card.authentication ? { schemes: card.authentication.schemes ?? [] } : undefined,
      };
      updateProfile(id, { a2a: { ...profile.a2a, agentCard: info } });
      setSaveMessage(`AgentCard 已刷新：${info.name}`);
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (err) {
      setSaveMessage(`刷新失败：${err instanceof Error ? err.message : '未知错误'}`);
      setTimeout(() => setSaveMessage(''), 3000);
    }
  }, [profiles, updateProfile]);

  if (!hasLoaded) {
    return <div style={{ color: 'var(--text-tertiary)', textAlign: 'center', marginTop: 'var(--space-10)' }}>Loading...</div>;
  }

  const roleColors: Record<string, string> = {
    chief: 'var(--role-chief)', coder: 'var(--role-coder)', scout: 'var(--role-scout)',
    analyst: 'var(--role-analyst)', custom: 'var(--role-custom)', remote: REMOTE_ROLE_COLOR,
  };

  return (
    <>
      <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--font-semibold)', marginBottom: 'var(--space-5)', color: 'var(--text-primary)' }}>
        Pet Profiles
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        {profiles.map((p) => {
          const isBuiltIn = BUILT_IN_IDS.has(p.id);
          const isRemote = p.role === 'remote';
          const isDisabled = p.enabled === false;
          const isEditing = editingId === p.id;
          const color = roleColors[p.role] ?? 'var(--role-custom)';

          return (
            <div key={p.id} style={{
              padding: 'var(--space-3) var(--space-4)',
              borderRadius: 'var(--radius-nav)',
              border: `1.5px solid ${isEditing ? color : isDisabled ? 'var(--border-subtle)' : 'var(--border-subtle)'}`,
              background: isDisabled ? 'var(--bg-elevated)' : isEditing ? `${color}0d` : 'var(--bg-elevated)',
              opacity: isDisabled ? 0.5 : 1,
              transition: 'all var(--duration-fast)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <div style={{ width: 'var(--space-3)', height: 'var(--space-3)', borderRadius: 'var(--space-1)', background: color, flexShrink: 0 }} />
                <span style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--font-semibold)', color: 'var(--text-primary)', flex: 1 }}>
                  {p.name}
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginLeft: 'var(--space-2)' }}>
                    {isRemote ? '远程' : p.role}{isBuiltIn ? ' (内置)' : ''}
                  </span>
                </span>
                {isRemote && (
                  <button onClick={() => handleRefreshAgentCard(p.id)} title="刷新 AgentCard" style={{
                    background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer',
                    padding: 'var(--space-1) var(--space-2)', display: 'flex', alignItems: 'center',
                  }}>
                    <RefreshCw size={12} strokeWidth={1.5} />
                  </button>
                )}
                {!isBuiltIn && p.role !== 'chief' && (
                  <button onClick={() => setConfirmDeleteId(p.id)} style={{
                    background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer',
                    fontSize: 'var(--text-xs)', padding: 'var(--space-1) var(--space-2)', opacity: 0.6,
                    display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
                  }}><Trash2 size={12} strokeWidth={1.5} /> 删除</button>
                )}
                {p.role !== 'chief' && (
                  <button onClick={() => toggleEnabled(p.id)} style={{
                    background: 'none', border: 'none', color: isDisabled ? 'var(--success)' : 'var(--danger)',
                    cursor: 'pointer', fontSize: 'var(--text-xs)', padding: 'var(--space-1) var(--space-2)',
                  }}>
                    {isDisabled ? '启用' : '禁用'}
                  </button>
                )}
                <button onClick={() => setEditingId(isEditing ? null : p.id)} style={{
                  background: 'none', border: 'none', color: 'var(--role-coder)', cursor: 'pointer',
                  fontSize: 'var(--text-xs)', padding: 'var(--space-1) var(--space-2)',
                }}>
                  {isEditing ? '关闭' : '编辑'}
                </button>
              </div>

              {/* Remote agent card info */}
              {isRemote && p.a2a?.agentCard && !isEditing && (
                <div style={{ marginTop: 'var(--space-2)', paddingLeft: 'var(--space-6)', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                    <Link size={10} strokeWidth={1.5} /> {p.a2a.url}
                  </div>
                  {p.a2a.agentCard.description && (
                    <div style={{ marginTop: 'var(--space-1)' }}>{p.a2a.agentCard.description}</div>
                  )}
                </div>
              )}

              {isEditing && (
                <div style={{ marginTop: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  {isRemote ? (
                    <>
                      {/* Remote agent edit form */}
                      <div style={sharedStyles.field}>
                        <label style={sharedStyles.label}>Agent URL</label>
                        <input type="text" value={p.a2a?.url ?? ''}
                          onChange={(e) => updateProfile(p.id, { a2a: { ...p.a2a!, url: e.target.value } })}
                          style={sharedStyles.input} placeholder="https://agent.example.com" />
                      </div>
                      <div style={sharedStyles.field}>
                        <label style={sharedStyles.label}>API Key（可选）</label>
                        <input type="password" value={p.a2a?.apiKey ?? ''}
                          onChange={(e) => updateProfile(p.id, { a2a: { ...p.a2a!, apiKey: e.target.value || undefined } })}
                          style={sharedStyles.input} placeholder="Bearer token" />
                      </div>
                      <div style={sharedStyles.field}>
                        <label style={sharedStyles.label}>名称</label>
                        <input type="text" value={p.name}
                          onChange={(e) => updateProfile(p.id, { name: e.target.value })}
                          style={sharedStyles.input} />
                      </div>
                      <div style={sharedStyles.field}>
                        <label style={sharedStyles.label}>超时时间（秒）</label>
                        <input type="number" min={10} max={600} value={Math.round((p.a2a?.timeoutMs ?? 180000) / 1000)}
                          onChange={(e) => updateProfile(p.id, { a2a: { ...p.a2a!, timeoutMs: Math.max(10, parseInt(e.target.value, 10) || 180) * 1000 } })}
                          style={{ ...sharedStyles.input, width: 120 }} />
                        <div style={sharedStyles.hint}>等待远程 agent 响应的最长时间（默认 180 秒）。</div>
                      </div>
                    </>
                  ) : (
                    <>
                      {/* Local agent edit form */}
                      <div style={sharedStyles.field}>
                        <label style={sharedStyles.label}>名称</label>
                        <input type="text" value={p.name}
                          onChange={(e) => updateProfile(p.id, { name: e.target.value })}
                          style={sharedStyles.input} />
                      </div>
                      <div style={sharedStyles.field}>
                        <label style={sharedStyles.label}>系统提示词</label>
                        <textarea value={p.systemPrompt}
                          onChange={(e) => updateProfile(p.id, { systemPrompt: e.target.value })}
                          style={{ ...sharedStyles.input, minHeight: 120, resize: 'vertical', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}
                        />
                      </div>
                      <div style={sharedStyles.field}>
                        <label style={sharedStyles.label}>GIF 前缀</label>
                        <input type="text" value={p.gifPrefix ?? 'clawd'}
                          onChange={(e) => updateProfile(p.id, { gifPrefix: e.target.value })}
                          style={{ ...sharedStyles.input, width: 200 }}
                        />
                        <div style={sharedStyles.hint}>决定宠物使用哪套 GIF 动画。</div>
                      </div>
                      <div style={sharedStyles.field}>
                        <label style={sharedStyles.label}>工具</label>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                          {Object.entries(TOOL_GROUPS).map(([groupKey, group]) => (
                            <div key={groupKey}>
                              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)', color: 'var(--text-secondary)', marginBottom: 'var(--space-1)' }}>
                                {group.label}
                              </div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                                {group.tools.map((tool) => {
                                  const checked = p.toolNames.includes(tool);
                                  return (
                                    <label key={tool} style={{
                                      display: 'flex', alignItems: 'center', gap: 'var(--space-1)', cursor: 'pointer',
                                      padding: 'var(--space-1) var(--space-2)', borderRadius: 'var(--radius-sm)',
                                      background: checked ? 'var(--success-bg)' : 'var(--border-subtle)',
                                      border: `1px solid ${checked ? 'var(--success)' : 'var(--border-subtle)'}`,
                                      fontSize: 'var(--text-sm)', color: checked ? 'var(--success)' : 'var(--text-tertiary)',
                                    }}>
                                      <input type="checkbox" checked={checked}
                                        onChange={() => {
                                          const newTools = checked
                                            ? p.toolNames.filter((t) => t !== tool)
                                            : [...p.toolNames, tool];
                                          updateProfile(p.id, { toolNames: newTools });
                                        }}
                                        style={{ width: 'var(--space-3)', height: 'var(--space-3)' }}
                                      />
                                      {tool}
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  <div style={sharedStyles.btnRow}>
                    <button onClick={() => saveProfile(p.id)} style={{ ...sharedStyles.btn, ...sharedStyles.btnSave, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                      <Save size={14} strokeWidth={1.5} style={{ color: '#fff' }} /> 保存
                    </button>
                    <button onClick={() => setEditingId(null)} style={{ ...sharedStyles.btn, background: 'var(--border)', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                      <X size={14} strokeWidth={1.5} /> 取消
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Add Remote Agent form */}
        {showRemoteForm && (
          <div style={{
            padding: 'var(--space-4)', borderRadius: 'var(--radius-nav)',
            border: `1.5px solid ${REMOTE_ROLE_COLOR}40`, background: `${REMOTE_ROLE_COLOR}08`,
          }}>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)', color: 'var(--text-primary)', marginBottom: 'var(--space-3)' }}>
              添加远程 Agent
            </div>
            <div style={sharedStyles.field}>
              <label style={sharedStyles.label}>Agent URL</label>
              <input type="text" value={remoteUrl}
                onChange={(e) => { setRemoteUrl(e.target.value); setRemoteCard(null); setRemoteFetchStatus('idle'); }}
                style={sharedStyles.input} placeholder="https://agent.example.com" />
              <div style={sharedStyles.hint}>输入 A2A 兼容 agent 的基础 URL。</div>
            </div>
            <div style={sharedStyles.field}>
              <label style={sharedStyles.label}>API Key（可选）</label>
              <input type="password" value={remoteApiKey}
                onChange={(e) => setRemoteApiKey(e.target.value)}
                style={sharedStyles.input} placeholder="如需认证请填写 Bearer token" />
            </div>
            <div style={{ ...sharedStyles.btnRow, marginTop: 'var(--space-3)' }}>
              <button onClick={handleFetchAgentCard} disabled={!remoteUrl.trim() || remoteFetchStatus === 'testing'}
                style={{
                  ...sharedStyles.btn, background: REMOTE_ROLE_COLOR, color: '#fff',
                  opacity: remoteUrl.trim() && remoteFetchStatus !== 'testing' ? 1 : 0.5,
                  cursor: remoteUrl.trim() && remoteFetchStatus !== 'testing' ? 'pointer' : 'not-allowed',
                  display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
                }}>
                <Wifi size={14} strokeWidth={1.5} style={{ color: '#fff' }} />
                {remoteFetchStatus === 'testing' ? '连接中...' : '连接'}
              </button>
              <button onClick={() => { setShowRemoteForm(false); setRemoteUrl(''); setRemoteApiKey(''); setRemoteCard(null); setRemoteFetchStatus('idle'); }}
                style={{ ...sharedStyles.btn, background: 'var(--border)', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                <X size={14} strokeWidth={1.5} /> 取消
              </button>
            </div>

            <StatusBlock status={remoteFetchStatus} message={remoteFetchMessage} />

            {remoteCard && (
              <div style={{ marginTop: 'var(--space-3)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-elevated)', border: `1px solid var(--border-subtle)` }}>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)', color: 'var(--text-primary)' }}>{remoteCard.name}</div>
                {remoteCard.description && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 'var(--space-1)' }}>{remoteCard.description}</div>}
                {remoteCard.skills && remoteCard.skills.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)', marginTop: 'var(--space-2)' }}>
                    {remoteCard.skills.map((s) => (
                      <span key={s.id} style={{ fontSize: 'var(--text-xs)', padding: '2px 6px', borderRadius: 'var(--radius-sm)', background: `${REMOTE_ROLE_COLOR}15`, color: REMOTE_ROLE_COLOR }}>
                        {s.name}
                      </span>
                    ))}
                  </div>
                )}
                <button onClick={handleSaveRemote} style={{
                  ...sharedStyles.btn, ...sharedStyles.btnSave, marginTop: 'var(--space-3)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
                }}>
                  <Save size={14} strokeWidth={1.5} style={{ color: '#fff' }} /> 加入团队
                </button>
              </div>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button onClick={createProfile} style={{
            flex: 1, padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-nav)', border: `1.5px dashed var(--border)`,
            background: 'transparent', color: 'var(--text-tertiary)', cursor: 'pointer',
            fontSize: 'var(--text-xs)', fontWeight: 'var(--font-medium)', textAlign: 'center',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)',
          }}>
            <Plus size={14} strokeWidth={1.5} /> 自定义配置
          </button>
          <button onClick={() => { setShowRemoteForm(true); setRemoteCard(null); setRemoteFetchStatus('idle'); }} style={{
            flex: 1, padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-nav)', border: `1.5px dashed ${REMOTE_ROLE_COLOR}50`,
            background: 'transparent', color: REMOTE_ROLE_COLOR, cursor: 'pointer',
            fontSize: 'var(--text-xs)', fontWeight: 'var(--font-medium)', textAlign: 'center',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)',
          }}>
            <Wifi size={14} strokeWidth={1.5} /> 远程 Agent
          </button>
        </div>
      </div>

      <div style={sharedStyles.btnRow}>
        <button onClick={handleReset} style={{
          ...sharedStyles.btn, background: 'var(--border)', color: 'var(--text-secondary)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
        }}>
          <RotateCcw size={14} strokeWidth={1.5} /> 恢复默认
        </button>
      </div>

      <SaveStatus message={saveMessage} />

      {/* Delete confirmation dialog */}
      {confirmDeleteId && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-6)', maxWidth: 360,
            border: `1px solid var(--border)`,
          }}>
            <div style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--font-semibold)', color: 'var(--text-primary)', marginBottom: 'var(--space-3)' }}>
              删除配置？
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginBottom: 'var(--space-5)' }}>
              此操作将永久删除该配置，无法撤销。
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmDeleteId(null)} style={{
                ...sharedStyles.btn, background: 'var(--border)', color: 'var(--text-secondary)', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
              }}>
                <X size={14} strokeWidth={1.5} /> 取消
              </button>
              <button onClick={() => deleteProfile(confirmDeleteId)} style={{
                ...sharedStyles.btn, background: 'var(--danger)', color: '#fff', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
              }}>
                <Trash2 size={14} strokeWidth={1.5} style={{ color: '#fff' }} /> 删除
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main settings window with sidebar navigation
// ---------------------------------------------------------------------------

export const SettingsWindow: React.FC = () => {
  const [section, setSection] = useState<Section>('llm');

  const navItems: { key: Section; label: string; icon: React.ReactNode }[] = [
    { key: 'llm', label: 'LLM', icon: <Cpu size={16} strokeWidth={1.5} /> },
    { key: 'browser', label: 'Browser', icon: <Globe size={16} strokeWidth={1.5} /> },
    { key: 'notifications', label: 'Notifications', icon: <Bell size={16} strokeWidth={1.5} /> },
    { key: 'permissions', label: 'Permissions', icon: <Shield size={16} strokeWidth={1.5} /> },
    { key: 'pets', label: 'Pets', icon: <Bot size={16} strokeWidth={1.5} /> },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar */}
        <div style={{
          width: 160, // fixed sidebar width per design spec
          background: 'var(--bg-sidebar)',
          borderRight: `1px solid var(--border-subtle)`,
          padding: 'var(--space-4) 0',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
        }}>
          {navItems.map((item) => (
            <div
              key={item.key}
              onClick={() => setSection(item.key)}
              style={{
                padding: 'var(--space-3) var(--space-5)',
                fontSize: 'var(--text-xs)',
                fontWeight: 'var(--font-medium)',
                cursor: 'pointer',
                borderLeft: '2px solid transparent',
                color: section === item.key ? 'var(--text-primary)' : 'var(--text-tertiary)',
                borderLeftColor: section === item.key ? 'var(--success)' : 'transparent',
                background: section === item.key ? 'var(--nav-active)' : 'transparent',
                transition: 'all var(--duration-fast)',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
              }}
              onMouseEnter={(e) => {
                if (section !== item.key) {
                  (e.currentTarget as HTMLDivElement).style.background = 'var(--nav-hover)';
                  (e.currentTarget as HTMLDivElement).style.color = 'var(--text-secondary)';
                }
              }}
              onMouseLeave={(e) => {
                if (section !== item.key) {
                  (e.currentTarget as HTMLDivElement).style.background = 'transparent';
                  (e.currentTarget as HTMLDivElement).style.color = 'var(--text-tertiary)';
                }
              }}
            >
              {item.icon}
              {item.label}
            </div>
          ))}
        </div>

        {/* Content area */}
        <div style={{ flex: 1, padding: 'var(--space-6) var(--space-8)', overflowY: 'auto' }}>
          {section === 'llm' && <LLMSection />}
          {section === 'browser' && <BrowserSection />}
          {section === 'notifications' && <NotificationsSection />}
          {section === 'permissions' && <PermissionsSection />}
          {section === 'pets' && <ProfilesSection />}
        </div>
      </div>

      {/* Footer */}
      <div style={{
        padding: 'var(--space-3) var(--space-8)',
        borderTop: `1px solid var(--border-subtle)`,
        fontSize: 'var(--text-xs)',
        color: 'var(--text-tertiary)',
      }}>
        Your API key is stored locally on this device and never sent to our servers.
      </div>
    </div>
  );
};
