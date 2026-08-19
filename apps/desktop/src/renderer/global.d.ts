import type { DesktopApi } from '@shared'

declare global {
  interface Window {
    sesAgent: DesktopApi
  }
}

export {}
