import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  screen,
  Tray,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type NativeImage
} from 'electron'
import {
  trayIpcChannels,
  trayOpenMainInputSchema,
  trayQuestionSchema,
  trayResizeInputSchema,
  type ApplicationLocale,
  type TrayNavigation,
  type TraySummary
} from '@shared'
import templateIcon1x from '../../../../assets/tray/trayTemplate.png?asset'
import templateIcon2x from '../../../../assets/tray/trayTemplate@2x.png?asset'
import windowsIcon from '../../../../assets/tray/tray.ico?asset'
import { isTrayPanelUrl } from './ipc/context'
import { trayPanelBounds, trayPanelHeight, trayPanelWidth } from './tray-position'
import { trayBadge } from './tray-summary'

/** Business data is re-read at least this often; a change to local data is picked up within the poll interval. */
const refreshIntervalMs = 60_000
const pollIntervalMs = 10_000
/** A click on the icon right after the panel hid on blur is the same click closing it, not a request to reopen. */
const reopenGuardMs = 250

export interface TrayControllerOptions {
  /** Throws, or reports not-ready, when local data cannot be read. */
  loadSummary(options: { refreshWallet: boolean }): Promise<TraySummary>
  /** Local data revision; a change triggers a recompute before the next full interval. */
  dataRevision(): number | null
  /** The 「在菜单栏显示 SES Agent」 setting. */
  visible(): boolean
  locale(): ApplicationLocale
  /** Shows the main window on the requested place. */
  navigate(navigation: TrayNavigation): void
  /** Shows the main window where it was (the icon menu's 打开 SES Agent). */
  showMain(): void
  preloadPath: string
  rendererUrl?: string
}

function trayIcon(): NativeImage {
  if (process.platform === 'win32') return nativeImage.createFromPath(windowsIcon)
  const image = nativeImage.createEmpty()
  image.addRepresentation({ scaleFactor: 1, buffer: readFileSync(templateIcon1x) })
  image.addRepresentation({ scaleFactor: 2, buffer: readFileSync(templateIcon2x) })
  if (process.platform === 'darwin') image.setTemplateImage(true)
  return image
}

const text = (locale: ApplicationLocale) => (zh: string, ja: string) => (locale === 'zh-CN' ? zh : ja)

/**
 * The menu-bar (macOS) / system-tray (Windows) icon and its quick panel. The panel is a frameless, sandboxed
 * window loading the bundled tray.html with its own preload; its IPC channels answer only that window.
 */
export function createTrayController(options: TrayControllerOptions) {
  let tray: Tray | null = null
  let panel: BrowserWindow | null = null
  let summary: TraySummary | null = null
  let pushed = ''
  let refreshedAt = 0
  let revision: number | null = null
  let requestedHeight = 460
  let hiddenAt = 0
  let inflight: Promise<TraySummary> | null = null
  let queuedWallet = false

  const fromPanel = (event: IpcMainEvent | IpcMainInvokeEvent) =>
    panel !== null &&
    !panel.isDestroyed() &&
    event.sender === panel.webContents &&
    isTrayPanelUrl(event.senderFrame?.url ?? event.sender.getURL())
  const assertPanel = (event: IpcMainEvent | IpcMainInvokeEvent) => {
    if (!fromPanel(event)) throw new Error('Blocked tray request from an untrusted renderer.')
  }

  const applyBadge = () => {
    if (!tray) return
    const badge = trayBadge(summary, summary?.locale ?? options.locale())
    if (process.platform === 'darwin') tray.setTitle(badge.title, { fontType: 'monospacedDigit' })
    tray.setToolTip(process.platform === 'darwin' ? 'SES Agent' : badge.tooltip)
  }

  const refresh = (refreshWallet = false): Promise<TraySummary> => {
    if (inflight) {
      queuedWallet ||= refreshWallet
      return inflight
    }
    inflight = (async () => {
      let next: TraySummary
      try {
        next = await options.loadSummary({ refreshWallet })
      } catch {
        next = { status: 'not-ready', locale: options.locale(), generatedAt: new Date().toISOString() }
      }
      summary = next
      refreshedAt = Date.now()
      applyBadge()
      const comparable = JSON.stringify({ ...next, generatedAt: null })
      if (comparable !== pushed && panel && !panel.isDestroyed()) panel.webContents.send(trayIpcChannels.traySummaryChanged, next)
      pushed = comparable
      return next
    })().finally(() => {
      inflight = null
      if (queuedWallet) {
        queuedWallet = false
        void refresh(true)
      }
    })
    return inflight
  }

  const position = () => {
    if (!tray || !panel || panel.isDestroyed()) return
    const trayBounds = tray.getBounds()
    const cursor = screen.getCursorScreenPoint()
    const display =
      trayBounds.width > 0 && trayBounds.height > 0 ? screen.getDisplayMatching(trayBounds) : screen.getDisplayNearestPoint(cursor)
    panel.setBounds(
      trayPanelBounds({
        platform: process.platform,
        trayBounds,
        cursor,
        display: display.bounds,
        workArea: display.workArea,
        height: requestedHeight
      })
    )
  }

  const hide = () => {
    if (!panel || panel.isDestroyed() || !panel.isVisible()) return
    hiddenAt = Date.now()
    panel.hide()
  }

  const ensurePanel = () => {
    if (panel && !panel.isDestroyed()) return panel
    const mac = process.platform === 'darwin'
    const window = new BrowserWindow({
      width: trayPanelWidth,
      height: requestedHeight,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      title: 'SES Agent',
      ...(mac
        ? { vibrancy: 'popover' as const, visualEffectState: 'active' as const, backgroundColor: '#00000000', roundedCorners: true }
        : { backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c2230' : '#ffffff' }),
      webPreferences: {
        preload: options.preloadPath,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: false
      }
    })
    window.setAlwaysOnTop(true, 'pop-up-menu')
    // Without skipTransformProcessType, Electron turns the whole app into a UIElement here, which drops its Dock icon.
    if (mac) window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    window.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') hide()
    })
    window.on('blur', hide)
    window.on('closed', () => {
      if (panel === window) panel = null
    })
    const page = options.rendererUrl ? `${options.rendererUrl.replace(/\/$/u, '')}/tray.html` : 'ses-agent://app/tray.html'
    // Vibrancy draws the macOS popover material behind a translucent page; elsewhere the page paints its own surface.
    void window.loadURL(mac ? `${page}#vibrancy` : page)
    panel = window
    return window
  }

  const show = () => {
    const window = ensurePanel()
    position()
    window.show()
    window.focus()
    void refresh(true)
  }

  const toggle = () => {
    if (panel && !panel.isDestroyed() && panel.isVisible()) {
      hide()
      return
    }
    if (Date.now() - hiddenAt < reopenGuardMs) return
    show()
  }

  const contextMenu = () => {
    const t = text(summary?.locale ?? options.locale())
    return Menu.buildFromTemplate([
      {
        label: t('打开 SES Agent', 'SES Agent を開く'),
        click: () => options.showMain()
      },
      { type: 'separator' },
      { label: t('退出', '終了'), click: () => app.quit() }
    ])
  }

  const createTray = () => {
    if (tray) return
    tray = new Tray(trayIcon())
    tray.setToolTip('SES Agent')
    tray.on('click', toggle)
    tray.on('right-click', () => {
      hide()
      tray?.popUpContextMenu(contextMenu())
    })
    applyBadge()
    void refresh()
  }

  const destroyTray = () => {
    if (panel && !panel.isDestroyed()) panel.destroy()
    panel = null
    tray?.destroy()
    tray = null
  }

  /** Shows or removes the icon to match the 「在菜单栏显示 SES Agent」 setting. */
  const applyVisibility = () => {
    let visible = true
    try {
      visible = options.visible()
    } catch {
      visible = true
    }
    if (visible) createTray()
    else destroyTray()
    if (tray) void refresh()
  }

  ipcMain.handle(trayIpcChannels.getTraySummary, async (event) => {
    assertPanel(event)
    return refresh(true)
  })
  ipcMain.handle(trayIpcChannels.openMain, (event, raw) => {
    assertPanel(event)
    const input = trayOpenMainInputSchema.parse(raw)
    hide()
    options.navigate({ id: randomUUID(), route: input.route, ...(input.payload ?? {}) })
  })
  ipcMain.handle(trayIpcChannels.askAgent, (event, raw) => {
    assertPanel(event)
    const question = trayQuestionSchema.parse(raw)
    hide()
    options.navigate({ id: randomUUID(), route: 'agent', text: question })
  })
  const onResize = (event: IpcMainEvent, raw: unknown) => {
    if (!fromPanel(event)) return
    const parsed = trayResizeInputSchema.safeParse(raw)
    if (!parsed.success || !panel) return
    requestedHeight = parsed.data
    if (panel.isVisible()) position()
    else {
      const area = screen.getPrimaryDisplay().workArea
      panel.setBounds({ ...panel.getBounds(), width: trayPanelWidth, height: trayPanelHeight(requestedHeight, area) })
    }
  }
  const onHide = (event: IpcMainEvent) => {
    if (fromPanel(event)) hide()
  }
  ipcMain.on(trayIpcChannels.resize, onResize)
  ipcMain.on(trayIpcChannels.hide, onHide)

  const timer = setInterval(() => {
    if (!tray) return
    let current: number | null = null
    try {
      current = options.dataRevision()
    } catch {
      current = null
    }
    const changed = current !== revision
    revision = current
    if (changed || Date.now() - refreshedAt >= refreshIntervalMs) void refresh()
  }, pollIntervalMs)
  timer.unref()

  applyVisibility()

  return {
    applyVisibility,
    refresh: () => void refresh(),
    isPanel: (contents: Electron.WebContents) => panel !== null && !panel.isDestroyed() && panel.webContents === contents,
    dispose() {
      clearInterval(timer)
      ipcMain.removeHandler(trayIpcChannels.getTraySummary)
      ipcMain.removeHandler(trayIpcChannels.openMain)
      ipcMain.removeHandler(trayIpcChannels.askAgent)
      ipcMain.removeListener(trayIpcChannels.resize, onResize)
      ipcMain.removeListener(trayIpcChannels.hide, onHide)
      destroyTray()
    }
  }
}

export type TrayController = ReturnType<typeof createTrayController>
