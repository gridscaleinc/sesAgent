// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { taskbarEdge, trayPanelBounds, trayPanelHeight, trayPanelMaxHeight } from './tray-position'

const macDisplay = { x: 0, y: 0, width: 1512, height: 982 }
const macWorkArea = { x: 0, y: 25, width: 1512, height: 957 }
const cursor = { x: 0, y: 0 }

describe('trayPanelBounds on macOS', () => {
  it('centres the panel under the menu-bar icon, just below the menu bar', () => {
    const bounds = trayPanelBounds({
      platform: 'darwin',
      trayBounds: { x: 1000, y: 0, width: 24, height: 24 },
      cursor,
      display: macDisplay,
      workArea: macWorkArea,
      height: 480
    })
    expect(bounds).toEqual({ x: 832, y: 28, width: 360, height: 480 })
  })

  it('stays inside the work area when the icon sits near the right edge', () => {
    const bounds = trayPanelBounds({
      platform: 'darwin',
      trayBounds: { x: 1490, y: 0, width: 22, height: 24 },
      cursor,
      display: macDisplay,
      workArea: macWorkArea,
      height: 480
    })
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(macWorkArea.width - 6)
    expect(bounds.x).toBe(1512 - 360 - 6)
  })

  it('clamps the height to the panel maximum and to a short screen', () => {
    expect(trayPanelHeight(2000, macWorkArea)).toBe(trayPanelMaxHeight)
    expect(trayPanelHeight(10, macWorkArea)).toBe(120)
    const short = { x: 0, y: 25, width: 1280, height: 500 }
    const bounds = trayPanelBounds({
      platform: 'darwin',
      trayBounds: { x: 600, y: 0, width: 24, height: 24 },
      cursor,
      display: { x: 0, y: 0, width: 1280, height: 525 },
      workArea: short,
      height: 900
    })
    expect(bounds.height).toBe(500 - 12)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(short.y + short.height)
  })

  it('works on a second display to the left of the primary one', () => {
    const bounds = trayPanelBounds({
      platform: 'darwin',
      trayBounds: { x: -300, y: -1080, width: 24, height: 24 },
      cursor,
      display: { x: -1920, y: -1080, width: 1920, height: 1080 },
      workArea: { x: -1920, y: -1055, width: 1920, height: 1055 },
      height: 400
    })
    expect(bounds).toEqual({ x: -468, y: -1052, width: 360, height: 400 })
  })
})

describe('trayPanelBounds on Windows', () => {
  const display = { x: 0, y: 0, width: 1920, height: 1080 }
  it('opens above a bottom taskbar next to the notification-area icon', () => {
    const workArea = { x: 0, y: 0, width: 1920, height: 1040 }
    expect(taskbarEdge(display, workArea)).toBe('bottom')
    const bounds = trayPanelBounds({
      platform: 'win32',
      trayBounds: { x: 1700, y: 1048, width: 24, height: 24 },
      cursor,
      display,
      workArea,
      height: 500
    })
    expect(bounds).toEqual({ x: 1532, y: 1040 - 500 - 6, width: 360, height: 500 })
  })

  it('opens below a top taskbar and keeps the right edge on screen', () => {
    const workArea = { x: 0, y: 40, width: 1920, height: 1040 }
    expect(taskbarEdge(display, workArea)).toBe('top')
    const bounds = trayPanelBounds({
      platform: 'win32',
      trayBounds: { x: 1900, y: 8, width: 24, height: 24 },
      cursor,
      display,
      workArea,
      height: 500
    })
    expect(bounds).toEqual({ x: 1920 - 360 - 6, y: 46, width: 360, height: 500 })
  })

  it('sits beside a left or right taskbar', () => {
    const left = trayPanelBounds({
      platform: 'win32',
      trayBounds: { x: 8, y: 1000, width: 24, height: 24 },
      cursor,
      display,
      workArea: { x: 60, y: 0, width: 1860, height: 1080 },
      height: 500
    })
    expect(left).toEqual({ x: 66, y: 1080 - 500 - 6, width: 360, height: 500 })
    const right = trayPanelBounds({
      platform: 'win32',
      trayBounds: { x: 1880, y: 500, width: 24, height: 24 },
      cursor,
      display,
      workArea: { x: 0, y: 0, width: 1860, height: 1080 },
      height: 400
    })
    expect(right).toEqual({ x: 1860 - 360 - 6, y: 312, width: 360, height: 400 })
  })

  it('anchors on the cursor when the tray reports empty bounds (overflow area)', () => {
    const bounds = trayPanelBounds({
      platform: 'win32',
      trayBounds: { x: 0, y: 0, width: 0, height: 0 },
      cursor: { x: 1500, y: 1060 },
      display,
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      height: 400
    })
    expect(bounds).toEqual({ x: 1320, y: 634, width: 360, height: 400 })
  })
})
