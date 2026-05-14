/**
 * Type declarations for Electron APIs used by main/agent/preload processes.
 *
 * This file provides type information when the actual electron package
 * is not installed (e.g., in CI or when electron binary download failed).
 * When electron is properly installed, its own type definitions take precedence.
 */
declare module 'electron' {
  // BrowserWindow
  export class BrowserWindow {
    constructor(options?: BrowserWindowConstructorOptions);
    loadURL(url: string): Promise<void>;
    loadFile(filePath: string): Promise<void>;
    show(): void;
    hide(): void;
    isVisible(): boolean;
    close(): void;
    destroy(): void;
    getPosition(): [number, number];
    setPosition(x: number, y: number): void;
    getSize(): [number, number];
    setSize(width: number, height: number): void;
    setIgnoreMouseEvents(ignore: boolean, options?: { forward?: boolean }): void;
    setAlwaysOnTop(flag: boolean, level?: string): void;
    focus(): void;
    getTitle(): string;
    on(event: string, listener: (...args: unknown[]) => void): this;
    once(event: string, listener: (...args: unknown[]) => void): this;
    webContents: WebContents;
    isDestroyed(): boolean;
    static getAllWindows(): BrowserWindow[];
  }

  export interface BrowserWindowConstructorOptions {
    width?: number;
    height?: number;
    x?: number;
    y?: number;
    transparent?: boolean;
    frame?: boolean;
    alwaysOnTop?: boolean;
    skipTaskbar?: boolean;
    resizable?: boolean;
    hasShadow?: boolean;
    focusable?: boolean;
    thickFrame?: boolean;
    show?: boolean;
    backgroundColor?: string;
    title?: string;
    autoHideMenuBar?: boolean;
    center?: boolean;
    minWidth?: number;
    minHeight?: number;
    webPreferences?: WebPreferences;
  }

  export interface WebPreferences {
    preload?: string;
    contextIsolation?: boolean;
    nodeIntegration?: boolean;
    sandbox?: boolean;
    webgl?: boolean;
    plugins?: boolean;
    images?: boolean;
    webSecurity?: boolean;
    partition?: string;
  }

  export interface WebContents {
    isLoading(): boolean;
    on(event: string, listener: (...args: unknown[]) => void): void;
    once(event: string, listener: (...args: unknown[]) => void): void;
    send(channel: string, ...args: unknown[]): void;
    postMessage(channel: string, message: unknown, transfer?: MessagePortMain[]): void;
    openDevTools(): void;
    closeDevTools(): void;
  }

  // App
  export const app: {
    whenReady(): Promise<void>;
    quit(): void;
    exit(code?: number): void;
    getPath(name: string): string;
    getAppPath(): string;
    isPackaged: boolean;
    disableHardwareAcceleration(): void;
    commandLine: {
      appendSwitch(switchName: string, value?: string): void;
    };
    on(event: string, listener: (...args: unknown[]) => void): void;
    getVersion(): string;
    getName(): string;
  };

  // Screen
  export const screen: {
    getPrimaryDisplay(): Display;
    getDisplayNearestPoint(point: { x: number; y: number }): Display;
    getAllDisplays(): Display[];
  };

  export interface Display {
    id: number;
    bounds: { x: number; y: number; width: number; height: number };
    workArea: { x: number; y: number; width: number; height: number };
    workAreaSize: { width: number; height: number };
    size: { width: number; height: number };
    scaleFactor: number;
  }

  // Tray
  export class Tray {
    constructor(image: NativeImage);
    setToolTip(text: string): void;
    setContextMenu(menu: Menu): void;
    on(event: string, listener: (...args: unknown[]) => void): void;
    destroy(): void;
  }

  // Menu
  export const Menu: {
    buildFromTemplate(template: MenuItemConstructorOptions[]): Menu;
  };

  export interface Menu {
    popup(): void;
    closePopup(): void;
  }

  export interface MenuItemConstructorOptions {
    label?: string;
    type?: 'normal' | 'separator' | 'submenu' | 'checkbox' | 'radio';
    click?: (menuItem: unknown, browserWindow: BrowserWindow | null, event: unknown) => void;
    enabled?: boolean;
    checked?: boolean;
    submenu?: MenuItemConstructorOptions[];
    accelerator?: string;
    role?: string;
    icon?: NativeImage;
  }

  // NativeImage
  export class NativeImage {
    toDataURL(): string;
    toBitmap(): Buffer;
  }

  export const nativeImage: {
    createFromBuffer(buffer: Buffer, options?: { width: number; height: number }): NativeImage;
    createFromPath(path: string): NativeImage;
    createEmpty(): NativeImage;
  };

  // IPC
  export const ipcMain: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    on(channel: string, listener: (event: IpcMainEvent, ...args: any[]) => void): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    once(channel: string, listener: (event: IpcMainEvent, ...args: any[]) => void): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => any): void;
    removeHandler(channel: string): void;
  };

  export const ipcRenderer: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    send(channel: string, ...args: any[]): void;
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    on(channel: string, listener: (event: IpcRendererEvent, ...args: any[]) => void): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    once(channel: string, listener: (event: IpcRendererEvent, ...args: any[]) => void): void;
    removeListener(channel: string, listener: (...args: unknown[]) => void): void;
  };

  export interface IpcMainEvent {
    reply(channel: string, ...args: unknown[]): void;
    sender: WebContents;
  }

  export interface IpcMainInvokeEvent {
    sender: WebContents;
  }

  export interface IpcMainInvokeEvent {
    sender: WebContents;
  }

  export interface IpcRendererEvent {
    sender: WebContents;
  }

  // Utility Process
  export const utilityProcess: {
    fork(modulePath: string, args?: string[], options?: { env?: Record<string, string> }): UtilityProcess;
  };

  export interface UtilityProcess {
    postMessage(message: unknown, transfer?: MessagePortMain[]): void;
    kill(): void;
    pid: number | null;
    on(event: string, listener: (...args: unknown[]) => void): void;
  }

  // MessageChannelMain
  export class MessageChannelMain {
    port1: MessagePortMain;
    port2: MessagePortMain;
  }

  export interface MessagePortMain {
    postMessage(message: unknown, transfer?: MessagePortMain[]): void;
    on(event: string, listener: (...args: unknown[]) => void): void;
    start(): void;
    close(): void;
  }

  // contextBridge
  export const contextBridge: {
    exposeInMainWorld(apiKey: string, api: Record<string, unknown>): void;
  };
}

/**
 * Global Electron namespace for type references used as Electron.IpcMainEvent, etc.
 * This mirrors the global types that Electron provides.
 */
declare namespace Electron {
  interface IpcMainEvent {
    reply(channel: string, ...args: unknown[]): void;
    sender: import('electron').WebContents;
  }
  interface IpcMainInvokeEvent {
    sender: import('electron').WebContents;
  }
  interface IpcRendererEvent {
    sender: import('electron').WebContents;
  }
  interface MessageEvent {
    data: unknown;
    ports: import('electron').MessagePortMain[];
  }
}

/**
 * Extend Node.js Process type with Electron-specific properties
 * available in utility processes.
 */
declare namespace NodeJS {
  interface Process {
    parentPort: import('electron').MessagePortMain;
    resourcesPath: string;
  }
}

/**
 * Type declarations for node-cron.
 * Replaced by @types/node-cron when that package is installed.
 */
declare module 'node-cron' {
  export interface ScheduledTask {
    stop(): void;
    start(): void;
    destroy(): void;
  }

  export function validate(expression: string): boolean;
  export function schedule(expression: string, func: () => void, options?: { scheduled?: boolean }): ScheduledTask;
}

/**
 * Type declarations for the glob package.
 * Provides the glob() function for file pattern matching.
 */
declare module 'glob' {
  export interface GlobOptions {
    nodir?: boolean;
    absolute?: boolean;
    signal?: AbortSignal;
    cwd?: string;
    dot?: boolean;
    ignore?: string | string[];
  }

  export function glob(pattern: string, options?: GlobOptions): Promise<string[]>;
  export function sync(pattern: string, options?: GlobOptions): string[];
}

/**
 * Type declarations for playwright.
 * Only the types used by the browser automation tool are declared here.
 * When playwright is installed, its own type definitions take precedence.
 */
declare module 'playwright' {
  export interface Browser {
    isConnected(): boolean;
    contexts(): BrowserContext[];
    newContext(): Promise<BrowserContext>;
    on(event: string, listener: (...args: unknown[]) => void): void;
    close(): Promise<void>;
  }

  export interface BrowserContext {
    pages(): Page[];
    newPage(): Promise<Page>;
  }

  export interface Page {
    goto(url: string, options?: { timeout?: number; waitUntil?: string }): Promise<Response | null>;
    url(): string;
    locator(selector: string): Locator;
    getByText(text: string, options?: { exact?: boolean }): Locator;
    click(selector: string, options?: { timeout?: number }): Promise<void>;
    screenshot(options?: { type?: string; fullPage?: boolean }): Promise<Buffer>;
    evaluate<T>(fn: () => T): Promise<T>;
    goBack(options?: { timeout?: number; waitUntil?: string }): Promise<Response | null>;
    goForward(options?: { timeout?: number; waitUntil?: string }): Promise<Response | null>;
  }

  export interface Locator {
    first(): Locator;
    click(options?: { timeout?: number }): Promise<void>;
    fill(value: string): Promise<void>;
    textContent(options?: { timeout?: number }): Promise<string | null>;
  }

  export interface Response {
    status(): number;
  }

  export const chromium: {
    connectOverCDP(endpointURL: string): Promise<Browser>;
    launch(options?: { headless?: boolean }): Promise<Browser>;
  };
}
