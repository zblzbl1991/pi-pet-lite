/**
 * Agent Utility Process entry point.
 *
 * This is a PLACEHOLDER for PR1. It sets up the MessagePort listener
 * and responds to basic ping/echo messages.
 * Full agent runtime (pi-agent-core + pi-ai) integration comes in PR2.
 */
import { MessagePortMain } from 'electron';
import { AgentState, AgentToRendererMessage, RendererToAgentMessage, MessageRole } from '../shared/types';

let agentPort: MessagePortMain | null = null;

/** Current agent state */
let currentState: AgentState = AgentState.IDLE;

/**
 * Send a message to the renderer via MessagePort.
 */
function sendToRenderer(msg: AgentToRendererMessage): void {
  if (agentPort) {
    agentPort.postMessage(msg);
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
      // Placeholder: acknowledge user input and echo back
      // In PR2, this will go through pi-agent-core tool calling
      handleUserInput(msg.text);
      break;
    }
    case 'confirm-tool': {
      // Placeholder for PR3 tool confirmation
      break;
    }
    default: {
      // Exhaustive check at compile time; ignore unknown messages at runtime
      const _exhaustive: never = msg;
      console.warn('Unknown message type from renderer:', (msg as Record<string, unknown>).type);
      break;
    }
  }
}

/**
 * Placeholder user input handler.
 * In PR2 this will use pi-agent-core + pi-ai for real agent logic.
 */
function handleUserInput(text: string): void {
  // Simulate: GREETING -> THINKING -> IDLE with a response
  currentState = AgentState.GREETING;
  sendToRenderer({ type: 'state-change', state: currentState });

  setTimeout(() => {
    currentState = AgentState.THINKING;
    sendToRenderer({ type: 'state-change', state: currentState });

    setTimeout(() => {
      // Echo back a placeholder response
      currentState = AgentState.IDLE;
      sendToRenderer({ type: 'state-change', state: currentState });

      sendToRenderer({
        type: 'chat-message',
        message: {
          id: `agent-${Date.now()}`,
          role: MessageRole.AGENT,
          content: `I heard you say: "${text}". Agent runtime coming in PR2!`,
          timestamp: Date.now(),
        },
      });
    }, 1000);
  }, 800);
}

/**
 * Initialize the agent process.
 * Listens for the MessagePort from the main process.
 */
process.parentPort.on('message', (event: unknown) => {
  const msgEvent = event as { data: { type: string }; ports: MessagePortMain[] };
  const msg = msgEvent.data;

  if (msg.type === 'init') {
    // The MessagePort is transferred via event.ports
    const [port] = msgEvent.ports;
    if (port) {
      agentPort = port;
      agentPort.on('message', (portEvent: unknown) => {
        const data = (portEvent as { data: unknown }).data;
        handleRendererMessage(data as RendererToAgentMessage);
      });
      agentPort.start();

      // Send initial state to renderer
      sendToRenderer({ type: 'state-change', state: currentState });
      sendToRenderer({
        type: 'chat-message',
        message: {
          id: `agent-greeting-${Date.now()}`,
          role: MessageRole.AGENT,
          content: "Hi! I'm Clawd. Click on me to give me a task!",
          timestamp: Date.now(),
        },
      });
    }
  }
});
