import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyThemePreference, readThemePreference, saveThemePreference, themeStorageKey } from './theme'

let values: Map<string, string>
beforeEach(() => {
  values = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear()
  })
})
afterEach(() => {
  document.documentElement.removeAttribute('data-theme')
  vi.unstubAllGlobals()
})

describe('theme preference', () => {
  it('defaults to following the system without a data-theme attribute', () => {
    expect(readThemePreference()).toBe('system')
    applyThemePreference(readThemePreference())
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('stores and applies an explicit light or dark choice', () => {
    saveThemePreference('dark')
    expect(values.get(themeStorageKey)).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(readThemePreference()).toBe('dark')
    saveThemePreference('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    saveThemePreference('system')
    expect(values.has(themeStorageKey)).toBe(false)
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('ignores unknown stored values and unavailable storage', () => {
    values.set(themeStorageKey, 'sepia')
    expect(readThemePreference()).toBe('system')
    const blocked = () => {
      throw new Error('blocked')
    }
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked })
    expect(readThemePreference()).toBe('system')
    saveThemePreference('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})
