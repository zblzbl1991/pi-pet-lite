/**
 * Browser automation tool for the Clawd agent.
 *
 * Connects to the user's existing Chrome or Edge browser via CDP
 * (Chrome DevTools Protocol) using Playwright. No browser binary
 * is bundled; the tool reuses the browser already installed on the system.
 *
 * Provides a single `browser_action` tool with sub-actions:
 *   - navigate: Go to a URL
 *   - click: Click an element by CSS selector or text
 *   - type: Type text into an input field
 *   - screenshot: Capture a screenshot as base64
 *   - get_content: Get text content of the page or a specific element
 *   - go_back / go_forward: Browser history navigation
 *
 * Trust level: CONFIRM_STEP (each action needs user confirmation).
 * Uses dynamic import() for Playwright (ESM-only in recent versions).
 */

import { Type } from 'typebox';
import { findBrowserPath, launchBrowserWithCDP } from './browser-launch';
import { readConfig } from '../../config/config-store';

// ---------------------------------------------------------------------------
// Type aliases for pi-agent-core types
// ---------------------------------------------------------------------------
type PiAgentTool = import('@earendil-works/pi-agent-core').AgentTool;
type PiAgentToolResult = import('@earendil-works/pi-agent-core').AgentToolResult<unknown>;
type PiAgentToolUpdateCallback = import('@earendil-works/pi-agent-core').AgentToolUpdateCallback<unknown>;

// ---------------------------------------------------------------------------
// Playwright types (resolved at runtime via dynamic import)
// ---------------------------------------------------------------------------
type PlaywrightBrowser = import('playwright').Browser;
type PlaywrightBrowserContext = import('playwright').BrowserContext;
type PlaywrightPage = import('playwright').Page;

// ---------------------------------------------------------------------------
// Singleton browser connection
// ---------------------------------------------------------------------------
let browserConnection: PlaywrightBrowser | null = null;
let lastCdpPort: number | null = null;
let playwrightModule: typeof import('playwright') | null = null;

/**
 * Dynamically import Playwright (ESM-only in recent versions).
 * Caches the module reference after first import.
 */
async function loadPlaywright(): Promise<typeof import('playwright')> {
  if (!playwrightModule) {
    playwrightModule = await import('playwright');
  }
  return playwrightModule;
}

/**
 * Get or establish a CDP connection to the user's browser.
 *
 * Strategy:
 * 1. Reuse existing connection if still alive.
 * 2. Try connecting to an already-running browser on the CDP port.
 * 3. If nothing is listening, find and launch Chrome/Edge with CDP,
 *    then connect.
 *
 * Returns the connected Browser instance.
 */
async function getOrConnectBrowser(): Promise<PlaywrightBrowser> {
  const config = readConfig();
  const cdpPort = config.browser?.cdpPort || 9222;
  const configuredChromePath = config.browser?.chromePath || undefined;

  // Reuse existing connection if still connected AND port hasn't changed
  if (browserConnection && browserConnection.isConnected() && lastCdpPort === cdpPort) {
    return browserConnection;
  }

  // Port changed — discard stale reference (do NOT close: that would kill the user's browser)
  browserConnection = null;
  lastCdpPort = cdpPort;

  const pw = await loadPlaywright();

  // Try connecting to a browser already listening on the CDP port
  try {
    browserConnection = await pw.chromium.connectOverCDP(
      `http://localhost:${cdpPort}`
    );
    // Handle disconnection (user closed browser)
    browserConnection.on('disconnected', () => {
      browserConnection = null;
    });
    return browserConnection;
  } catch {
    // No browser listening on CDP port - will try launching one below
  }

  // Find a browser on the system
  const browserPath = findBrowserPath(configuredChromePath);
  if (!browserPath) {
    throw new Error(
      'No Chrome or Edge browser found on this system. ' +
      'Please install Chrome or Edge, or start your browser with ' +
      `--remote-debugging-port=${cdpPort} and try again.`
    );
  }

  // Launch browser with CDP enabled
  const { cdpReady } = await launchBrowserWithCDP(browserPath, cdpPort);
  if (!cdpReady) {
    throw new Error(
      `Launched browser at "${browserPath}" but CDP port ${cdpPort} ` +
      'did not become available in time. The browser may already be running. ' +
      'Try closing all browser windows and retrying.'
    );
  }

  // Connect to the newly launched browser
  browserConnection = await pw.chromium.connectOverCDP(
    `http://localhost:${cdpPort}`
  );

  // Handle disconnection (user closed browser)
  browserConnection.on('disconnected', () => {
    browserConnection = null;
  });

  return browserConnection;
}

/**
 * Get a page to operate on.
 *
 * If connected to a user's browser, uses the first context's first page.
 * If no pages exist, creates a new one. Does not close existing tabs.
 */
async function getOrCreatePage(browser: PlaywrightBrowser): Promise<PlaywrightPage> {
  const contexts = browser.contexts();
  if (contexts.length > 0) {
    const context: PlaywrightBrowserContext = contexts[0];
    const pages = context.pages();
    if (pages.length > 0) {
      return pages[0];
    }
    return await context.newPage();
  }
  // Should not happen with CDP connections (always at least one context),
  // but handle gracefully.
  const context = await browser.newContext();
  return await context.newPage();
}

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
// Action handlers
// ---------------------------------------------------------------------------

interface BrowserActionParams {
  action: 'navigate' | 'click' | 'type' | 'screenshot' | 'get_content' | 'go_back' | 'go_forward';
  url?: string;
  selector?: string;
  text?: string;
  selector_type?: 'css' | 'text';
}

/**
 * Handle the 'navigate' action.
 */
async function handleNavigate(
  page: PlaywrightPage,
  params: BrowserActionParams,
  signal?: AbortSignal
): Promise<PiAgentToolResult> {
  if (!params.url) {
    return errorResult('The "url" parameter is required for the navigate action.');
  }

  try {
    const response = await page.goto(params.url, {
      timeout: 30000,
      waitUntil: 'domcontentloaded',
    });
    const httpStatus = response?.status();
    const finalUrl = page.url();
    const statusLabel = httpStatus !== undefined ? String(httpStatus) : 'unknown';
    return textResult(
      `Navigated to ${finalUrl} (HTTP ${statusLabel}).`,
      { url: finalUrl, httpStatus: httpStatus ?? null }
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
 */
async function handleClick(
  page: PlaywrightPage,
  params: BrowserActionParams
): Promise<PiAgentToolResult> {
  if (!params.selector) {
    return errorResult('The "selector" parameter is required for the click action.');
  }

  try {
    const locator = params.selector_type === 'text'
      ? page.getByText(params.selector, { exact: false })
      : page.locator(params.selector);

    await locator.first().click({ timeout: 10000 });
    return textResult(
      `Clicked element: "${params.selector}".`,
      { selector: params.selector, selector_type: params.selector_type ?? 'css' }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(`Failed to click "${params.selector}": ${message}`);
  }
}

/**
 * Handle the 'type' action.
 */
async function handleType(
  page: PlaywrightPage,
  params: BrowserActionParams
): Promise<PiAgentToolResult> {
  if (!params.selector) {
    return errorResult('The "selector" parameter is required for the type action.');
  }
  if (params.text === undefined || params.text === null) {
    return errorResult('The "text" parameter is required for the type action.');
  }

  try {
    const locator = params.selector_type === 'text'
      ? page.getByText(params.selector, { exact: false })
      : page.locator(params.selector);

    // Click to focus, then clear existing content and type
    await locator.first().click({ timeout: 10000 });
    await locator.first().fill('');
    await locator.first().fill(params.text);

    return textResult(
      `Typed text into element: "${params.selector}".`,
      { selector: params.selector, text_length: params.text.length }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(`Failed to type into "${params.selector}": ${message}`);
  }
}

/**
 * Handle the 'screenshot' action.
 * Returns a base64-encoded PNG image as ImageContent.
 */
async function handleScreenshot(
  page: PlaywrightPage
): Promise<PiAgentToolResult> {
  try {
    const buffer = await page.screenshot({ type: 'png', fullPage: false });
    const base64 = buffer.toString('base64');

    return {
      content: [
        {
          type: 'image' as const,
          data: base64,
          mimeType: 'image/png',
        },
      ],
      details: { action: 'screenshot', size: buffer.length },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(`Failed to take screenshot: ${message}`);
  }
}

/**
 * Handle the 'get_content' action.
 * Returns the text content of the page or a specific element.
 */
async function handleGetContent(
  page: PlaywrightPage,
  params: BrowserActionParams
): Promise<PiAgentToolResult> {
  try {
    if (params.selector) {
      // Get content of a specific element
      const locator = params.selector_type === 'text'
        ? page.getByText(params.selector, { exact: false })
        : page.locator(params.selector);

      const content = await locator.first().textContent({ timeout: 10000 });
      return textResult(
        content ?? '(element found but has no text content)',
        { selector: params.selector, selector_type: params.selector_type ?? 'css' }
      );
    }

    // Get full page text content
    const bodyContent = await page.evaluate(() => {
      return document.body?.innerText ?? '(empty page)';
    });

    // Truncate very long content to avoid overwhelming the LLM context
    const maxLength = 10000;
    const truncated = bodyContent.length > maxLength
      ? bodyContent.substring(0, maxLength) + '\n\n... (content truncated)'
      : bodyContent;

    return textResult(truncated, {
      url: page.url(),
      content_length: bodyContent.length,
      truncated: bodyContent.length > maxLength,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(`Failed to get page content: ${message}`);
  }
}

/**
 * Handle the 'go_back' action.
 */
async function handleGoBack(page: PlaywrightPage): Promise<PiAgentToolResult> {
  try {
    await page.goBack({ timeout: 15000, waitUntil: 'domcontentloaded' });
    return textResult(`Navigated back to: ${page.url()}`, { url: page.url() });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(`Failed to go back: ${message}`);
  }
}

/**
 * Handle the 'go_forward' action.
 */
async function handleGoForward(page: PlaywrightPage): Promise<PiAgentToolResult> {
  try {
    await page.goForward({ timeout: 15000, waitUntil: 'domcontentloaded' });
    return textResult(`Navigated forward to: ${page.url()}`, { url: page.url() });
  } catch (err: unknown) {
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
 * Follows the same pattern as scheduler tools: returns an array
 * with a single AgentTool definition.
 */
export function buildBrowserTool(): PiAgentTool[] {
  return [
    {
      name: 'browser_action',
      label: 'Browser Action',
      description:
        'Automate the user web browser (Chrome or Edge). Connects to the browser via CDP. ' +
        'Actions: navigate (go to URL), click (click element), type (enter text), ' +
        'screenshot (capture page image), get_content (read page text), ' +
        'go_back / go_forward (navigate history). ' +
        'Use CSS selectors by default, or set selector_type to "text" to match by visible text. ' +
        'Each action requires user confirmation before executing.',
      parameters: Type.Object({
        action: Type.Union([
          Type.Literal('navigate'),
          Type.Literal('click'),
          Type.Literal('type'),
          Type.Literal('screenshot'),
          Type.Literal('get_content'),
          Type.Literal('go_back'),
          Type.Literal('go_forward'),
        ], { description: 'The browser action to perform' }),
        url: Type.Optional(Type.String({
          description: 'URL to navigate to (required for "navigate" action)',
        })),
        selector: Type.Optional(Type.String({
          description: 'CSS selector or text to match an element (for click/type/get_content actions)',
        })),
        text: Type.Optional(Type.String({
          description: 'Text to type into the selected element (required for "type" action)',
        })),
        selector_type: Type.Optional(Type.Union([
          Type.Literal('css'),
          Type.Literal('text'),
        ], {
          description: 'How to interpret the selector: "css" for CSS selector, "text" for visible text match. Default: css',
        })),
      }),
      execute: async (
        _toolCallId: string,
        params: unknown,
        signal?: AbortSignal,
        _onUpdate?: PiAgentToolUpdateCallback
      ): Promise<PiAgentToolResult> => {
        const typedParams = params as BrowserActionParams;

        // Check abort signal early
        if (signal?.aborted) {
          return errorResult('Browser action aborted before execution.');
        }

        // Establish browser connection
        let browser: PlaywrightBrowser;
        try {
          browser = await getOrConnectBrowser();
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return errorResult(`Browser connection failed: ${message}`);
        }

        // Get a page to operate on
        let page: PlaywrightPage;
        try {
          page = await getOrCreatePage(browser);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return errorResult(`Failed to get browser page: ${message}`);
        }

        // Dispatch to action handler
        switch (typedParams.action) {
          case 'navigate':
            return handleNavigate(page, typedParams, signal);
          case 'click':
            return handleClick(page, typedParams);
          case 'type':
            return handleType(page, typedParams);
          case 'screenshot':
            return handleScreenshot(page);
          case 'get_content':
            return handleGetContent(page, typedParams);
          case 'go_back':
            return handleGoBack(page);
          case 'go_forward':
            return handleGoForward(page);
          default:
            return errorResult(`Unknown browser action: "${String(typedParams.action)}". ` +
              'Supported: navigate, click, type, screenshot, get_content, go_back, go_forward.');
        }
      },
    },
  ];
}
