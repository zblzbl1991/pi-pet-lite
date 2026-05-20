/**
 * Theme Constants — Clawd Desktop Pet
 *
 * Named color constants for use in the main process (BrowserWindow backgroundColor,
 * tray icon colors, etc.). Values must match the corresponding CSS custom properties
 * in src/renderer/styles/tokens.css.
 */

/** Page background — Slate-tinted dark */
export const THEME_PAGE_BG = '#0f172a';

/** Card/surface background */
export const THEME_CARD_BG = '#1e293b';

/** Header bar background */
export const THEME_HEADER_BG = '#25262b';

/** Sidebar background */
export const THEME_SIDEBAR_BG = '#1e1e26';

/** Input background */
export const THEME_INPUT_BG = '#2a2c34';

/** Brand color (blue-600) */
export const THEME_BRAND = '#2563eb';

/** Brand hover color */
export const THEME_BRAND_HOVER = '#1d4ed8';

/** Success green */
export const THEME_SUCCESS = '#34d399';

/** Warning amber */
export const THEME_WARNING = '#fbbf24';

/** Danger red */
export const THEME_DANGER = '#f87171';

/** Text primary (light slate) */
export const THEME_TEXT_PRIMARY = 'rgba(241, 245, 249, 0.95)';

/** Text secondary (muted slate) */
export const THEME_TEXT_SECONDARY = 'rgba(148, 163, 184, 0.80)';

/** Border default */
export const THEME_BORDER = 'rgba(255, 255, 255, 0.10)';

/** Pet role colors (for tray icon, status indicators, etc.) */
export const THEME_ROLE_CHIEF = '#e8912d';
export const THEME_ROLE_CODER = '#4a90d9';
export const THEME_ROLE_SCOUT = '#50b478';
export const THEME_ROLE_ANALYST = '#9b6dd7';
export const THEME_ROLE_CUSTOM = '#888888';

/** Tray icon color (Scout green, default active color) */
export const THEME_TRAY_ICON = { r: 80, g: 180, b: 120 };
