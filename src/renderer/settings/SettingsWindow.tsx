import React, { useState, useEffect, useCallback } from 'react';
import type { LLMConfig } from '../../shared/types';

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
      { value: 'deepseek-chat', label: 'DeepSeek Chat' },
      { value: 'deepseek-reasoner', label: 'DeepSeek Reasoner' },
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
    models: [], // User enters model ID manually
  },
];

/** Status of a connection test attempt */
type ConnectionStatus = 'idle' | 'testing' | 'success' | 'error';

export const SettingsWindow: React.FC = () => {
  const [provider, setProvider] = useState('openai');
  const [model, setModel] = useState('gpt-4o');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle');
  const [connectionMessage, setConnectionMessage] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [hasLoaded, setHasLoaded] = useState(false);

  // Load current config on mount
  useEffect(() => {
    if (!window.settingsAPI) return;
    window.settingsAPI.loadConfig().then((config) => {
      if (config) {
        setProvider(config.provider || 'openai');
        setModel(config.model || 'gpt-4o');
        setApiKey(config.apiKey || '');
      }
      setHasLoaded(true);
    }).catch(() => {
      setHasLoaded(true);
    });
  }, []);

  // When provider changes, reset model to the first available for that provider
  const handleProviderChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const newProvider = e.target.value;
      setProvider(newProvider);
      setConnectionStatus('idle');
      setConnectionMessage('');
      setSaveMessage('');

      const providerOpt = PROVIDERS.find((p) => p.value === newProvider);
      if (providerOpt && providerOpt.models.length > 0) {
        setModel(providerOpt.models[0].value);
      } else {
        setModel('');
      }
    },
    []
  );

  const handleModelChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => {
      setModel(e.target.value);
      setConnectionStatus('idle');
      setConnectionMessage('');
      setSaveMessage('');
    },
    []
  );

  const handleApiKeyChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setApiKey(e.target.value);
      setConnectionStatus('idle');
      setConnectionMessage('');
      setSaveMessage('');
    },
    []
  );

  const handleTestConnection = useCallback(async () => {
    if (!window.settingsAPI || !apiKey.trim()) return;

    setConnectionStatus('testing');
    setConnectionMessage('Testing connection...');
    setSaveMessage('');

    try {
      const result = await window.settingsAPI.testConnection({
        provider,
        model: model || 'gpt-4o',
        apiKey,
      });
      if (result.success) {
        setConnectionStatus('success');
        setConnectionMessage('Connection successful!');
      } else {
        setConnectionStatus('error');
        setConnectionMessage(result.error || 'Connection failed');
      }
    } catch (err: unknown) {
      setConnectionStatus('error');
      setConnectionMessage(
        err instanceof Error ? err.message : 'Connection test failed'
      );
    }
  }, [provider, model, apiKey]);

  const handleSave = useCallback(async () => {
    if (!window.settingsAPI) return;

    const config: LLMConfig = {
      provider,
      model: model || 'gpt-4o',
      apiKey,
    };

    try {
      const result = await window.settingsAPI.saveConfig(config);
      if (result.success) {
        setSaveMessage('Settings saved successfully');
        setConnectionStatus('idle');
        setConnectionMessage('');
      } else {
        setSaveMessage(result.error || 'Failed to save settings');
      }
    } catch (err: unknown) {
      setSaveMessage(
        err instanceof Error ? err.message : 'Failed to save settings'
      );
    }

    // Clear save message after a delay
    setTimeout(() => {
      setSaveMessage('');
    }, 3000);
  }, [provider, model, apiKey]);

  const handleClose = useCallback(() => {
    if (window.settingsAPI) {
      window.settingsAPI.closeWindow();
    }
  }, []);

  const currentProvider = PROVIDERS.find((p) => p.value === provider);
  const isFormValid = provider && model && apiKey.trim().length > 0;

  // Styles
  const styles: Record<string, React.CSSProperties> = {
    container: {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      padding: '32px 40px',
      overflow: 'auto',
    },
    title: {
      fontSize: 20,
      fontWeight: 600,
      marginBottom: 24,
      color: '#F0F1F2',
    },
    section: {
      marginBottom: 20,
    },
    label: {
      display: 'block',
      fontSize: 12,
      fontWeight: 500,
      color: 'rgba(200, 200, 210, 0.8)',
      marginBottom: 6,
      textTransform: 'uppercase' as const,
      letterSpacing: '0.5px',
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
    inputWrapper: {
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
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
    toggleButton: {
      position: 'absolute' as const,
      right: 8,
      background: 'none',
      border: 'none',
      color: 'rgba(200, 200, 210, 0.6)',
      cursor: 'pointer',
      padding: '4px 8px',
      fontSize: 12,
    },
    buttonRow: {
      display: 'flex',
      gap: 12,
      marginTop: 28,
    },
    button: {
      padding: '10px 24px',
      border: 'none',
      borderRadius: 8,
      fontSize: 14,
      fontWeight: 500,
      cursor: 'pointer',
      fontFamily: 'inherit',
      transition: 'opacity 0.15s ease',
    },
    saveButton: {
      background: isFormValid ? 'rgba(80, 180, 120, 0.9)' : 'rgba(80, 180, 120, 0.4)',
      color: '#fff',
    },
    testButton: {
      background: 'rgba(60, 120, 200, 0.8)',
      color: '#fff',
    },
    closeButton: {
      background: 'rgba(80, 80, 90, 0.6)',
      color: '#F0F1F2',
    },
    statusMessage: {
      marginTop: 12,
      fontSize: 13,
      padding: '8px 12px',
      borderRadius: 6,
    },
    successMessage: {
      color: '#5cb85c',
      background: 'rgba(92, 184, 92, 0.1)',
    },
    errorMessage: {
      color: '#d9534f',
      background: 'rgba(217, 83, 79, 0.1)',
    },
    infoMessage: {
      color: '#f0ad4e',
      background: 'rgba(240, 173, 78, 0.1)',
    },
    footer: {
      marginTop: 'auto',
      paddingTop: 16,
      borderTop: '1px solid rgba(255, 255, 255, 0.06)',
    },
    modelInputNote: {
      fontSize: 11,
      color: 'rgba(200, 200, 210, 0.5)',
      marginTop: 4,
    },
  };

  if (!hasLoaded) {
    return (
      <div style={styles.container}>
        <div style={{ color: 'rgba(200, 200, 210, 0.6)', textAlign: 'center', marginTop: 40 }}>
          Loading settings...
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.title}>LLM Configuration</div>

      {/* Provider select */}
      <div style={styles.section}>
        <label style={styles.label}>Provider</label>
        <select
          value={provider}
          onChange={handleProviderChange}
          style={styles.select}
        >
          {PROVIDERS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {/* Model select or text input */}
      <div style={styles.section}>
        <label style={styles.label}>Model</label>
        {currentProvider && currentProvider.models.length > 0 ? (
          <select
            value={model}
            onChange={handleModelChange}
            style={styles.select}
          >
            {currentProvider.models.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        ) : (
          <>
            <input
              type="text"
              value={model}
              onChange={handleModelChange}
              placeholder="Enter model ID (e.g., openai/gpt-4o)"
              style={styles.input}
            />
            <div style={styles.modelInputNote}>
              Enter the OpenRouter model ID in provider/model format
            </div>
          </>
        )}
      </div>

      {/* API Key input */}
      <div style={styles.section}>
        <label style={styles.label}>API Key</label>
        <div style={styles.inputWrapper}>
          <input
            type={showApiKey ? 'text' : 'password'}
            value={apiKey}
            onChange={handleApiKeyChange}
            placeholder="Enter your API key"
            style={{ ...styles.input, paddingRight: 60 }}
          />
          <button
            onClick={() => setShowApiKey((prev) => !prev)}
            style={styles.toggleButton}
          >
            {showApiKey ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      {/* Action buttons */}
      <div style={styles.buttonRow}>
        <button
          onClick={handleSave}
          disabled={!isFormValid}
          style={{
            ...styles.button,
            ...styles.saveButton,
            cursor: isFormValid ? 'pointer' : 'not-allowed',
          }}
        >
          Save
        </button>
        <button
          onClick={handleTestConnection}
          disabled={!isFormValid || connectionStatus === 'testing'}
          style={{
            ...styles.button,
            ...styles.testButton,
            cursor: isFormValid && connectionStatus !== 'testing' ? 'pointer' : 'not-allowed',
            opacity: !isFormValid || connectionStatus === 'testing' ? 0.5 : 1,
          }}
        >
          {connectionStatus === 'testing' ? 'Testing...' : 'Test Connection'}
        </button>
        <button
          onClick={handleClose}
          style={{ ...styles.button, ...styles.closeButton }}
        >
          Close
        </button>
      </div>

      {/* Connection test status */}
      {connectionStatus !== 'idle' && connectionMessage && (
        <div
          style={{
            ...styles.statusMessage,
            ...(connectionStatus === 'success'
              ? styles.successMessage
              : connectionStatus === 'testing'
                ? styles.infoMessage
                : styles.errorMessage),
          }}
        >
          {connectionMessage}
        </div>
      )}

      {/* Save status */}
      {saveMessage && (
        <div
          style={{
            ...styles.statusMessage,
            ...(saveMessage.includes('success')
              ? styles.successMessage
              : styles.errorMessage),
          }}
        >
          {saveMessage}
        </div>
      )}

      {/* Footer hint */}
      <div style={styles.footer}>
        <div style={{ fontSize: 12, color: 'rgba(200, 200, 210, 0.4)' }}>
          Your API key is stored locally on this device and never sent to our servers.
        </div>
      </div>
    </div>
  );
};
