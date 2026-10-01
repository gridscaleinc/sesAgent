/** 外观 setting: renderer-only, kept in this origin's localStorage (the tray page shares the origin but follows the system, see tray.tsx). */
export type ThemePreference = 'system' | 'light' | 'dark'

export const themeStorageKey = 'ses-theme-v1'

export function readThemePreference(): ThemePreference {
  try {
    const stored = globalThis.localStorage?.getItem(themeStorageKey)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

/** Sets data-theme on <html> for an explicit choice; 跟随系统 removes it so the prefers-color-scheme palette applies. */
export function applyThemePreference(preference: ThemePreference, root: HTMLElement = document.documentElement): void {
  if (preference === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', preference)
}

export function saveThemePreference(preference: ThemePreference, root?: HTMLElement): void {
  try {
    if (preference === 'system') globalThis.localStorage?.removeItem(themeStorageKey)
    else globalThis.localStorage?.setItem(themeStorageKey, preference)
  } catch {
    // Storage can be unavailable; the choice still applies for this session.
  }
  applyThemePreference(preference, root)
}
