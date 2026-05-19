import React, { useState, useEffect, useCallback } from 'react';
import type { LLMConfig, NotificationConfig, BrowserConfig, RiskLevel, ThinkingLevel } from '../../shared/types';

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
type Section = 'llm' | 'browser' | 'notifications' | 'permissions';

const sharedStyles: Record<string, React.CSSProperties> = {
  label: {
    display: 'block',
    fontSize: 11,
    fontWeight: 500,
    color: 'rgba(200, 200, 210, 0.8)',
    marginBottom: 6,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    background: 'rgba(40, 42, 48, 0.9)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: 8,
    color: '#F0F1F2',
    fontSize: 14,
    fontFamily: 'inherit',
    outline: 'none',
  },
  select: {
    width: '100%',
    padding: '10px 12px',
    background: 'rgba(40, 42, 48, 0.9)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: 8,
    color: '#F0F1F2',
    fontSize: 14,
    fontFamily: 'inherit',
    outline: 'none',
    cursor: 'pointer',
    appearance: 'none' as const,
    WebkitAppearance: 'none' as const,
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%23aaa' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10z'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 12px center',
    paddingRight: 32,
  },
  hint: {
    fontSize: 11,
    color: 'rgba(200, 200, 210, 0.5)',
    marginTop: 4,
  },
  field: {
    marginBottom: 16,
  },
  btnRow: {
    display: 'flex',
    gap: 12,
    marginTop: 24,
  },
  btn: {
    padding: '10px 24px',
    border: 'none',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'opacity 0.15s ease',
  },
  btnSave: {
    background: 'rgba(80, 180, 120, 0.9)',
    color: '#fff',
  },
  btnTest: {
    background: 'rgba(60, 120, 200, 0.8)',
    color: '#fff',
  },
  statusMsg: {
    marginTop: 12,
    fontSize: 13,
    padding: '8px 12px',
    borderRadius: 6,
  },
  successMsg: {
    color: '#5cb85c',
    background: 'rgba(92, 184, 92, 0.1)',
  },
  errorMsg: {
    color: '#d9534f',
    background: 'rgba(217, 83, 79, 0.1)',
  },
  infoMsg: {
    color: '#f0ad4e',
    background: 'rgba(240, 173, 78, 0.1)',
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
      ...(message.includes('Failed') ? sharedStyles.errorMsg : sharedStyles.successMsg),
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
    return <div style={{ color: 'rgba(200,200,210,0.6)', textAlign: 'center', marginTop: 40 }}>Loading...</div>;
  }

  return (
    <>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 20, color: '#F0F1F2' }}>
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
                  placeholder="Enter custom model name" style={{ ...sharedStyles.input, marginTop: 8 }} />
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
            style={{ position: 'absolute', right: 8, background: 'none', border: 'none', color: 'rgba(200,200,210,0.6)', cursor: 'pointer', padding: '4px 8px', fontSize: 12 }}>
            {showApiKey ? 'Hide' : 'Show'}
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
          style={{ ...sharedStyles.btn, ...sharedStyles.btnSave, opacity: isFormValid ? 1 : 0.4, cursor: isFormValid ? 'pointer' : 'not-allowed' }}>
          Save
        </button>
        <button onClick={handleTest} disabled={!isFormValid || connectionStatus === 'testing'}
          style={{ ...sharedStyles.btn, ...sharedStyles.btnTest, opacity: isFormValid && connectionStatus !== 'testing' ? 1 : 0.5, cursor: isFormValid && connectionStatus !== 'testing' ? 'pointer' : 'not-allowed' }}>
          {connectionStatus === 'testing' ? 'Testing...' : 'Test Connection'}
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
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 20, color: '#F0F1F2' }}>
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
        <button onClick={handleSave} style={{ ...sharedStyles.btn, ...sharedStyles.btnSave, cursor: 'pointer' }}>Save</button>
        <button onClick={handleTest} disabled={connStatus === 'testing'}
          style={{ ...sharedStyles.btn, ...sharedStyles.btnTest, opacity: connStatus === 'testing' ? 0.5 : 1, cursor: connStatus === 'testing' ? 'not-allowed' : 'pointer' }}>
          {connStatus === 'testing' ? 'Testing...' : 'Test Connection'}
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
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 20, color: '#F0F1F2' }}>
        Notifications
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {[
          { key: 'systemToast' as const, label: 'System Toast', hint: 'Windows notification when task completes' },
          { key: 'petBubble' as const, label: 'Pet Bubble', hint: 'Show result summary above the pet' },
          { key: 'petAnimation' as const, label: 'Pet Animation', hint: 'Play success/failure animation on the pet' },
        ].map(({ key, label, hint }) => (
          <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={notifConfig[key]} onChange={() => toggle(key)}
              style={{ width: 16, height: 16, cursor: 'pointer' }} />
            <div>
              <div style={{ fontSize: 14, color: '#F0F1F2' }}>{label}</div>
              <div style={{ fontSize: 11, color: 'rgba(200,200,210,0.5)' }}>{hint}</div>
            </div>
          </label>
        ))}
      </div>

      {allOff && (
        <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 6, background: 'rgba(240,173,78,0.1)', color: '#f0ad4e', fontSize: 12 }}>
          All notifications are off — you won&apos;t be reminded when tasks complete.
        </div>
      )}

      {saveMessage && (
        <div style={{ marginTop: 8, fontSize: 12, color: saveMessage.includes('Failed') ? '#d9534f' : '#5cb85c' }}>
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
      color: '#5cb85c',
      hint: 'All tools require confirmation',
      description: 'Every tool call (including read-only operations) will ask for your approval before executing. Safest mode, suitable for first-time users or sensitive environments.',
    },
    {
      value: 'medium',
      label: 'Medium Risk',
      color: '#f0ad4e',
      hint: 'Critical tools require confirmation',
      description: 'Read-only tools execute automatically. Write, edit, bash, and browser operations still require your approval. Balanced mode for daily use.',
    },
    {
      value: 'high',
      label: 'High Risk',
      color: '#d9534f',
      hint: 'No confirmation needed',
      description: 'All tools execute automatically without any confirmation. Most autonomous mode, suitable when you trust the agent to act independently.',
    },
  ];

  return (
    <>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 20, color: '#F0F1F2' }}>
        Permissions
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {options.map((opt) => {
          const selected = riskLevel === opt.value;
          return (
            <div
              key={opt.value}
              onClick={() => handleChange(opt.value)}
              style={{
                padding: '14px 16px',
                borderRadius: 10,
                border: `1.5px solid ${selected ? opt.color : 'rgba(255,255,255,0.08)'}`,
                background: selected ? `${opt.color}12` : 'rgba(40,42,48,0.5)',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <div style={{
                  width: 12, height: 12, borderRadius: 6,
                  border: `2px solid ${selected ? opt.color : 'rgba(255,255,255,0.2)'}`,
                  background: selected ? opt.color : 'transparent',
                  transition: 'all 0.15s',
                  flexShrink: 0,
                }} />
                <span style={{ fontSize: 14, fontWeight: 600, color: selected ? '#F0F1F2' : 'rgba(200,200,210,0.7)' }}>
                  {opt.label}
                </span>
                <span style={{ fontSize: 11, color: `${opt.color}bb`, marginLeft: 'auto' }}>
                  {opt.hint}
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'rgba(200,200,210,0.5)', paddingLeft: 22, lineHeight: 1.5 }}>
                {opt.description}
              </div>
            </div>
          );
        })}
      </div>

      {riskLevel === 'high' && (
        <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 6, background: 'rgba(217,83,79,0.1)', color: '#d9534f', fontSize: 12 }}>
          Warning: High risk mode allows the agent to execute all operations without confirmation, including file deletion and shell commands.
        </div>
      )}

      {saveMessage && (
        <div style={{ marginTop: 8, fontSize: 12, color: saveMessage.includes('Failed') ? '#d9534f' : '#5cb85c' }}>
          {saveMessage}
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

  const navItems: { key: Section; label: string }[] = [
    { key: 'llm', label: 'LLM' },
    { key: 'browser', label: 'Browser' },
    { key: 'notifications', label: 'Notifications' },
    { key: 'permissions', label: 'Permissions' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar */}
        <div style={{
          width: 160,
          background: '#1e1e24',
          borderRight: '1px solid rgba(255,255,255,0.06)',
          padding: '16px 0',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
        }}>
          {navItems.map((item) => (
            <div
              key={item.key}
              onClick={() => setSection(item.key)}
              style={{
                padding: '10px 20px',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                borderLeft: '2px solid transparent',
                color: section === item.key ? '#F0F1F2' : 'rgba(200,200,210,0.5)',
                borderLeftColor: section === item.key ? '#50b478' : 'transparent',
                background: section === item.key ? 'rgba(80,180,120,0.08)' : 'transparent',
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => {
                if (section !== item.key) {
                  (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.03)';
                  (e.currentTarget as HTMLDivElement).style.color = 'rgba(200,200,210,0.8)';
                }
              }}
              onMouseLeave={(e) => {
                if (section !== item.key) {
                  (e.currentTarget as HTMLDivElement).style.background = 'transparent';
                  (e.currentTarget as HTMLDivElement).style.color = 'rgba(200,200,210,0.5)';
                }
              }}
            >
              {item.label}
            </div>
          ))}
        </div>

        {/* Content area */}
        <div style={{ flex: 1, padding: '24px 28px', overflowY: 'auto' }}>
          {section === 'llm' && <LLMSection />}
          {section === 'browser' && <BrowserSection />}
          {section === 'notifications' && <NotificationsSection />}
          {section === 'permissions' && <PermissionsSection />}
        </div>
      </div>

      {/* Footer */}
      <div style={{
        padding: '10px 28px',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        fontSize: 11,
        color: 'rgba(200,200,210,0.4)',
      }}>
        Your API key is stored locally on this device and never sent to our servers.
      </div>
    </div>
  );
};
