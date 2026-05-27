/**
 * Agent Utility Process entry point.
 *
 * Runs the pi-agent-core + pi-ai agent runtime in a dedicated process.
 * Communicates with the renderer via MessagePort for:
 *   - Receiving user messages
 *   - Forwarding agent events (state changes, chat messages, tool confirmations)
 *   - Handling confirmation responses from the user
 *
 * After M4 (Multi-Pet Manager): This module now hosts a PetManager instance
 * that manages multiple agent runtimes. The original single-agent flow (Chief)
 * is preserved for backward compatibility. When the renderer sends 'user-input',
 * it is delegated to the Chief pet. New 'pet-delegate' messages can target
 * any pet profile.
 */

import { MessagePortMain } from 'electron';
import { AgentState, AgentToRendererMessage, RendererToAgentMessage, MessageRole, PetStatus } from '../shared/types';
import { createAgentRuntime, AgentRuntime, AgentEventCallback, ConfirmationHandler } from './runtime';
import { PetManager } from './pet-manager';
import { setPetManagerForDelegation } from './tools/delegate';
import { setPetManagerForMessaging } from './tools/messaging';
import { setPetManagerForInbox } from './runtime';
import { setScheduleFireWithPriorityCallback } from './tools/registry';
import { TaskPriority } from './task-scheduler';
import { getDefaultProfile } from './profiles';
import { loadPlugins, getPluginSummaries, enablePlugin as loaderEnablePlugin, disablePlugin as loaderDisablePlugin, installPluginFromPath, uninstallPlugin, watchForChanges } from './plugins';
import { EventBus, AgentEvents } from './event-bus';
import { SessionStore } from '../storage/session-store';
import { Tracer } from './tracer';
import { SESSIONS_DB_FILENAME } from '../shared/constants';
import {
  loadWorkflows as loadWorkflowDefinitions,
  getWorkflowDefinitions,
  getWorkflow,
  watchForChanges as watchWorkflowChanges,
  WorkflowEngine,
} from './workflow';
import path from 'path';

let agentPort: MessagePortMain | null = null;
let agentRuntime: AgentRuntime | null = null;
let petManager: PetManager | null = null;
let eventBus: EventBus | null = null;
let sessionStore: SessionStore | null = null;
let tracer: Tracer | null = null;
let workflowEngine: WorkflowEngine | null = null;

/** Whether multi-pet mode is enabled */
let multiPetMode = false;

/** Pending confirmation promises keyed by toolCallId */
interface PendingConfirmation {
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}
const pendingConfirmations = new Map<string, PendingConfirmation>();

/**
 * Send a typed message to the renderer via MessagePort.
 */
function sendToRenderer(msg: AgentToRendererMessage): void {
  if (agentPort) {
    agentPort.postMessage(msg);
  }
}

/**
 * Handle an agent event from the runtime and convert it to renderer messages.
 */
function handleAgentEvent(event: Parameters<AgentEventCallback>[0]): void {
  switch (event.type) {
    case 'state-change':
      sendToRenderer({ type: 'state-change', state: event.state! });
      break;

    case 'chat-message':
      sendToRenderer({
        type: 'chat-message',
        message: {
          id: event.chatMessage!.id,
          role: event.chatMessage!.role === 'assistant' ? MessageRole.ASSISTANT : MessageRole.USER,
          content: event.chatMessage!.content,
          timestamp: Date.now(),
          streaming: event.chatMessage!.streaming,
        },
      });
      break;

    case 'chat-message-update':
      sendToRenderer({
        type: 'chat-message-update',
        id: event.chatDelta!.id,
        delta: event.chatDelta!.delta,
      });
      break;

    case 'chat-message-end':
      sendToRenderer({
        type: 'chat-message-end',
        id: event.chatEnd!.id,
      });
      break;

    case 'chat-thinking':
      sendToRenderer({
        type: 'chat-thinking',
        id: event.chatThinking!.id,
        delta: event.chatThinking!.delta,
      });
      break;

    case 'turn-indicator':
      sendToRenderer({
        type: 'turn-indicator',
        turn: event.turnIndicator!.turn,
        event: event.turnIndicator!.event,
      });
      break;

    case 'confirmation-request':
      sendToRenderer({
        type: 'confirmation-request',
        toolCallId: event.confirmationRequest!.toolCallId,
        toolName: event.confirmationRequest!.toolName,
        args: event.confirmationRequest!.args,
      });
      break;

    case 'tool-execution':
      sendToRenderer({
        type: 'tool-execution',
        toolCallId: event.toolExecution!.toolCallId,
        toolName: event.toolExecution!.toolName,
        status: event.toolExecution!.status as 'running' | 'done' | 'error',
        args: event.toolExecution!.args,
        partialResult: event.toolExecution!.partialResult,
        result: event.toolExecution!.result,
        duration: event.toolExecution!.duration,
      });
      break;

    case 'error':
      sendToRenderer({ type: 'error', message: event.error! });
      break;
  }
}

/**
 * Create the confirmation handler that sends requests to the renderer
 * and waits for responses via MessagePort.
 */
function createConfirmationHandler(): ConfirmationHandler {
  return (toolCallId: string, toolName: string, args: Record<string, unknown>): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      // Timeout after 5 minutes - auto-reject
      const timer = setTimeout(() => {
        if (pendingConfirmations.has(toolCallId)) {
          pendingConfirmations.delete(toolCallId);
          resolve(false);
        }
      }, 300000);

      pendingConfirmations.set(toolCallId, { resolve, timer });

      // Send confirmation request to renderer
      sendToRenderer({
        type: 'confirmation-request',
        toolCallId,
        toolName,
        args,
      });
    });
  };
}

/**
 * Initialize the legacy single-agent runtime (backward compatible).
 */
async function initLegacyAgent(): Promise<void> {
  try {
    agentRuntime = await createAgentRuntime(
      handleAgentEvent,
      createConfirmationHandler()
    );

    // Send initial greeting to the renderer
    sendToRenderer({ type: 'state-change', state: AgentState.IDLE });
    sendToRenderer({
      type: 'chat-message',
      message: {
        id: `greeting-${Date.now()}`,
        role: MessageRole.ASSISTANT,
        content: "Hi! I'm Clawd, your desktop AI assistant. Click on me and type a task to get started!",
        timestamp: Date.now(),
      },
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('Failed to initialize agent runtime:', errorMessage);
    sendToRenderer({ type: 'error', message: `Agent initialization failed: ${errorMessage}` });

    // Fall back to a basic echo mode so the user gets feedback
    sendToRenderer({ type: 'state-change', state: AgentState.IDLE });
    sendToRenderer({
      type: 'chat-message',
      message: {
        id: `fallback-${Date.now()}`,
        role: MessageRole.ASSISTANT,
        content: `I couldn't start the AI engine: ${errorMessage}. Please check your API key in Settings.`,
        timestamp: Date.now(),
      },
    });
  }
}

/**
 * Initialize the PetManager for multi-pet support.
 * The Chief agent is created on-demand when the first message arrives.
 */
async function initPetManager(): Promise<void> {
  eventBus = new EventBus();

  // Load plugins before creating any agent runtimes
  loadPlugins();
  watchForChanges();

  // Load workflow definitions from ~/.clawd/workflows/
  loadWorkflowDefinitions();
  watchWorkflowChanges();

  // Initialize SessionStore for conversation persistence
  const userDataPath = process.env.CLAWD_USER_DATA;
  if (userDataPath) {
    try {
      const dbPath = path.join(userDataPath, SESSIONS_DB_FILENAME);
      sessionStore = new SessionStore(dbPath, eventBus);
      sessionStore.pruneOldSessions();
      console.log('[agent-process] SessionStore initialized');

      // Initialize Tracer sharing the same database
      try {
        tracer = new Tracer(sessionStore.database, eventBus);
        tracer.pruneOldTraces();
        console.log('[agent-process] Tracer initialized');

        // Forward TRACE_COMPLETED events to the main process for real-time UI updates
        eventBus.on(AgentEvents.TRACE_COMPLETED, (payload) => {
          const p = payload as { traceId: string; status: string };
          sendToRenderer({ type: 'trace-completed', traceId: p.traceId, status: p.status });
        });
      } catch (err) {
        console.error('[agent-process] Failed to initialize Tracer:', err);
      }
    } catch (err) {
      console.error('[agent-process] Failed to initialize SessionStore:', err);
    }
  }

  petManager = new PetManager(
    handleAgentEvent,
    createConfirmationHandler(),
    // Status change callback: forward to renderer
    (petId: string, status: PetStatus) => {
      sendToRenderer({ type: 'pet-status', petId, status });
    },
    eventBus,
    sessionStore ?? undefined
  );

  petManager.startReaper();

  // Initialize WorkflowEngine with PetManager reference
  workflowEngine = new WorkflowEngine(petManager);

  // Inject PetManager into delegation tools so delegate_task can access it
  setPetManagerForDelegation(petManager);

  // Inject PetManager into messaging tools so send_message/check_inbox can access it
  setPetManagerForMessaging(petManager);

  // Inject PetManager into runtime for inbox notification in system prompts
  setPetManagerForInbox(petManager);

  // Wire up scheduled tasks to use priority-aware delegation via PetManager.
  // Cron fires now route through delegateWithPriority(scheduled) so user
  // messages always take priority.
  setScheduleFireWithPriorityCallback((prompt: string) => {
    const chiefProfile = getDefaultProfile();
    const pm = petManager;
    if (!pm) return;
    pm.delegateWithPriority(chiefProfile.id, prompt, TaskPriority.scheduled).catch((err: unknown) => {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`Scheduled task delegation failed: ${errorMessage}`);
    });
  });

  // Auto-create the Chief agent for backward compatibility
  try {
    const chiefProfile = getDefaultProfile();
    await petManager.ensure(chiefProfile.id); // Create agent without sending a prompt

    sendToRenderer({ type: 'state-change', state: AgentState.IDLE });
    sendToRenderer({
      type: 'chat-message',
      message: {
        id: `greeting-${Date.now()}`,
        role: MessageRole.ASSISTANT,
        content: "Hi! I'm Clawd, your desktop AI assistant. Click on me and type a task to get started!",
        timestamp: Date.now(),
      },
    });
  } catch (err: unknown) {
    // If Chief agent creation fails, the user might not have an API key yet.
    // Send a fallback message and let them try via settings.
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('Failed to initialize Chief agent via PetManager:', errorMessage);
    sendToRenderer({ type: 'error', message: `Agent initialization failed: ${errorMessage}` });
    sendToRenderer({ type: 'state-change', state: AgentState.IDLE });
    sendToRenderer({
      type: 'chat-message',
      message: {
        id: `fallback-${Date.now()}`,
        role: MessageRole.ASSISTANT,
        content: `I couldn't start the AI engine: ${errorMessage}. Please check your API key in Settings.`,
        timestamp: Date.now(),
      },
    });
  }
}

/**
 * Handle incoming messages from the renderer.
 */
function handleRendererMessage(msg: RendererToAgentMessage): void {
  switch (msg.type) {
    case 'ping': {
      sendToRenderer({ type: 'pong' });
      break;
    }

    case 'user-input': {
      handleUserInput(msg.text);
      break;
    }

    case 'confirmation-response': {
      const pending = pendingConfirmations.get(msg.toolCallId);
      if (pending) {
        clearTimeout(pending.timer);
        pendingConfirmations.delete(msg.toolCallId);
        pending.resolve(msg.approved);
      }
      break;
    }

    case 'abort': {
      handleAbort();
      break;
    }

    case 'pet-delegate': {
      handlePetDelegate(msg.petId, msg.prompt);
      break;
    }

    case 'pet-abort': {
      handlePetAbort(msg.petId);
      break;
    }

    case 'pet-status-request': {
      handlePetStatusRequest();
      break;
    }

    case 'profiles-updated': {
      handleProfilesUpdated();
      break;
    }

    case 'plugin-list': {
      const plugins = getPluginSummaries();
      sendToRenderer({ type: 'plugin-list-response', plugins });
      break;
    }

    case 'plugin-enable': {
      const success = loaderEnablePlugin(msg.name);
      sendToRenderer({ type: 'plugin-enable-response', name: msg.name, success });
      break;
    }

    case 'plugin-disable': {
      const success = loaderDisablePlugin(msg.name);
      sendToRenderer({ type: 'plugin-disable-response', name: msg.name, success });
      break;
    }

    case 'plugin-install': {
      const result = installPluginFromPath(msg.sourcePath);
      sendToRenderer({
        type: 'plugin-install-response',
        success: result.success,
        name: result.name,
        error: result.error,
      });
      break;
    }

    case 'plugin-uninstall': {
      const result = uninstallPlugin(msg.name);
      sendToRenderer({
        type: 'plugin-uninstall-response',
        name: msg.name,
        success: result.success,
        error: result.error,
      });
      break;
    }

    case 'session-branch': {
      handleSessionBranch(msg.petId, msg.branchPointSeq);
      break;
    }

    case 'session-create-checkpoint': {
      handleSessionCreateCheckpoint(msg.petId, msg.label);
      break;
    }

    case 'session-restore-checkpoint': {
      handleSessionRestoreCheckpoint(msg.petId, msg.checkpointId).catch((err: unknown) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error('[agent-process] session-restore-checkpoint error:', errMsg);
      });
      break;
    }

    case 'session-list-checkpoints': {
      handleSessionListCheckpoints(msg.petId);
      break;
    }

    case 'session-delete-checkpoint': {
      handleSessionDeleteCheckpoint(msg.checkpointId);
      break;
    }

    case 'session-export': {
      handleSessionExport(msg.petId, msg.includeCheckpoints);
      break;
    }

    case 'session-export-range': {
      handleSessionExportRange(msg.petId, msg.fromSeq, msg.toSeq);
      break;
    }

    case 'session-import': {
      handleSessionImport(msg.petId, msg.data);
      break;
    }

    case 'session-list-branches': {
      handleSessionListBranches(msg.petId);
      break;
    }

    case 'session-get-tree': {
      handleSessionGetTree(msg.petId);
      break;
    }

    case 'workflow:list': {
      handleWorkflowList();
      break;
    }

    case 'workflow:run': {
      handleWorkflowRun(msg.workflowName, msg.inputs).catch((err: unknown) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error('[agent-process] workflow:run error:', errMsg);
      });
      break;
    }

    case 'workflow:pause': {
      handleWorkflowPause(msg.runId);
      break;
    }

    case 'workflow:resume': {
      handleWorkflowResume(msg.runId);
      break;
    }

    case 'workflow:cancel': {
      handleWorkflowCancel(msg.runId);
      break;
    }

    case 'workflow:status': {
      handleWorkflowStatus(msg.runId);
      break;
    }

    case 'workflow:history': {
      handleWorkflowHistory();
      break;
    }

    case 'trace:list': {
      handleTraceList(msg.offset, msg.limit, msg.status, msg.petId);
      break;
    }

    case 'trace:detail': {
      handleTraceDetail(msg.traceId);
      break;
    }

    default: {
      const _exhaustive: never = msg;
      console.warn('Unknown message type from renderer:', (msg as Record<string, unknown>).type);
      break;
    }
  }
}

/**
 * Handle user input - send to Chief agent.
 * Supports both legacy single-agent mode and PetManager mode.
 */
async function handleUserInput(text: string): Promise<void> {
  if (multiPetMode && petManager) {
    // Multi-pet mode: delegate to Chief
    try {
      const chiefProfile = getDefaultProfile();

      // If Chief was marked for deferred rebuild, dispose now before delegating
      if (chiefNeedsRebuild) {
        petManager.dispose(chiefProfile.id);
        chiefNeedsRebuild = false;
      }

      // User direct input is always critical priority (PRD R1)
      await petManager.delegateWithPriority(chiefProfile.id, text, TaskPriority.critical);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      sendToRenderer({ type: 'error', message: errorMessage });
      sendToRenderer({ type: 'state-change', state: AgentState.IDLE });
    }
  } else if (agentRuntime) {
    // Legacy single-agent mode
    try {
      await agentRuntime.prompt(text);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      sendToRenderer({ type: 'error', message: errorMessage });
      sendToRenderer({ type: 'state-change', state: AgentState.IDLE });
    }
  } else {
    // Fallback echo mode when agent runtime failed to initialize
    sendToRenderer({ type: 'state-change', state: AgentState.GREETING });
    setTimeout(() => {
      sendToRenderer({ type: 'state-change', state: AgentState.THINKING });
      setTimeout(() => {
        sendToRenderer({ type: 'state-change', state: AgentState.IDLE });
        sendToRenderer({
          type: 'chat-message',
          message: {
            id: `echo-${Date.now()}`,
            role: MessageRole.ASSISTANT,
            content: `I heard you say: "${text}". Agent runtime is not available - please configure your API key.`,
            timestamp: Date.now(),
          },
        });
      }, 800);
    }, 500);
  }
}

/**
 * Handle abort message: stop the current agent run.
 */
function handleAbort(): void {
  if (multiPetMode && petManager) {
    const chiefProfile = getDefaultProfile();
    petManager.abort(chiefProfile.id);
  } else if (agentRuntime) {
    agentRuntime.abort();
  }
}

/**
 * Handle pet-delegate message: delegate a task to a specific pet.
 */
async function handlePetDelegate(petId: string, prompt: string): Promise<void> {
  console.log(`[agent-proc] handlePetDelegate(${petId}, "${prompt.slice(0, 60)}...")`);
  if (!petManager) {
    sendToRenderer({ type: 'error', message: 'PetManager not initialized' });
    return;
  }

  try {
    await petManager.delegate(petId, prompt);
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    sendToRenderer({ type: 'error', message: errorMessage });
  }
}

/**
 * Handle pet-abort message: abort a specific pet's current task.
 */
function handlePetAbort(petId: string): void {
  if (!petManager) {
    sendToRenderer({ type: 'error', message: 'PetManager not initialized' });
    return;
  }

  petManager.abort(petId);
}

/**
 * Handle pet-status-request message: return all pet statuses.
 */
function handlePetStatusRequest(): void {
  if (!petManager) {
    // Return just the Chief status based on legacy agent
    const chiefProfile = getDefaultProfile();
    sendToRenderer({
      type: 'pet-statuses',
      statuses: [{
        petId: chiefProfile.id,
        status: agentRuntime ? PetStatus.IDLE : PetStatus.OFFLINE,
        queueLength: 0,
        successCount: 0,
        errorCount: 0,
        lastActivity: Date.now(),
      }],
    });
    return;
  }

  const reports = petManager.getAllStatuses();
  sendToRenderer({ type: 'pet-statuses', statuses: reports });
}

/** Flag: Chief needs rebuild on next idle cycle */
let chiefNeedsRebuild = false;

/**
 * Handle profiles-updated: dispose Chief agent so it rebuilds with fresh specialist list.
 * If Chief is busy, defer until it becomes idle.
 */
function handleProfilesUpdated(): void {
  if (!petManager) return;

  const chiefProfile = getDefaultProfile();
  const chiefId = chiefProfile.id;
  const managed = petManager.getAllStatuses().find((s) => s.petId === chiefId);

  if (!managed || managed.status === 'offline') {
    // Chief not alive — nothing to dispose, next ensure() will create fresh
    return;
  }

  if (managed.queueLength > 0) {
    // Chief is busy — mark for deferred rebuild
    chiefNeedsRebuild = true;
    return;
  }

  // Chief is idle — dispose now, next user message triggers ensure() with fresh config
  petManager.dispose(chiefId);
  chiefNeedsRebuild = false;
}

// ---------------------------------------------------------------------------
// Session branching / checkpoint / export handlers
// ---------------------------------------------------------------------------

function handleSessionBranch(petId: string, branchPointSeq: number): void {
  if (!petManager) {
    sendToRenderer({ type: 'session-branch-response', success: false, error: 'PetManager not initialized' });
    return;
  }

  try {
    const newSessionId = petManager.branchSession(petId, branchPointSeq);
    if (newSessionId) {
      sendToRenderer({ type: 'session-branch-response', success: true, sessionId: newSessionId });
    } else {
      sendToRenderer({ type: 'session-branch-response', success: false, error: 'No active session found' });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    sendToRenderer({ type: 'session-branch-response', success: false, error: msg });
  }
}

function handleSessionCreateCheckpoint(petId: string, label?: string): void {
  if (!petManager) {
    sendToRenderer({ type: 'session-checkpoint-response', success: false, error: 'PetManager not initialized' });
    return;
  }

  try {
    const checkpointId = petManager.createCheckpoint(petId, label);
    if (checkpointId) {
      sendToRenderer({ type: 'session-checkpoint-response', success: true, checkpointId });
    } else {
      sendToRenderer({ type: 'session-checkpoint-response', success: false, error: 'No active session found' });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    sendToRenderer({ type: 'session-checkpoint-response', success: false, error: msg });
  }
}

async function handleSessionRestoreCheckpoint(petId: string, checkpointId: string): Promise<void> {
  if (!petManager) {
    sendToRenderer({ type: 'session-restore-checkpoint-response', success: false, error: 'PetManager not initialized' });
    return;
  }

  try {
    const newSessionId = await petManager.restoreCheckpoint(petId, checkpointId);
    if (newSessionId) {
      sendToRenderer({ type: 'session-restore-checkpoint-response', success: true, sessionId: newSessionId });
    } else {
      sendToRenderer({ type: 'session-restore-checkpoint-response', success: false, error: 'Restore failed' });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    sendToRenderer({ type: 'session-restore-checkpoint-response', success: false, error: msg });
  }
}

function handleSessionListCheckpoints(petId: string): void {
  if (!petManager) {
    sendToRenderer({ type: 'session-checkpoints-list', checkpoints: [] });
    return;
  }

  const checkpoints = petManager.getCheckpoints(petId);
  sendToRenderer({ type: 'session-checkpoints-list', checkpoints });
}

function handleSessionDeleteCheckpoint(checkpointId: string): void {
  if (!petManager) {
    sendToRenderer({ type: 'session-delete-checkpoint-response', success: false, error: 'PetManager not initialized' });
    return;
  }

  const success = petManager.deleteCheckpoint(checkpointId);
  sendToRenderer({ type: 'session-delete-checkpoint-response', success });
}

function handleSessionExport(petId: string, includeCheckpoints?: boolean): void {
  if (!petManager) {
    sendToRenderer({ type: 'session-export-response', data: null, error: 'PetManager not initialized' });
    return;
  }

  const data = petManager.exportSession(petId, { includeCheckpoints });
  if (data) {
    sendToRenderer({ type: 'session-export-response', data });
  } else {
    sendToRenderer({ type: 'session-export-response', data: null, error: 'No active session found' });
  }
}

function handleSessionExportRange(petId: string, fromSeq: number, toSeq: number): void {
  if (!petManager) {
    sendToRenderer({ type: 'session-export-response', data: null, error: 'PetManager not initialized' });
    return;
  }

  const data = petManager.exportSessionRange(petId, fromSeq, toSeq);
  if (data) {
    sendToRenderer({ type: 'session-export-response', data });
  } else {
    sendToRenderer({ type: 'session-export-response', data: null, error: 'No active session found' });
  }
}

function handleSessionImport(petId: string, data: import('../shared/types').ExportedSession): void {
  if (!petManager) {
    sendToRenderer({ type: 'session-import-response', success: false, error: 'PetManager not initialized' });
    return;
  }

  const sessionId = petManager.importSession(petId, data);
  if (sessionId) {
    sendToRenderer({ type: 'session-import-response', success: true, sessionId });
  } else {
    sendToRenderer({ type: 'session-import-response', success: false, error: 'Import failed' });
  }
}

function handleSessionListBranches(petId: string): void {
  if (!petManager) {
    sendToRenderer({ type: 'session-branches-list', branches: [] });
    return;
  }

  const branches = petManager.getSessionBranches(petId);
  sendToRenderer({ type: 'session-branches-list', branches });
}

function handleSessionGetTree(petId: string): void {
  if (!petManager) {
    sendToRenderer({ type: 'session-tree', tree: [] });
    return;
  }

  const tree = petManager.getSessionTree(petId);
  sendToRenderer({ type: 'session-tree', tree });
}

// ---------------------------------------------------------------------------
// Workflow handlers
// ---------------------------------------------------------------------------

function handleWorkflowList(): void {
  const definitions = getWorkflowDefinitions();
  sendToRenderer({ type: 'workflow-list-response', workflows: definitions });
}

async function handleWorkflowRun(workflowName: string, inputs: Record<string, unknown>): Promise<void> {
  if (!workflowEngine) {
    sendToRenderer({ type: 'workflow-run-response', runId: '', success: false, error: 'WorkflowEngine not initialized' });
    return;
  }

  const definition = getWorkflow(workflowName);
  if (!definition) {
    sendToRenderer({ type: 'workflow-run-response', runId: '', success: false, error: `Workflow "${workflowName}" not found` });
    return;
  }

  try {
    const runId = workflowEngine.run(definition, inputs);
    sendToRenderer({ type: 'workflow-run-response', runId, success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    sendToRenderer({ type: 'workflow-run-response', runId: '', success: false, error: msg });
  }
}

function handleWorkflowPause(runId: string): void {
  if (!workflowEngine) {
    sendToRenderer({ type: 'workflow-pause-response', runId, success: false, error: 'WorkflowEngine not initialized' });
    return;
  }

  try {
    workflowEngine.pause(runId);
    sendToRenderer({ type: 'workflow-pause-response', runId, success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    sendToRenderer({ type: 'workflow-pause-response', runId, success: false, error: msg });
  }
}

function handleWorkflowResume(runId: string): void {
  if (!workflowEngine) {
    sendToRenderer({ type: 'workflow-resume-response', runId, success: false, error: 'WorkflowEngine not initialized' });
    return;
  }

  const run = workflowEngine.getStatus(runId);
  if (!run) {
    sendToRenderer({ type: 'workflow-resume-response', runId, success: false, error: 'Run not found' });
    return;
  }

  const definition = getWorkflow(run.workflowName);
  if (!definition) {
    sendToRenderer({ type: 'workflow-resume-response', runId, success: false, error: 'Workflow definition not found' });
    return;
  }

  try {
    workflowEngine.resume(runId, definition);
    sendToRenderer({ type: 'workflow-resume-response', runId, success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    sendToRenderer({ type: 'workflow-resume-response', runId, success: false, error: msg });
  }
}

function handleWorkflowCancel(runId: string): void {
  if (!workflowEngine) {
    sendToRenderer({ type: 'workflow-cancel-response', runId, success: false, error: 'WorkflowEngine not initialized' });
    return;
  }

  try {
    workflowEngine.cancel(runId);
    sendToRenderer({ type: 'workflow-cancel-response', runId, success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    sendToRenderer({ type: 'workflow-cancel-response', runId, success: false, error: msg });
  }
}

function handleWorkflowStatus(runId: string): void {
  if (!workflowEngine) {
    sendToRenderer({ type: 'workflow-status-response', run: null });
    return;
  }

  const snapshot = workflowEngine.getRunSnapshot(runId);
  sendToRenderer({ type: 'workflow-status-response', run: snapshot });
}

function handleWorkflowHistory(): void {
  if (!workflowEngine) {
    sendToRenderer({ type: 'workflow-history-response', runs: [] });
    return;
  }

  const snapshots = workflowEngine.listRunSnapshots();
  sendToRenderer({ type: 'workflow-history-response', runs: snapshots });
}

// ---------------------------------------------------------------------------
// Trace handlers
// ---------------------------------------------------------------------------

function handleTraceList(offset: number, limit: number, status?: string, petId?: string): void {
  if (!tracer) {
    sendToRenderer({ type: 'trace-list-response', traces: [], total: 0 });
    return;
  }

  const result = tracer.listTraces({ offset, limit, status, petId });
  sendToRenderer({ type: 'trace-list-response', traces: result.traces, total: result.total });
}

function handleTraceDetail(traceId: string): void {
  if (!tracer) {
    sendToRenderer({ type: 'trace-detail-response', detail: null });
    return;
  }

  const detail = tracer.getTraceDetail(traceId);
  sendToRenderer({ type: 'trace-detail-response', detail });
}

/**
 * Initialize the agent process.
 * Listens for the MessagePort from the main process, then starts the agent runtime.
 *
 * Supports an 'init' message for legacy mode and 'init-multi-pet' for PetManager mode.
 */
process.parentPort.on('message', (event: unknown) => {
  const msgEvent = event as { data: { type: string }; ports: MessagePortMain[] };
  const msg = msgEvent.data;

  if (msg.type === 'init' || msg.type === 'init-multi-pet') {
    const [port] = msgEvent.ports;
    if (port) {
      agentPort = port;
      agentPort.on('message', (portEvent: unknown) => {
        const data = (portEvent as { data: unknown }).data;
        handleRendererMessage(data as RendererToAgentMessage);
      });
      agentPort.start();

      // Determine mode from init message
      multiPetMode = msg.type === 'init-multi-pet';

      // Initialize the appropriate runtime
      if (multiPetMode) {
        initPetManager().catch((err: unknown) => {
          console.error('Unhandled error in PetManager init:', err);
        });
      } else {
        initLegacyAgent().catch((err: unknown) => {
          console.error('Unhandled error in agent init:', err);
        });
      }
    }
  }
});
