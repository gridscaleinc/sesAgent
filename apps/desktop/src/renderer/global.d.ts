import type { DesktopApi, TrayDesktopApi } from '@shared'

declare global {
  interface Window {
    sesAgent: DesktopApi
    /** Present only in the menu-bar panel (tray.html), whose preload exposes nothing else. */
    sesTray?: TrayDesktopApi
  }
}

export {}
