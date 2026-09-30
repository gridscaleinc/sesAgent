export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export const trayPanelWidth = 360
export const trayPanelMinHeight = 120
export const trayPanelMaxHeight = 640
const gap = 6

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max))

/** The panel height the renderer asked for, kept within the panel limits and the screen. */
export function trayPanelHeight(requested: number, workArea: Rect): number {
  const fitting = Math.min(trayPanelMaxHeight, workArea.height - gap * 2)
  return Math.round(clamp(requested, Math.min(trayPanelMinHeight, fitting), fitting))
}

/** Which screen edge the Windows taskbar sits on, read from where the work area leaves room on the display. */
export function taskbarEdge(display: Rect, workArea: Rect): 'top' | 'bottom' | 'left' | 'right' {
  if (workArea.y > display.y) return 'top'
  if (workArea.x > display.x) return 'left'
  if (workArea.x + workArea.width < display.x + display.width) return 'right'
  return 'bottom'
}

/**
 * Where the quick panel opens. macOS: centred under the menu-bar icon, below the menu bar. Windows: beside the
 * taskbar next to the notification-area icon (above it for a bottom taskbar). Always inside the work area.
 * A tray that reports empty bounds (Windows overflow area) anchors on the cursor instead.
 */
export function trayPanelBounds(input: {
  platform: NodeJS.Platform
  trayBounds: Rect
  cursor: { x: number; y: number }
  display: Rect
  workArea: Rect
  height: number
  width?: number
}): Rect {
  const width = input.width ?? trayPanelWidth
  const height = trayPanelHeight(input.height, input.workArea)
  const area = input.workArea
  const anchor =
    input.trayBounds.width > 0 && input.trayBounds.height > 0
      ? input.trayBounds
      : { x: input.cursor.x, y: input.cursor.y, width: 0, height: 0 }
  const centreX = anchor.x + anchor.width / 2
  const centreY = anchor.y + anchor.height / 2
  const left = clamp(Math.round(centreX - width / 2), area.x + gap, area.x + area.width - width - gap)
  const top = clamp(Math.round(centreY - height / 2), area.y + gap, area.y + area.height - height - gap)
  if (input.platform === 'darwin') {
    const below = Math.max(area.y, anchor.y + anchor.height) + gap / 2
    return { x: left, y: Math.round(clamp(below, area.y, area.y + area.height - height - gap)), width, height }
  }
  const edge = taskbarEdge(input.display, area)
  if (edge === 'top') return { x: left, y: area.y + gap, width, height }
  if (edge === 'left') return { x: area.x + gap, y: top, width, height }
  if (edge === 'right') return { x: area.x + area.width - width - gap, y: top, width, height }
  return { x: left, y: area.y + area.height - height - gap, width, height }
}
