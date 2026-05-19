/**
 * Browser automation tool for the Clawd agent.
 *
 * Uses agent-browser CLI for browser automation. agent-browser manages
 * its own browser lifecycle — we just tell it which executable to use
 * (user's Edge/Chrome) and it handles the rest.
 *
 * Provides a single `browser_action` tool with sub-actions:
 *   - snapshot: Get accessibility tree with element refs
 *   - open: Navigate to a URL
 *   - click: Click an element by ref
 *   - type: Type text into an element by ref
 *   - screenshot: Capture a screenshot as base64
 *   - get_text: Get text content of the page
 *   - scroll: Scroll the page up or down
 *   - hover: Hover over an element by ref
 *   - go_back / go_forward: Browser history navigation
 *
 * Selector model: Agent calls `snapshot` first to discover elements and
 * their refs (@e1, @e2, ...), then uses those refs for click/type/hover.
 */

import { Type } from 'typebox';
import { findBrowserPath } from './browser-launch';
import {
  setBrowserExecutablePath,
  shutdownDaemon,
  openUrl,
  snapshot,
  clickElement,
  fillElement,
  screenshot as takeScreenshot,
  getText,
  scroll as scrollPage,
  hoverElement,
  goBack,
  goForward,
} from './agent-browser-client';
import { readConfig } from '../../config/config-store';

// ---------------------------------------------------------------------------
// Type aliases for pi-agent-core types
// ---------------------------------------------------------------------------
type PiAgentTool = import('@earendil-works/pi-agent-core').AgentTool;
type PiAgentToolResult = import('@earendil-works/pi-agent-core').AgentToolResult<unknown>;
type PiAgentToolUpdateCallback = import('@earendil-works/pi-agent-core').AgentToolUpdateCallback<unknown>;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let browserReady = false;

// ---------------------------------------------------------------------------
// Helper: build result objects
// ---------------------------------------------------------------------------
function textResult(text: string, details?: Record<string, unknown>): PiAgentToolResult {
  return {
    content: [{ type: 'text' as const, text }],
    details: details ?? {},
  };
}

function errorResult(message: string, details?: Record<string, unknown>): PiAgentToolResult {
  return {
    content: [{ type: 'text' as const, text: message }],
    details: { error: true, ...details },
  };
}

// ---------------------------------------------------------------------------
// Action type
// ---------------------------------------------------------------------------

const BROWSER_ACTIONS = [
  'snapshot',
  'open',
  'click',
  'type',
  'screenshot',
  'get_text',
  'scroll',
  'hover',
  'go_back',
  'go_forward',
] as const;

type BrowserAction = (typeof BROWSER_ACTIONS)[number];

interface BrowserActionParams {
  action: BrowserAction;
  url?: string;
  ref?: string;
  text?: string;
  direction?: 'up' | 'down';
}

// ---------------------------------------------------------------------------
// Browser readiness
// ---------------------------------------------------------------------------

/**
 * One-time setup: find the user's browser and tell agent-browser to use it.
 *
 * agent-browser manages its own browser lifecycle. We only need to:
 * 1. Find Edge or Chrome on the system
 * 2. Set AGENT_BROWSER_EXECUTABLE_PATH so agent-browser uses the user's browser
 *    instead of its bundled Chrome v148
 */
async function ensureBrowserReady(_signal?: AbortSignal): Promise<void> {
  if (browserReady) {
    return;
  }

  const config = readConfig();
  const configuredChromePath = config.browser?.chromePath || undefined;

  const browserPath = findBrowserPath(configuredChromePath);
  console.log(`[browser-tool] ensureBrowserReady: found browser at "${browserPath ?? 'NONE'}"`);

  if (browserPath) {
    setBrowserExecutablePath(browserPath);
    console.log(`[browser-tool] set executable path: ${browserPath}`);
  } else {
    console.log(`[browser-tool] no local browser found, agent-browser will use its bundled Chrome`);
  }

  browserReady = true;
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

/**
 * Handle the 'snapshot' action.
 * Returns the accessibility tree with element refs.
 */
async function handleSnapshot(
  signal?: AbortSignal
): Promise<PiAgentToolResult> {
  try {
    const result = await snapshot({ signal });
    const refCount = Object.keys(result.refs).length;
    return textResult(
      `Page snapshot captured. Found ${refCount} interactive elements.\n\n` +
      `Accessibility tree:\n${result.snapshot}\n\n` +
      `Element refs: ${Object.entries(result.refs)
        .map(([ref, el]) => `${ref}: [${el.role}] "${el.name}"`)
        .join('\n')}`,
      { refCount, refs: result.refs }
    );
  } catch (err: unknown) {
    if (signal?.aborted) {
      return errorResult('Snapshot aborted by user.');
    }
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(`Failed to take snapshot: ${message}`);
  }
}

/**
 * Handle the 'open' action (navigate to URL).
 */
async function handleOpen(
  params: BrowserActionParams,
  signal?: AbortSignal
): Promise<PiAgentToolResult> {
  if (!params.url) {
    return errorResult('The "url" parameter is required for the open action.');
  }

  try {
    const result = await openUrl(params.url, { signal });
    return textResult(
      `Navigated to ${params.url}.`,
      { url: params.url, success: result.success }
    );
  } catch (err: unknown) {
    if (signal?.aborted) {
      return errorResult('Navigation aborted by user.');
    }
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(`Failed to navigate to "${params.url}": ${message}`);
  }
}

/**
 * Handle the 'click' action.
 * Uses element ref from a previous snapshot.
 */
async function handleClick(
  params: BrowserActionParams,
  signal?: AbortSignal
): Promise<PiAgentToolResult> {
  if (!params.ref) {
    return errorResult(
      'The "ref" parameter is required for the click action. ' +
      'Call "snapshot" first to discover element refs (e.g., "@e3").'
    );
  }

  try {
    const result = await clickElement(params.ref, { signal });
    return textResult(
      `Clicked element ${params.ref}.`,
      { ref: params.ref, success: result.success }
    );
  } catch (err: unknown) {
    if (signal?.aborted) {
      return errorResult('Click aborted by user.');
    }
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(`Failed to click ${params.ref}: ${message}`);
  }
}

/**
 * Handle the 'type' action.
 * Uses element ref from a previous snapshot.
 */
async function handleType(
  params: BrowserActionParams,
  signal?: AbortSignal
): Promise<PiAgentToolResult> {
  if (!params.ref) {
    return errorResult(
      'The "ref" parameter is required for the type action. ' +
      'Call "snapshot" first to discover element refs (e.g., "@e5").'
    );
  }
  if (params.text === undefined || params.text === null) {
    return errorResult('The "text" parameter is required for the type action.');
  }

  try {
    const result = await fillElement(params.ref, params.text, { signal });
    return textResult(
      `Typed text into element ${params.ref}.`,
      { ref: params.ref, text_length: params.text.length, success: result.success }
    );
  } catch (err: unknown) {
    if (signal?.aborted) {
      return errorResult('Type action aborted by user.');
    }
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(`Failed to type into ${params.ref}: ${message}`);
  }
}

/**
 * Handle the 'screenshot' action.
 * Returns a base64-encoded PNG image as ImageContent.
 */
async function handleScreenshot(
  signal?: AbortSignal
): Promise<PiAgentToolResult> {
  try {
    const base64 = await takeScreenshot({ signal });
    if (!base64) {
      return errorResult('Screenshot returned empty data.');
    }

    return {
      content: [
        {
          type: 'image' as const,
          data: base64,
          mimeType: 'image/png',
        },
      ],
      details: { action: 'screenshot' },
    };
  } catch (err: unknown) {
    if (signal?.aborted) {
      return errorResult('Screenshot aborted by user.');
    }
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(`Failed to take screenshot: ${message}`);
  }
}

/**
 * Handle the 'get_text' action.
 * Returns the text content of the page.
 */
async function handleGetText(
  signal?: AbortSignal
): Promise<PiAgentToolResult> {
  try {
    const content = await getText({ signal });

    // Truncate very long content to avoid overwhelming the LLM context
    const maxLength = 10000;
    const truncated = content.length > maxLength
      ? content.substring(0, maxLength) + '\n\n... (content truncated)'
      : content;

    return textResult(truncated, {
      content_length: content.length,
      truncated: content.length > maxLength,
    });
  } catch (err: unknown) {
    if (signal?.aborted) {
      return errorResult('Get text aborted by user.');
    }
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(`Failed to get page text: ${message}`);
  }
}

/**
 * Handle the 'scroll' action.
 */
async function handleScroll(
  params: BrowserActionParams,
  signal?: AbortSignal
): Promise<PiAgentToolResult> {
  const direction = params.direction || 'down';
  try {
    const result = await scrollPage(direction, { signal });
    return textResult(
      `Scrolled ${direction}.`,
      { direction, success: result.success }
    );
  } catch (err: unknown) {
    if (signal?.aborted) {
      return errorResult('Scroll aborted by user.');
    }
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(`Failed to scroll ${direction}: ${message}`);
  }
}

/**
 * Handle the 'hover' action.
 * Uses element ref from a previous snapshot.
 */
async function handleHover(
  params: BrowserActionParams,
  signal?: AbortSignal
): Promise<PiAgentToolResult> {
  if (!params.ref) {
    return errorResult(
      'The "ref" parameter is required for the hover action. ' +
      'Call "snapshot" first to discover element refs (e.g., "@e3").'
    );
  }

  try {
    const result = await hoverElement(params.ref, { signal });
    return textResult(
      `Hovered over element ${params.ref}.`,
      { ref: params.ref, success: result.success }
    );
  } catch (err: unknown) {
    if (signal?.aborted) {
      return errorResult('Hover aborted by user.');
    }
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(`Failed to hover over ${params.ref}: ${message}`);
  }
}

/**
 * Handle the 'go_back' action.
 */
async function handleGoBack(signal?: AbortSignal): Promise<PiAgentToolResult> {
  try {
    const result = await goBack({ signal });
    return textResult('Navigated back.', { success: result.success });
  } catch (err: unknown) {
    if (signal?.aborted) {
      return errorResult('Go back aborted by user.');
    }
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(`Failed to go back: ${message}`);
  }
}

/**
 * Handle the 'go_forward' action.
 */
async function handleGoForward(signal?: AbortSignal): Promise<PiAgentToolResult> {
  try {
    const result = await goForward({ signal });
    return textResult('Navigated forward.', { success: result.success });
  } catch (err: unknown) {
    if (signal?.aborted) {
      return errorResult('Go forward aborted by user.');
    }
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(`Failed to go forward: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Browser action tool
// ---------------------------------------------------------------------------

/**
 * Build the browser_action tool definition.
 *
 * Uses agent-browser CLI for browser automation. The agent first calls
 * `snapshot` to discover interactive elements and their refs, then uses
 * those refs for click/type/hover actions.
 */
export function buildBrowserTool(): PiAgentTool[] {
  return [
    {
      name: 'browser_action',
      label: 'Browser Action',
      description:
        'Automate the user web browser (Chrome or Edge) via agent-browser CLI. ' +
        'Actions: snapshot (get accessibility tree with element refs), ' +
        'open (navigate to URL), click (click element by ref), ' +
        'type (enter text by ref), screenshot (capture page image), ' +
        'get_text (read page text), scroll (scroll page), ' +
        'hover (hover over element by ref), go_back / go_forward (navigate history). ' +
        'IMPORTANT: Before using click/type/hover, call "snapshot" first to discover ' +
        'element refs (e.g., @e1, @e2). Then use those refs as the "ref" parameter. ' +
        'Each action requires user confirmation before executing.',
      parameters: Type.Object({
        action: Type.Union([
          Type.Literal('snapshot'),
          Type.Literal('open'),
          Type.Literal('click'),
          Type.Literal('type'),
          Type.Literal('screenshot'),
          Type.Literal('get_text'),
          Type.Literal('scroll'),
          Type.Literal('hover'),
          Type.Literal('go_back'),
          Type.Literal('go_forward'),
        ], { description: 'The browser action to perform' }),
        url: Type.Optional(Type.String({
          description: 'URL to navigate to (required for "open" action)',
        })),
        ref: Type.Optional(Type.String({
          description: 'Element ref from snapshot (e.g., "@e3"). Required for click/type/hover actions.',
        })),
        text: Type.Optional(Type.String({
          description: 'Text to type into the selected element (required for "type" action)',
        })),
        direction: Type.Optional(Type.Union([
          Type.Literal('up'),
          Type.Literal('down'),
        ], {
          description: 'Scroll direction (for "scroll" action). Default: down',
        })),
      }),
      execute: async (
        _toolCallId: string,
        params: unknown,
        signal?: AbortSignal,
        _onUpdate?: PiAgentToolUpdateCallback
      ): Promise<PiAgentToolResult> => {
        const typedParams = params as BrowserActionParams;

        console.log(`[browser-tool] execute: action=${typedParams.action}, params=${JSON.stringify(typedParams)}`);

        // Check abort signal early
        if (signal?.aborted) {
          return errorResult('Browser action aborted before execution.');
        }

        // One-time setup: find browser executable
        try {
          await ensureBrowserReady(signal);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.log(`[browser-tool] execute: ensureBrowserReady FAILED — ${message}`);
          return errorResult(`Browser setup failed: ${message}`);
        }

        // Dispatch to action handler
        switch (typedParams.action) {
          case 'snapshot':
            return handleSnapshot(signal);
          case 'open':
            return handleOpen(typedParams, signal);
          case 'click':
            return handleClick(typedParams, signal);
          case 'type':
            return handleType(typedParams, signal);
          case 'screenshot':
            return handleScreenshot(signal);
          case 'get_text':
            return handleGetText(signal);
          case 'scroll':
            return handleScroll(typedParams, signal);
          case 'hover':
            return handleHover(typedParams, signal);
          case 'go_back':
            return handleGoBack(signal);
          case 'go_forward':
            return handleGoForward(signal);
          default:
            return errorResult(
              `Unknown browser action: "${String(typedParams.action)}". ` +
              'Supported: snapshot, open, click, type, screenshot, get_text, scroll, hover, go_back, go_forward.'
            );
        }
      },
    },
  ];
}

/**
 * Shut down the agent-browser daemon.
 * Call this on app exit to clean up the Rust daemon process.
 */
export { shutdownDaemon };
