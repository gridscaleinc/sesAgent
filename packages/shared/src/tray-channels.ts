/**
 * IPC channels of the menu-bar / system-tray quick panel. Only the panel's own preload and Main use them, and
 * nothing the main window's preload imports may import this file: the two sandboxed preloads must each build to
 * a single file, so they cannot share a module.
 */
export const trayIpcChannels = {
  getTraySummary: 'tray:get-summary',
  traySummaryChanged: 'tray:summary-changed',
  openMain: 'tray:open-main',
  askAgent: 'tray:ask-agent',
  resize: 'tray:resize',
  hide: 'tray:hide'
} as const
