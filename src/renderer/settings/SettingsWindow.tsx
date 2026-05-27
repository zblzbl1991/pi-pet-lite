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
  GitBranch,
  Play,
  Pause,
  Square,
  Clock,
  CheckCircle,
  XCircle,
  SkipForward,
  Loader,
  Activity,
} from 'lucide-react';
import type { LLMConfig, NotificationConfig, BrowserConfig, RiskLevel, ThinkingLevel, PetProfile, PetRole, AgentCardInfo, PluginSummary, WorkflowDefinition, WorkflowRunSnapshot, StepResult } from '../../shared/types';
import { TOOL_GROUPS, CUSTOM_PROFILE_DEFAULT_PROMPT, CUSTOM_PROFILE_DEFAULT_TOOLS } from '../../shared/constants';
import { TracesTab } from './TracesTab';

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
type Section = 'llm' | 'browser' | 'notifications' | 'permissions' | 'pets' | 'plugins' | 'workflows' | 'traces';

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
      setSaveMessage(result.success ? '设置已保存' : (result.error || '保存失败'));
    } catch (err: unknown) {
      setSaveMessage(err instanceof Error ? err.message : '保存失败');
    }
    setTimeout(() => setSaveMessage(''), 3000);
  }, [provider, effectiveModel, apiKey, thinkingLevel]);

  const handleTest = useCallback(async () => {
    if (!window.settingsAPI || !apiKey.trim()) return;
    setConnectionStatus('testing');
    setConnectionMessage('正在测试连接...');
    setSaveMessage('');
    try {
      const result = await window.settingsAPI.testConnection({
        provider, model: effectiveModel || 'gpt-4o', apiKey,
      });
      setConnectionStatus(result.success ? 'success' : 'error');
      setConnectionMessage(result.success ? '连接成功！' : (result.error || '连接失败'));
    } catch (err: unknown) {
      setConnectionStatus('error');
      setConnectionMessage(err instanceof Error ? err.message : '连接测试失败');
    }
  }, [provider, effectiveModel, apiKey]);

  if (!hasLoaded) {
    return <div style={{ color: 'var(--text-tertiary)', textAlign: 'center', marginTop: 'var(--space-10)' }}>加载中...</div>;
  }

  return (
    <>
      <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--font-semibold)', marginBottom: 'var(--space-5)', color: 'var(--text-primary)' }}>
        LLM 配置
      </div>

      <div style={sharedStyles.field}>
        <label style={sharedStyles.label}>服务商</label>
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
        <label style={sharedStyles.label}>模型</label>
        {currentProvider && currentProvider.models.length > 0 ? (
          <>
            <select value={model} onChange={(e) => { setModel(e.target.value); setConnectionStatus('idle'); setSaveMessage(''); }} style={sharedStyles.select}>
              {currentProvider.models.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              <option value={CUSTOM_MODEL_VALUE}>自定义...</option>
            </select>
            {isCustomModel && (
              <>
                <input type="text" value={customModelValue} onChange={(e) => { setCustomModelValue(e.target.value); setConnectionStatus('idle'); setSaveMessage(''); }}
                  placeholder="输入自定义模型名称" style={{ ...sharedStyles.input, marginTop: 'var(--space-2)' }} />
                <div style={sharedStyles.hint}>输入 {currentProvider.label} 支持的任意模型名称</div>
              </>
            )}
          </>
        ) : (
          <>
            <input type="text" value={model} onChange={(e) => { setModel(e.target.value); setConnectionStatus('idle'); setSaveMessage(''); }}
              placeholder="输入模型 ID（如 openai/gpt-4o）" style={sharedStyles.input} />
            <div style={sharedStyles.hint}>以 provider/model 格式输入 OpenRouter 模型 ID</div>
          </>
        )}
      </div>

      <div style={sharedStyles.field}>
        <label style={sharedStyles.label}>API 密钥</label>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <input type={showApiKey ? 'text' : 'password'} value={apiKey}
            onChange={(e) => { setApiKey(e.target.value); setConnectionStatus('idle'); setSaveMessage(''); }}
            placeholder="输入你的 API 密钥" style={{ ...sharedStyles.input, paddingRight: 60 }} />
          <button onClick={() => setShowApiKey((p) => !p)}
            style={{ position: 'absolute', right: 'var(--space-2)', background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: 'var(--space-1) var(--space-2)', display: 'flex', alignItems: 'center' }}>
            {showApiKey ? <EyeOff size={14} strokeWidth={1.5} /> : <Eye size={14} strokeWidth={1.5} />}
          </button>
        </div>
      </div>

      <div style={sharedStyles.field}>
        <label style={sharedStyles.label}>思考深度</label>
        <select value={thinkingLevel} onChange={(e) => { setThinkingLevel(e.target.value as ThinkingLevel); setSaveMessage(''); }} style={sharedStyles.select}>
          <option value="off">关闭</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option>
        </select>
        <div style={sharedStyles.hint}>控制 agent 在回复前的思考程度。越高推理能力越强但速度越慢。</div>
      </div>

      <div style={sharedStyles.btnRow}>
        <button onClick={handleSave} disabled={!isFormValid}
          style={{ ...sharedStyles.btn, ...sharedStyles.btnSave, opacity: isFormValid ? 1 : 0.4, cursor: isFormValid ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          <Save size={14} strokeWidth={1.5} style={{ color: '#fff' }} /> 保存
        </button>
        <button onClick={handleTest} disabled={!isFormValid || connectionStatus === 'testing'}
          style={{ ...sharedStyles.btn, ...sharedStyles.btnTest, opacity: isFormValid && connectionStatus !== 'testing' ? 1 : 0.5, cursor: isFormValid && connectionStatus !== 'testing' ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          <Plug size={14} strokeWidth={1.5} style={{ color: '#fff' }} /> {connectionStatus === 'testing' ? '测试中...' : '测试连接'}
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
      setSaveMessage(result.success ? '浏览器设置已保存' : (result.error || '保存失败'));
    } catch (err: unknown) {
      setSaveMessage(err instanceof Error ? err.message : '保存失败');
    }
    setTimeout(() => setSaveMessage(''), 3000);
  }, [browserConfig]);

  const handleTest = useCallback(async () => {
    if (!window.settingsAPI) return;
    setConnStatus('testing'); setConnMessage('正在测试连接...'); setSaveMessage('');
    try {
      const result = await window.settingsAPI.testBrowserConnection(browserConfig);
      setConnStatus(result.success ? 'success' : 'error');
      setConnMessage(result.success
        ? (result.browserInfo ? `已连接：${result.browserInfo}` : '连接成功！')
        : (result.error || '连接失败'));
    } catch (err: unknown) {
      setConnStatus('error');
      setConnMessage(err instanceof Error ? err.message : '连接测试失败');
    }
  }, [browserConfig]);

  return (
    <>
      <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--font-semibold)', marginBottom: 'var(--space-5)', color: 'var(--text-primary)' }}>
        浏览器
      </div>

      <div style={sharedStyles.field}>
        <label style={sharedStyles.label}>Chrome / Edge 路径</label>
        <input type="text" value={browserConfig.chromePath}
          onChange={(e) => { setBrowserConfig((p) => ({ ...p, chromePath: e.target.value })); setConnStatus('idle'); setSaveMessage(''); }}
          placeholder="自动检测（留空即可）" style={sharedStyles.input} />
        <div style={sharedStyles.hint}>留空将自动检测系统中的 Edge 或 Chrome。</div>
      </div>

      <div style={sharedStyles.field}>
        <label style={sharedStyles.label}>CDP 端口</label>
        <input type="number" min={1} max={65535} value={browserConfig.cdpPort}
          onChange={(e) => {
            const val = parseInt(e.target.value, 10);
            setBrowserConfig((p) => ({ ...p, cdpPort: (val >= 1 && val <= 65535) ? val : 9222 }));
            setConnStatus('idle'); setSaveMessage('');
          }}
          placeholder="9222" style={{ ...sharedStyles.input, width: 120 }} />
        <div style={sharedStyles.hint}>Chrome 需要以 --remote-debugging-port={'<port>'} 启动才能使用 CDP。</div>
      </div>

      <div style={sharedStyles.btnRow}>
        <button onClick={handleSave} style={{ ...sharedStyles.btn, ...sharedStyles.btnSave, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}><Save size={14} strokeWidth={1.5} style={{ color: '#fff' }} /> 保存</button>
        <button onClick={handleTest} disabled={connStatus === 'testing'}
          style={{ ...sharedStyles.btn, ...sharedStyles.btnTest, opacity: connStatus === 'testing' ? 0.5 : 1, cursor: connStatus === 'testing' ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          <Plug size={14} strokeWidth={1.5} style={{ color: '#fff' }} /> {connStatus === 'testing' ? '测试中...' : '测试连接'}
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
        setSaveMessage(r?.success ? '通知设置已保存' : (r?.error || '保存失败'));
        setTimeout(() => setSaveMessage(''), 2000);
      });
      return next;
    });
  }, []);

  const allOff = !notifConfig.systemToast && !notifConfig.petBubble && !notifConfig.petAnimation;

  return (
    <>
      <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--font-semibold)', marginBottom: 'var(--space-5)', color: 'var(--text-primary)' }}>
        通知
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {[
          { key: 'systemToast' as const, label: '系统通知', hint: '任务完成时弹出 Windows 通知' },
          { key: 'petBubble' as const, label: '宠物气泡', hint: '在宠物上方显示结果摘要' },
          { key: 'petAnimation' as const, label: '宠物动画', hint: '播放成功/失败动画' },
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
          <AlertTriangle size={14} strokeWidth={1.5} /> 所有通知已关闭 — 任务完成时不会收到提醒。
        </div>
      )}

      {saveMessage && (
        <div style={{ marginTop: 'var(--space-2)', fontSize: 'var(--text-sm)', color: (saveMessage.includes('Failed') || saveMessage.includes('失败')) ? 'var(--danger)' : 'var(--success)' }}>
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
      setSaveMessage(r?.success ? '权限设置已保存' : (r?.error || '保存失败'));
      setTimeout(() => setSaveMessage(''), 2000);
    });
  }, []);

  const options: { value: RiskLevel; label: string; color: string; hint: string; description: string }[] = [
    {
      value: 'low',
      label: '低风险',
      color: 'var(--success)',
      hint: '所有工具需要确认',
      description: '所有工具调用（包括只读操作）在执行前都需要你的批准。最安全的模式，适合首次使用或敏感环境。',
    },
    {
      value: 'medium',
      label: '中风险',
      color: 'var(--warning)',
      hint: '关键工具需要确认',
      description: '只读工具自动执行。写入、编辑、Shell 和浏览器操作仍需你的批准。适合日常使用的均衡模式。',
    },
    {
      value: 'high',
      label: '高风险',
      color: 'var(--danger)',
      hint: '无需确认',
      description: '所有工具自动执行，无需任何确认。自主性最高的模式，适合你信任 agent 独立操作的场景。',
    },
  ];

  return (
    <>
      <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--font-semibold)', marginBottom: 'var(--space-5)', color: 'var(--text-primary)' }}>
        权限
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
          <AlertTriangle size={14} strokeWidth={1.5} /> 警告：高风险模式允许 agent 无需确认即可执行所有操作，包括文件删除和 Shell 命令。
        </div>
      )}

      {saveMessage && (
        <div style={{ marginTop: 'var(--space-2)', fontSize: 'var(--text-sm)', color: (saveMessage.includes('Failed') || saveMessage.includes('失败')) ? 'var(--danger)' : 'var(--success)' }}>
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
      name: '新宠物',
      role: 'custom' as PetRole,
      systemPrompt: CUSTOM_PROFILE_DEFAULT_PROMPT.replace('{name}', '新宠物'),
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
    return <div style={{ color: 'var(--text-tertiary)', textAlign: 'center', marginTop: 'var(--space-10)' }}>加载中...</div>;
  }

  const roleColors: Record<string, string> = {
    chief: 'var(--role-chief)', coder: 'var(--role-coder)', scout: 'var(--role-scout)',
    analyst: 'var(--role-analyst)', custom: 'var(--role-custom)', remote: REMOTE_ROLE_COLOR,
  };

  return (
    <>
      <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--font-semibold)', marginBottom: 'var(--space-5)', color: 'var(--text-primary)' }}>
        宠物配置
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
// Plugins Section — Plugin management
// ---------------------------------------------------------------------------

function PluginsSection() {
  const [plugins, setPlugins] = useState<PluginSummary[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [installPath, setInstallPath] = useState('');
  const [showInstallForm, setShowInstallForm] = useState(false);
  const [confirmUninstall, setConfirmUninstall] = useState<string | null>(null);

  const loadPlugins = useCallback(async () => {
    if (!window.settingsAPI?.listPlugins) return;
    try {
      const list = await window.settingsAPI.listPlugins();
      setPlugins(list ?? []);
    } catch {
      // Plugin API not available
    }
    setHasLoaded(true);
  }, []);

  useEffect(() => {
    loadPlugins();
  }, [loadPlugins]);

  const handleToggle = useCallback(async (name: string, currentlyEnabled: boolean) => {
    setSaveMessage('');
    try {
      if (currentlyEnabled) {
        const result = await window.settingsAPI?.disablePlugin?.(name);
        if (!result?.success) {
          setSaveMessage(result?.error ?? '禁用失败');
          setTimeout(() => setSaveMessage(''), 3000);
          return;
        }
      } else {
        const result = await window.settingsAPI?.enablePlugin?.(name);
        if (!result?.success) {
          setSaveMessage(result?.error ?? '启用失败');
          setTimeout(() => setSaveMessage(''), 3000);
          return;
        }
      }
      await loadPlugins();
    } catch (err: unknown) {
      setSaveMessage(err instanceof Error ? err.message : '操作失败');
      setTimeout(() => setSaveMessage(''), 3000);
    }
  }, [loadPlugins]);

  const handleInstall = useCallback(async () => {
    if (!installPath.trim()) return;
    setSaveMessage('正在安装...');
    try {
      const result = await window.settingsAPI?.installPlugin?.(installPath.trim());
      if (result?.success) {
        setSaveMessage(`插件 "${result.name}" 安装成功`);
        setInstallPath('');
        setShowInstallForm(false);
        await loadPlugins();
      } else {
        setSaveMessage(result?.error ?? '安装失败');
      }
    } catch (err: unknown) {
      setSaveMessage(err instanceof Error ? err.message : '安装失败');
    }
    setTimeout(() => setSaveMessage(''), 3000);
  }, [installPath, loadPlugins]);

  const handleUninstall = useCallback(async (name: string) => {
    setSaveMessage('');
    try {
      const result = await window.settingsAPI?.uninstallPlugin?.(name);
      if (result?.success) {
        setSaveMessage(`插件 "${name}" 已卸载`);
        setConfirmUninstall(null);
        await loadPlugins();
      } else {
        setSaveMessage(result?.error ?? '卸载失败');
      }
    } catch (err: unknown) {
      setSaveMessage(err instanceof Error ? err.message : '卸载失败');
    }
    setTimeout(() => setSaveMessage(''), 3000);
  }, [loadPlugins]);

  if (!hasLoaded) {
    return <div style={{ color: 'var(--text-tertiary)', textAlign: 'center', marginTop: 'var(--space-10)' }}>加载中...</div>;
  }

  return (
    <>
      <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--font-semibold)', marginBottom: 'var(--space-5)', color: 'var(--text-primary)' }}>
        插件
      </div>

      {plugins.length === 0 && !showInstallForm && (
        <div style={{
          padding: 'var(--space-6)', textAlign: 'center',
          background: 'var(--bg-elevated)', borderRadius: 'var(--radius-nav)',
          border: `1px solid var(--border-subtle)`,
        }}>
          <div style={{ fontSize: 'var(--text-base)', color: 'var(--text-secondary)', marginBottom: 'var(--space-2)' }}>
            暂无已安装的插件
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-4)' }}>
            将插件放入 ~/.clawd/plugins/ 目录或从本地路径安装。
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        {plugins.map((plugin) => (
          <div key={plugin.name} style={{
            padding: 'var(--space-3) var(--space-4)',
            borderRadius: 'var(--radius-nav)',
            border: `1.5px solid ${plugin.enabled ? 'var(--success)' : 'var(--border-subtle)'}`,
            background: plugin.enabled ? 'var(--success-bg)' : 'var(--bg-elevated)',
            opacity: plugin.enabled ? 1 : 0.6,
            transition: 'all var(--duration-fast)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <Plug size={14} strokeWidth={1.5} style={{ color: plugin.enabled ? 'var(--success)' : 'var(--text-tertiary)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <span style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--font-semibold)', color: 'var(--text-primary)' }}>
                    {plugin.displayName}
                  </span>
                  {plugin.version && (
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                      v{plugin.version}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 'var(--space-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {plugin.description}
                  {plugin.author && <span> -- {plugin.author}</span>}
                </div>
                {plugin.permissions.length > 0 && (
                  <div style={{ display: 'flex', gap: 'var(--space-1)', marginTop: 'var(--space-1)' }}>
                    {plugin.permissions.map((perm) => (
                      <span key={perm} style={{
                        fontSize: 'var(--text-xs)', padding: '1px 6px', borderRadius: 'var(--radius-sm)',
                        background: 'var(--warning-bg)', color: 'var(--warning)',
                      }}>
                        {perm}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={() => handleToggle(plugin.name, plugin.enabled)}
                style={{
                  padding: 'var(--space-1) var(--space-3)',
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  fontSize: 'var(--text-xs)',
                  fontWeight: 'var(--font-medium)',
                  cursor: 'pointer',
                  background: plugin.enabled ? 'var(--warning-bg)' : 'var(--success-bg)',
                  color: plugin.enabled ? 'var(--warning)' : 'var(--success)',
                  fontFamily: 'inherit',
                  transition: 'all var(--duration-fast)',
                  flexShrink: 0,
                }}
              >
                {plugin.enabled ? '禁用' : '启用'}
              </button>
              <button
                onClick={() => setConfirmUninstall(plugin.name)}
                style={{
                  background: 'none', border: 'none', color: 'var(--danger)',
                  cursor: 'pointer', fontSize: 'var(--text-xs)', padding: 'var(--space-1) var(--space-2)',
                  opacity: 0.6, display: 'flex', alignItems: 'center',
                }}
              >
                <Trash2 size={12} strokeWidth={1.5} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Install form */}
      {showInstallForm ? (
        <div style={{
          padding: 'var(--space-4)', borderRadius: 'var(--radius-nav)',
          border: `1.5px dashed var(--brand)50`, background: 'var(--brand-glow)',
        }}>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)', color: 'var(--text-primary)', marginBottom: 'var(--space-3)' }}>
            从本地路径安装
          </div>
          <div style={sharedStyles.field}>
            <label style={sharedStyles.label}>插件目录路径</label>
            <input type="text" value={installPath}
              onChange={(e) => setInstallPath(e.target.value)}
              placeholder="C:\path\to\plugin-directory" style={sharedStyles.input} />
            <div style={sharedStyles.hint}>目录必须包含 plugin.json 和入口 JS 文件。</div>
          </div>
          <div style={{ ...sharedStyles.btnRow, marginTop: 'var(--space-3)' }}>
            <button onClick={handleInstall} disabled={!installPath.trim()}
              style={{
                ...sharedStyles.btn, ...sharedStyles.btnSave,
                opacity: installPath.trim() ? 1 : 0.4,
                cursor: installPath.trim() ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
              }}>
              <Save size={14} strokeWidth={1.5} style={{ color: '#fff' }} /> 安装
            </button>
            <button onClick={() => { setShowInstallForm(false); setInstallPath(''); }}
              style={{ ...sharedStyles.btn, background: 'var(--border)', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
              <X size={14} strokeWidth={1.5} /> 取消
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowInstallForm(true)} style={{
          padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-nav)', border: `1.5px dashed var(--border)`,
          background: 'transparent', color: 'var(--text-tertiary)', cursor: 'pointer',
          fontSize: 'var(--text-xs)', fontWeight: 'var(--font-medium)', textAlign: 'center',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)', width: '100%',
        }}>
          <Plus size={14} strokeWidth={1.5} /> 从本地路径安装插件
        </button>
      )}

      <SaveStatus message={saveMessage} />

      {/* Uninstall confirmation dialog */}
      {confirmUninstall && (
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
              卸载插件 "{confirmUninstall}"？
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginBottom: 'var(--space-5)' }}>
              此操作将永久删除该插件及其所有文件，无法撤销。
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmUninstall(null)} style={{
                ...sharedStyles.btn, background: 'var(--border)', color: 'var(--text-secondary)', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
              }}>
                <X size={14} strokeWidth={1.5} /> 取消
              </button>
              <button onClick={() => handleUninstall(confirmUninstall)} style={{
                ...sharedStyles.btn, background: 'var(--danger)', color: '#fff', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
              }}>
                <Trash2 size={14} strokeWidth={1.5} style={{ color: '#fff' }} /> 卸载
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Workflows Section — Workflow management
// ---------------------------------------------------------------------------

/** Map step status to display info */
function stepStatusInfo(status: string): { color: string; icon: React.ReactNode; label: string } {
  switch (status) {
    case 'completed':
      return { color: 'var(--success)', icon: <CheckCircle size={12} strokeWidth={1.5} />, label: 'Completed' };
    case 'running':
      return { color: 'var(--brand)', icon: <Loader size={12} strokeWidth={1.5} />, label: 'Running' };
    case 'failed':
      return { color: 'var(--danger)', icon: <XCircle size={12} strokeWidth={1.5} />, label: 'Failed' };
    case 'skipped':
      return { color: 'var(--text-tertiary)', icon: <SkipForward size={12} strokeWidth={1.5} />, label: 'Skipped' };
    case 'pending':
    default:
      return { color: 'var(--text-tertiary)', icon: <Clock size={12} strokeWidth={1.5} />, label: 'Pending' };
  }
}

function runStatusInfo(status: string): { color: string; label: string } {
  switch (status) {
    case 'running':
      return { color: 'var(--brand)', label: 'Running' };
    case 'paused':
      return { color: 'var(--warning)', label: 'Paused' };
    case 'completed':
      return { color: 'var(--success)', label: 'Completed' };
    case 'failed':
      return { color: 'var(--danger)', label: 'Failed' };
    case 'cancelled':
      return { color: 'var(--text-tertiary)', label: 'Cancelled' };
    default:
      return { color: 'var(--text-tertiary)', label: status };
  }
}

function WorkflowsSection() {
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [expandedWf, setExpandedWf] = useState<string | null>(null);
  const [showRunModal, setShowRunModal] = useState<string | null>(null);
  const [inputValues, setInputValues] = useState<Record<string, unknown>>({});
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [activeRunSnapshot, setActiveRunSnapshot] = useState<WorkflowRunSnapshot | null>(null);
  const [saveMessage, setSaveMessage] = useState('');
  const [history, setHistory] = useState<WorkflowRunSnapshot[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const loadWorkflowsList = useCallback(async () => {
    if (!window.settingsAPI?.listWorkflows) return;
    try {
      const list = await window.settingsAPI.listWorkflows();
      setWorkflows(list ?? []);
    } catch {
      // Workflow API not available
    }
    setHasLoaded(true);
  }, []);

  useEffect(() => {
    loadWorkflowsList();
  }, [loadWorkflowsList]);

  const loadHistory = useCallback(async () => {
    if (!window.settingsAPI?.getWorkflowHistory) return;
    try {
      const result = await window.settingsAPI.getWorkflowHistory();
      setHistory(result?.runs ?? []);
    } catch {
      // ignore
    }
  }, []);

  // Poll active run status
  useEffect(() => {
    if (!activeRunId) return;
    const interval = setInterval(async () => {
      try {
        const result = await window.settingsAPI?.getWorkflowStatus(activeRunId);
        if (result?.run) {
          setActiveRunSnapshot(result.run);
          if (result.run.status !== 'running' && result.run.status !== 'paused') {
            clearInterval(interval);
            loadHistory();
          }
        }
      } catch {
        // ignore
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [activeRunId, loadHistory]);

  const handleRun = useCallback(async (workflowName: string) => {
    if (!window.settingsAPI?.runWorkflow) return;
    setSaveMessage('');

    try {
      const result = await window.settingsAPI.runWorkflow(workflowName, inputValues);
      if (result.success && result.runId) {
        setActiveRunId(result.runId);
        setActiveRunSnapshot(null);
        setShowRunModal(null);
        setInputValues({});
        setSaveMessage(`Workflow started: ${result.runId}`);
      } else {
        setSaveMessage(result.error ?? 'Failed to start workflow');
      }
    } catch (err: unknown) {
      setSaveMessage(err instanceof Error ? err.message : 'Failed to start workflow');
    }
    setTimeout(() => setSaveMessage(''), 5000);
  }, [inputValues]);

  const handlePause = useCallback(async (runId: string) => {
    if (!window.settingsAPI?.pauseWorkflow) return;
    try {
      await window.settingsAPI.pauseWorkflow(runId);
      // Refresh status
      const result = await window.settingsAPI.getWorkflowStatus(runId);
      if (result?.run) setActiveRunSnapshot(result.run);
    } catch (err: unknown) {
      setSaveMessage(err instanceof Error ? err.message : 'Pause failed');
      setTimeout(() => setSaveMessage(''), 3000);
    }
  }, []);

  const handleResume = useCallback(async (runId: string) => {
    if (!window.settingsAPI?.resumeWorkflow) return;
    try {
      await window.settingsAPI.resumeWorkflow(runId);
      const result = await window.settingsAPI.getWorkflowStatus(runId);
      if (result?.run) setActiveRunSnapshot(result.run);
    } catch (err: unknown) {
      setSaveMessage(err instanceof Error ? err.message : 'Resume failed');
      setTimeout(() => setSaveMessage(''), 3000);
    }
  }, []);

  const handleCancel = useCallback(async (runId: string) => {
    if (!window.settingsAPI?.cancelWorkflow) return;
    try {
      await window.settingsAPI.cancelWorkflow(runId);
      const result = await window.settingsAPI.getWorkflowStatus(runId);
      if (result?.run) setActiveRunSnapshot(result.run);
      loadHistory();
    } catch (err: unknown) {
      setSaveMessage(err instanceof Error ? err.message : 'Cancel failed');
      setTimeout(() => setSaveMessage(''), 3000);
    }
  }, [loadHistory]);

  if (!hasLoaded) {
    return <div style={{ color: 'var(--text-tertiary)', textAlign: 'center', marginTop: 'var(--space-10)' }}>Loading...</div>;
  }

  const activeWorkflow = activeRunSnapshot
    ? workflows.find((w) => w.name === activeRunSnapshot.workflowName)
    : null;

  return (
    <>
      <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--font-semibold)', marginBottom: 'var(--space-5)', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>Workflows</span>
        <button onClick={() => { loadHistory(); setShowHistory(!showHistory); }} style={{
          ...sharedStyles.btn, background: 'var(--bg-elevated)', color: 'var(--text-secondary)', cursor: 'pointer',
          fontSize: 'var(--text-xs)', padding: 'var(--space-2) var(--space-3)',
          border: `1px solid var(--border)`, borderRadius: 'var(--radius-sm)',
          display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
        }}>
          <Clock size={12} strokeWidth={1.5} /> {showHistory ? 'Hide History' : 'History'}
        </button>
      </div>

      {/* Active run status */}
      {activeRunSnapshot && (
        <div style={{
          padding: 'var(--space-4)', borderRadius: 'var(--radius-nav)',
          border: `1.5px solid ${runStatusInfo(activeRunSnapshot.status).color}`,
          background: `${runStatusInfo(activeRunSnapshot.status).color}0d`,
          marginBottom: 'var(--space-4)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
            <span style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--font-semibold)', color: 'var(--text-primary)' }}>
              {activeRunSnapshot.workflowName}
            </span>
            <span style={{
              fontSize: 'var(--text-xs)', padding: '2px 8px', borderRadius: 'var(--radius-pill)',
              background: `${runStatusInfo(activeRunSnapshot.status).color}20`,
              color: runStatusInfo(activeRunSnapshot.status).color,
              fontWeight: 'var(--font-medium)',
            }}>
              {runStatusInfo(activeRunSnapshot.status).label}
            </span>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
              {new Date(activeRunSnapshot.startedAt).toLocaleTimeString()}
            </span>
          </div>

          {/* Steps progress */}
          {activeWorkflow && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {activeWorkflow.steps.map((step) => {
                const stepResult = activeRunSnapshot.stepResults.find(([id]) => id === step.id);
                const sr: StepResult | undefined = stepResult?.[1];
                const info = stepStatusInfo(sr?.status ?? 'pending');
                return (
                  <div key={step.id} style={{
                    display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                    padding: 'var(--space-2) var(--space-3)',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-elevated)',
                  }}>
                    <span style={{ color: info.color, display: 'flex', alignItems: 'center' }}>{info.icon}</span>
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)', fontWeight: 'var(--font-medium)' }}>
                      {step.id}
                    </span>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                      {'-> '}{step.agent}
                    </span>
                    <span style={{ fontSize: 'var(--text-xs)', color: info.color, marginLeft: 'auto' }}>
                      {info.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Control buttons */}
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
            {activeRunSnapshot.status === 'running' && (
              <>
                <button onClick={() => handlePause(activeRunSnapshot.id)} style={{
                  ...sharedStyles.btn, background: 'var(--warning)', color: '#000', cursor: 'pointer',
                  fontSize: 'var(--text-xs)', padding: 'var(--space-2) var(--space-3)',
                  display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
                }}>
                  <Pause size={12} strokeWidth={1.5} /> Pause
                </button>
                <button onClick={() => handleCancel(activeRunSnapshot.id)} style={{
                  ...sharedStyles.btn, background: 'var(--danger)', color: '#fff', cursor: 'pointer',
                  fontSize: 'var(--text-xs)', padding: 'var(--space-2) var(--space-3)',
                  display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
                }}>
                  <Square size={12} strokeWidth={1.5} /> Cancel
                </button>
              </>
            )}
            {activeRunSnapshot.status === 'paused' && (
              <>
                <button onClick={() => handleResume(activeRunSnapshot.id)} style={{
                  ...sharedStyles.btn, background: 'var(--success)', color: '#fff', cursor: 'pointer',
                  fontSize: 'var(--text-xs)', padding: 'var(--space-2) var(--space-3)',
                  display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
                }}>
                  <Play size={12} strokeWidth={1.5} /> Resume
                </button>
                <button onClick={() => handleCancel(activeRunSnapshot.id)} style={{
                  ...sharedStyles.btn, background: 'var(--danger)', color: '#fff', cursor: 'pointer',
                  fontSize: 'var(--text-xs)', padding: 'var(--space-2) var(--space-3)',
                  display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
                }}>
                  <Square size={12} strokeWidth={1.5} /> Cancel
                </button>
              </>
            )}
            {(activeRunSnapshot.status !== 'running' && activeRunSnapshot.status !== 'paused') && (
              <button onClick={() => { setActiveRunId(null); setActiveRunSnapshot(null); }} style={{
                ...sharedStyles.btn, background: 'var(--border)', color: 'var(--text-secondary)', cursor: 'pointer',
                fontSize: 'var(--text-xs)', padding: 'var(--space-2) var(--space-3)',
                display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
              }}>
                <X size={12} strokeWidth={1.5} /> Dismiss
              </button>
            )}
          </div>
        </div>
      )}

      {/* History */}
      {showHistory && (
        <div style={{
          marginBottom: 'var(--space-4)', padding: 'var(--space-4)',
          borderRadius: 'var(--radius-nav)', border: `1px solid var(--border-subtle)`,
          background: 'var(--bg-elevated)',
        }}>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)', color: 'var(--text-primary)', marginBottom: 'var(--space-3)' }}>
            Run History
          </div>
          {history.length === 0 ? (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>No workflow runs yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {history.slice().reverse().map((run) => {
                const info = runStatusInfo(run.status);
                const completedSteps = run.stepResults.filter(([, sr]) => sr.status === 'completed').length;
                return (
                  <div key={run.id} style={{
                    display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                    padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-page)',
                  }}>
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)', fontWeight: 'var(--font-medium)' }}>
                      {run.workflowName}
                    </span>
                    <span style={{
                      fontSize: 'var(--text-xs)', padding: '1px 6px', borderRadius: 'var(--radius-pill)',
                      background: `${info.color}20`, color: info.color,
                    }}>
                      {info.label}
                    </span>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                      {completedSteps}/{run.stepResults.length} steps
                    </span>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
                      {new Date(run.startedAt).toLocaleString()}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Workflow list */}
      {workflows.length === 0 && (
        <div style={{
          padding: 'var(--space-6)', textAlign: 'center',
          background: 'var(--bg-elevated)', borderRadius: 'var(--radius-nav)',
          border: `1px solid var(--border-subtle)`,
        }}>
          <div style={{ fontSize: 'var(--text-base)', color: 'var(--text-secondary)', marginBottom: 'var(--space-2)' }}>
            No workflows found
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-4)' }}>
            Place YAML or JSON workflow files in ~/.clawd/workflows/
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {workflows.map((wf) => {
          const isExpanded = expandedWf === wf.name;
          return (
            <div key={wf.name} style={{
              padding: 'var(--space-3) var(--space-4)',
              borderRadius: 'var(--radius-nav)',
              border: `1.5px solid ${isExpanded ? 'var(--brand)' : 'var(--border-subtle)'}`,
              background: isExpanded ? 'var(--brand-glow)' : 'var(--bg-elevated)',
              transition: 'all var(--duration-fast)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <GitBranch size={14} strokeWidth={1.5} style={{ color: 'var(--brand)', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--font-semibold)', color: 'var(--text-primary)' }}>
                    {wf.name}
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 'var(--space-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {wf.description || 'No description'}
                    <span style={{ marginLeft: 'var(--space-2)' }}>
                      ({wf.steps.length} steps)
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (wf.inputs.length > 0) {
                      setShowRunModal(wf.name);
                      setInputValues({});
                    } else {
                      handleRun(wf.name);
                    }
                  }}
                  disabled={!!activeRunId}
                  style={{
                    padding: 'var(--space-1) var(--space-3)',
                    borderRadius: 'var(--radius-sm)',
                    border: 'none',
                    fontSize: 'var(--text-xs)',
                    fontWeight: 'var(--font-medium)',
                    cursor: activeRunId ? 'not-allowed' : 'pointer',
                    background: 'var(--brand)',
                    color: '#fff',
                    fontFamily: 'inherit',
                    opacity: activeRunId ? 0.4 : 1,
                    flexShrink: 0,
                    display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
                  }}
                >
                  <Play size={10} strokeWidth={1.5} /> Run
                </button>
                <button
                  onClick={() => setExpandedWf(isExpanded ? null : wf.name)}
                  style={{
                    background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer',
                    fontSize: 'var(--text-xs)', padding: 'var(--space-1) var(--space-2)',
                  }}
                >
                  {isExpanded ? 'Close' : 'Details'}
                </button>
              </div>

              {/* Expanded step list */}
              {isExpanded && (
                <div style={{ marginTop: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  {wf.steps.map((step) => (
                    <div key={step.id} style={{
                      display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                      padding: 'var(--space-2) var(--space-3)',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-page)',
                    }}>
                      <span style={{
                        fontSize: 'var(--text-xs)', padding: '1px 6px', borderRadius: 'var(--radius-pill)',
                        background: 'var(--brand-glow)', color: 'var(--brand-light)',
                      }}>
                        {step.agent}
                      </span>
                      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)', fontWeight: 'var(--font-medium)' }}>
                        {step.id}
                      </span>
                      {step.dependsOn && step.dependsOn.length > 0 && (
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                          (after: {step.dependsOn.join(', ')})
                        </span>
                      )}
                      {step.condition && (
                        <span style={{
                          fontSize: 'var(--text-xs)', color: 'var(--warning)',
                          marginLeft: 'auto', fontStyle: 'italic',
                        }}>
                          if: {step.condition}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <SaveStatus message={saveMessage} />

      {/* Run modal with input fields */}
      {showRunModal && (() => {
        const wf = workflows.find((w) => w.name === showRunModal);
        if (!wf) return null;
        const hasRequired = wf.inputs.some((inp) => inp.required);
        const allRequiredFilled = wf.inputs
          .filter((inp) => inp.required)
          .every((inp) => {
            const val = inputValues[inp.name];
            return val !== undefined && val !== '';
          });

        return (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000,
          }}>
            <div style={{
              background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-6)', maxWidth: 420,
              border: `1px solid var(--border)`, width: '100%',
            }}>
              <div style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--font-semibold)', color: 'var(--text-primary)', marginBottom: 'var(--space-1)' }}>
                Run: {wf.name}
              </div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-4)' }}>
                {wf.description || 'Enter parameters to start the workflow.'}
              </div>

              {wf.inputs.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
                  {wf.inputs.map((inp) => (
                    <div key={inp.name}>
                      <label style={sharedStyles.label}>
                        {inp.name}
                        {inp.required && <span style={{ color: 'var(--danger)', marginLeft: 'var(--space-1)' }}>*</span>}
                      </label>
                      {inp.type === 'boolean' ? (
                        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={!!(inputValues[inp.name] ?? inp.default ?? false)}
                            onChange={(e) => setInputValues((prev) => ({ ...prev, [inp.name]: e.target.checked }))}
                            style={{ width: 'var(--space-4)', height: 'var(--space-4)', cursor: 'pointer' }}
                          />
                          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                            {inp.type} {inp.required ? '(required)' : '(optional)'}
                          </span>
                        </label>
                      ) : (
                        <input
                          type={inp.type === 'number' ? 'number' : 'text'}
                          value={(inputValues[inp.name] ?? inp.default ?? '') as string}
                          onChange={(e) => setInputValues((prev) => ({
                            ...prev,
                            [inp.name]: inp.type === 'number' ? (Number(e.target.value) || e.target.value) : e.target.value,
                          }))}
                          placeholder={`${inp.type}${inp.required ? ' (required)' : ''}`}
                          style={sharedStyles.input}
                        />
                      )}
                    </div>
                  ))}
                </div>
              ) : null}

              <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
                <button onClick={() => { setShowRunModal(null); setInputValues({}); }} style={{
                  ...sharedStyles.btn, background: 'var(--border)', color: 'var(--text-secondary)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
                }}>
                  <X size={14} strokeWidth={1.5} /> Cancel
                </button>
                <button
                  onClick={() => handleRun(wf.name)}
                  disabled={hasRequired && !allRequiredFilled}
                  style={{
                    ...sharedStyles.btn, ...sharedStyles.btnTest,
                    opacity: hasRequired && !allRequiredFilled ? 0.4 : 1,
                    cursor: hasRequired && !allRequiredFilled ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
                  }}
                >
                  <Play size={14} strokeWidth={1.5} style={{ color: '#fff' }} /> Run Workflow
                </button>
              </div>
            </div>
          </div>
        );
      })()}
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
    { key: 'browser', label: '浏览器', icon: <Globe size={16} strokeWidth={1.5} /> },
    { key: 'notifications', label: '通知', icon: <Bell size={16} strokeWidth={1.5} /> },
    { key: 'permissions', label: '权限', icon: <Shield size={16} strokeWidth={1.5} /> },
    { key: 'pets', label: '宠物', icon: <Bot size={16} strokeWidth={1.5} /> },
    { key: 'plugins', label: '插件', icon: <Plug size={16} strokeWidth={1.5} /> },
    { key: 'workflows', label: '工作流', icon: <GitBranch size={16} strokeWidth={1.5} /> },
    { key: 'traces', label: 'Traces', icon: <Activity size={16} strokeWidth={1.5} /> },
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
          {section === 'plugins' && <PluginsSection />}
          {section === 'workflows' && <WorkflowsSection />}
          {section === 'traces' && <TracesTab />}
        </div>
      </div>

      {/* Footer */}
      <div style={{
        padding: 'var(--space-3) var(--space-8)',
        borderTop: `1px solid var(--border-subtle)`,
        fontSize: 'var(--text-xs)',
        color: 'var(--text-tertiary)',
      }}>
        你的 API 密钥仅存储在本设备，绝不会发送到我们的服务器。
      </div>
    </div>
  );
};
