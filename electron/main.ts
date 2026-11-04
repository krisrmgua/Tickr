import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, ipcMain, Menu, screen, shell, Tray } from "electron";
import { fetchQuote, type Quote } from "./core/quote";
import { fetchPositions, summaryURL, BAD_URL_MESSAGE, type PositionSummary } from "./core/positions";
import {
  normalizeSymbol,
  removeSymbol,
  yahooNewsURL,
  rotateIntervalLabel,
  ROTATE_INTERVAL_CHOICES,
  scrollDirectionTitle,
  scrollSpeedLabel,
  SCROLL_SPEED_CHOICES,
  scrollWidthLabel,
  SCROLL_WIDTH_CHOICES,
  type DailystockerMode,
  type Prefs,
} from "./core/prefs";
import {
  barSymbols,
  entriesFor,
  rotateStep,
  tooltipText,
} from "./core/ticker";
import { positionSections, stockView } from "./core/view";
import { ensureLogo, logoDataUrl, logoTrayImage } from "./logos";
import { swiftLaunchAgentPath } from "./paths";
import { PrefsStore, readApiKey, writeApiKey } from "./store";
import {
  buildScrollStrip,
  clearCapsuleLogoCache,
  scrollCapsuleFrame,
  scrollStripKey,
  trayCapsuleImage,
  type ScrollStrip,
} from "./trayCapsule";
import { dotImage } from "./trayIcon";

/** Swift marquee runs at ~30fps with point offsets. */
const SCROLL_FPS_MS = 1000 / 30;

const POLL_MS = 60_000;
const PANEL_WIDTH = 400;
const PANEL_MIN_HEIGHT = 160;
const PANEL_PAD = 8;
/** Windows truncates tray tooltips past 127 characters. */
const WIN_TOOLTIP_MAX = 127;

const isDev = process.env.TICKR_DEV === "1";
const isMac = process.platform === "darwin";

/** Display prefs the panel may change directly; the watchlist and dailystocker have their own handlers. */
const DISPLAY_KEYS = [
  "rotateOneAtATime",
  "rotateIntervalSeconds",
  "stackTwoTickers",
  "scrollTickers",
  "scrollWidthPoints",
  "scrollSpeedPointsPerSecond",
  "scrollDirection",
  "pastelBarColors",
  "colorTrayTitle",
  "showTickerSymbol",
] as const satisfies readonly (keyof Prefs)[];

let tray: Tray | null = null;
let panel: BrowserWindow | null = null;
let store: PrefsStore;
const quotes = new Map<string, Quote>();
let lastError: string | null = null;
let lastUpdated: number | null = null;
/** Last good dailystocker summary, kept across a failed fetch like stock quotes. */
let positions: PositionSummary | null = null;
let positionsError: string | null = null;
let positionsSeq = 0;
let rotateIndex = 0;
/** Point offset into the marquee strip (Swift TickrMarqueeView). */
let scrollOffsetPts = 0;
let scrollLastTick = 0;
let scrollStrip: ScrollStrip | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let rotateTimer: NodeJS.Timeout | null = null;
let scrollTimer: NodeJS.Timeout | null = null;
/** Bumps on every full tray rebuild so stale async capsule frames are dropped. */
let trayGen = 0;

function prefs(): Prefs {
  return store.get();
}

function panelUrl(): string {
  if (isDev) return "http://127.0.0.1:5174";
  return `file://${path.join(app.getAppPath(), "dist", "index.html")}`;
}

function createPanel(): BrowserWindow {
  const win = new BrowserWindow({
    width: PANEL_WIDTH,
    height: PANEL_MIN_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    useContentSize: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: "#0b1220",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  void win.loadURL(panelUrl());
  win.on("blur", () => {
    if (!isDev) win.hide();
  });
  return win;
}

function fitPanelToContent(contentHeight: number): void {
  if (!panel) return;
  const anchor = tray ? tray.getBounds() : screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint({ x: anchor.x, y: anchor.y });
  const maxH = Math.floor(display.workArea.height * 0.85);
  const height = Math.min(
    Math.max(Math.ceil(contentHeight) + PANEL_PAD, PANEL_MIN_HEIGHT),
    maxH,
  );
  // Pref changes (scroll/stack/rotate) resize the tray capsule and the panel
  // chrome. Re-centering on the tray every time makes the window jump — keep
  // the current origin while open; only togglePanel re-anchors.
  if (panel.isVisible()) {
    const before = panel.getBounds();
    panel.setContentSize(PANEL_WIDTH, height);
    const after = panel.getBounds();
    if (!isMac && after.height !== before.height) {
      // Windows panel sits above the tray; pin the bottom edge.
      panel.setPosition(before.x, before.y + (before.height - after.height), false);
    } else {
      panel.setPosition(before.x, before.y, false);
    }
    return;
  }
  panel.setContentSize(PANEL_WIDTH, height);
}

function positionPanel(win: BrowserWindow): void {
  if (!tray) return;
  const trayBounds = tray.getBounds();
  const winBounds = win.getBounds();
  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
  let x = Math.round(trayBounds.x + trayBounds.width / 2 - winBounds.width / 2);
  let y = isMac
    ? Math.round(trayBounds.y + trayBounds.height + 4)
    : Math.round(trayBounds.y - winBounds.height - 4);
  const wa = display.workArea;
  x = Math.min(Math.max(x, wa.x + 8), wa.x + wa.width - winBounds.width - 8);
  y = Math.min(Math.max(y, wa.y + 8), wa.y + wa.height - winBounds.height - 8);
  win.setPosition(x, y, false);
}

function togglePanel(): void {
  if (!panel) panel = createPanel();
  if (panel.isVisible()) {
    panel.hide();
    return;
  }
  positionPanel(panel);
  panel.show();
  panel.focus();
}

function notifyPanel(): void {
  panel?.webContents.send("tickr:changed");
}

function render(): void {
  renderTray();
  notifyPanel();
}

function renderTray(): void {
  void paintTray();
}

function applyScrollFrame(): void {
  if (!tray || !scrollStrip || !isMac) return;
  const p = prefs();
  tray.setImage(
    scrollCapsuleFrame(
      scrollStrip,
      p.scrollWidthPoints,
      scrollOffsetPts,
      p.scrollDirection === "rightToLeft",
    ),
  );
  tray.setTitle("");
}

async function paintTray(): Promise<void> {
  if (!tray) return;
  const gen = ++trayGen;
  const p = prefs();
  const symbols = p.trackedSymbols;
  let tip = `Tickr\n${tooltipText(symbols, quotes, p, lastError)}`;
  if (!isMac && tip.length > WIN_TOOLTIP_MAX) tip = `${tip.slice(0, WIN_TOOLTIP_MAX - 1)}…`;
  tray.setToolTip(tip);

  const entries = entriesFor(barSymbols(symbols, p, rotateIndex), quotes);

  // Windows tray is icon-sized; keep the logo/dot + tooltip there.
  if (!isMac) {
    scrollStrip = null;
    if (p.scrollTickers) {
      tray.setImage(dotImage(entries[0].direction, p.pastelBarColors));
      return;
    }
    const logo = logoTrayImage(entries[0].symbol);
    tray.setImage(logo ?? dotImage(entries[0].direction, p.pastelBarColors));
    return;
  }

  // macOS scroll: rebuild strip when content changes, then composite sync frames.
  if (p.scrollTickers) {
    const scrollEntries = entriesFor(symbols, quotes);
    const key = scrollStripKey(
      scrollEntries,
      p.pastelBarColors,
      p.colorTrayTitle,
      p.showTickerSymbol,
    );
    if (!scrollStrip || scrollStrip.key !== key) {
      const next = await buildScrollStrip(
        scrollEntries,
        p.pastelBarColors,
        p.colorTrayTitle,
        p.showTickerSymbol,
      );
      if (gen !== trayGen || !tray) return;
      scrollStrip = next;
    }
    applyScrollFrame();
    return;
  }

  scrollStrip = null;
  const image = await trayCapsuleImage({
    entries,
    stacked: p.stackTwoTickers,
    pastel: p.pastelBarColors,
    color: p.colorTrayTitle,
    showSymbol: p.showTickerSymbol,
  });
  if (gen !== trayGen || !tray) return;
  tray.setImage(image);
  tray.setTitle("");
}

function scheduleRotateTimer(): void {
  if (rotateTimer) clearInterval(rotateTimer);
  rotateTimer = null;
  const p = prefs();
  const step = rotateStep(p, p.trackedSymbols.length);
  if (step == null) return;
  rotateTimer = setInterval(() => {
    const count = prefs().trackedSymbols.length;
    if (!count) return;
    rotateIndex = (rotateIndex + step) % count;
    renderTray();
  }, p.rotateIntervalSeconds * 1000);
}

/** Point-based marquee at ~30fps (Swift TickrMarqueeView). Windows has no scroll strip. */
function scheduleScrollTimer(): void {
  if (scrollTimer) clearInterval(scrollTimer);
  scrollTimer = null;
  const p = prefs();
  if (!p.scrollTickers || !isMac) return;
  scrollLastTick = Date.now();
  scrollTimer = setInterval(() => {
    const now = Date.now();
    const dt = Math.min(0.1, (now - scrollLastTick) / 1000);
    scrollLastTick = now;
    scrollOffsetPts += prefs().scrollSpeedPointsPerSecond * dt;
    if (scrollStrip) applyScrollFrame();
    else renderTray();
  }, SCROLL_FPS_MS);
}

function rescheduleTimers(): void {
  scheduleRotateTimer();
  scheduleScrollTimer();
}

async function refresh(): Promise<void> {
  void refreshPositions();
  const tracked = [...prefs().trackedSymbols];
  const results = await Promise.all(
    tracked.map(async (symbol) => [symbol, await fetchQuote(symbol)] as const),
  );
  const current = new Set(prefs().trackedSymbols);
  const failed: string[] = [];
  let got = 0;
  for (const [symbol, quote] of results) {
    if (!quote) {
      failed.push(symbol);
      continue;
    }
    got++;
    if (current.has(symbol)) quotes.set(symbol, quote);
  }
  lastError = failed.length && got === 0 ? `Yahoo quote failed for ${failed.join(", ")}` : null;
  if (got) lastUpdated = Date.now();
  for (const symbol of tracked) {
    void ensureLogo(symbol).then((landed) => {
      if (landed) {
        clearCapsuleLogoCache();
        scrollStrip = null;
        render();
      }
    });
  }
  render();
}

function dailystockerKey(): string | null {
  return prefs().dailystockerBaseURL ? readApiKey() : null;
}

/** A failure keeps the last good summary and shows the error, the same way stock quotes behave. */
async function refreshPositions(): Promise<void> {
  const seq = ++positionsSeq;
  const p = prefs();
  const key = dailystockerKey();
  if (!key) {
    positions = null;
    positionsError = null;
    notifyPanel();
    return;
  }
  const result = await fetchPositions(p.dailystockerBaseURL, p.dailystockerMode, key);
  if (seq !== positionsSeq) return;
  if (result.ok) {
    positions = result.summary;
    positionsError = null;
  } else {
    positionsError = result.error;
  }
  notifyPanel();
}

function buildState() {
  const p = prefs();
  const hasKey = readApiKey() != null;
  return {
    version: app.getVersion(),
    platform: process.platform,
    pollSeconds: POLL_MS / 1000,
    lastUpdated,
    lastError,
    prefs: p,
    stocks: p.trackedSymbols.map((s) => stockView(s, quotes.get(s), logoDataUrl(s))),
    choices: {
      rotateInterval: ROTATE_INTERVAL_CHOICES.map((v) => ({ value: v, label: rotateIntervalLabel(v) })),
      scrollWidth: SCROLL_WIDTH_CHOICES.map((v) => ({ value: v, label: scrollWidthLabel(v) })),
      scrollSpeed: SCROLL_SPEED_CHOICES.map((v) => ({ value: v, label: scrollSpeedLabel(v) })),
      scrollDirection: (["rightToLeft", "leftToRight"] as const).map((v) => ({
        value: v,
        label: scrollDirectionTitle(v),
      })),
    },
    dailystocker: {
      baseURL: p.dailystockerBaseURL,
      mode: p.dailystockerMode,
      hasKey,
      configured: Boolean(p.dailystockerBaseURL) && hasKey,
    },
    positionSections: positionSections(positions),
    positionsLoaded: positions != null,
    positionsError,
    openAtLogin: app.getLoginItemSettings().openAtLogin,
  };
}

async function addSymbolFromPanel(raw: unknown): Promise<{ symbol: string } | { error: string }> {
  const symbol = normalizeSymbol(typeof raw === "string" ? raw : "");
  if (!symbol) return { error: "Enter a symbol like SOFI or AAPL." };
  if (prefs().trackedSymbols.includes(symbol)) return { error: `${symbol} is already on your list.` };
  const quote = await fetchQuote(symbol);
  if (!quote) return { error: `Yahoo did not return a quote for ${symbol}.` };
  store.update({ trackedSymbols: [...prefs().trackedSymbols, symbol] });
  quotes.set(symbol, quote);
  rescheduleTimers();
  render();
  void ensureLogo(symbol).then((landed) => {
    if (landed) {
      clearCapsuleLogoCache();
      scrollStrip = null;
      render();
    }
  });
  return { symbol };
}

function removeSymbolFromPanel(raw: unknown): { ok: true } | { error: string } {
  const next = removeSymbol(prefs().trackedSymbols, typeof raw === "string" ? raw : "");
  if (!next) return { error: "Tickr needs at least one symbol." };
  store.update({ trackedSymbols: next });
  for (const key of [...quotes.keys()]) if (!next.includes(key)) quotes.delete(key);
  if (rotateIndex >= next.length) rotateIndex = 0;
  rescheduleTimers();
  render();
  return { ok: true };
}

function setDisplayPrefs(raw: unknown): Prefs {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const patch: Record<string, unknown> = {};
  for (const key of DISPLAY_KEYS) if (key in input) patch[key] = input[key];
  const before = prefs();
  const next = store.update(patch as Partial<Prefs>);
  if (
    before.rotateOneAtATime !== next.rotateOneAtATime ||
    before.stackTwoTickers !== next.stackTwoTickers
  ) {
    rotateIndex = 0;
  }
  if (before.scrollTickers !== next.scrollTickers) {
    scrollOffsetPts = 0;
    scrollStrip = null;
  }
  rescheduleTimers();
  render();
  return next;
}

function saveDailystocker(raw: unknown): { ok: true } | { error: string } {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const url = typeof input.baseURL === "string" ? input.baseURL.trim() : "";
  const key = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
  if (url && !summaryURL(url, "live")) {
    return { error: `${BAD_URL_MESSAGE} Enter an https address such as https://example.com.` };
  }
  if (key && !writeApiKey(key)) return { error: "Could not save the API key." };
  store.update({ dailystockerBaseURL: url });
  positions = null;
  positionsError = null;
  void refreshPositions();
  notifyPanel();
  return { ok: true };
}

function setMode(raw: unknown): void {
  const mode: DailystockerMode = raw === "paper" ? "paper" : "live";
  store.update({ dailystockerMode: mode });
  positions = null;
  positionsError = null;
  void refreshPositions();
  notifyPanel();
}

function wireIpc(): void {
  ipcMain.handle("tickr:getState", () => buildState());
  ipcMain.handle("tickr:addSymbol", (_e, raw: unknown) => addSymbolFromPanel(raw));
  ipcMain.handle("tickr:removeSymbol", (_e, raw: unknown) => removeSymbolFromPanel(raw));
  ipcMain.handle("tickr:openNews", async (_e, raw: unknown) => {
    const url = yahooNewsURL(typeof raw === "string" ? raw : "");
    if (!url) return { error: "That symbol cannot open a news page." };
    await shell.openExternal(url);
    return { ok: true as const };
  });
  ipcMain.handle("tickr:refresh", async () => {
    await refresh();
  });
  ipcMain.handle("tickr:setPrefs", (_e, raw: unknown) => {
    setDisplayPrefs(raw);
  });
  ipcMain.handle("tickr:saveDailystocker", (_e, raw: unknown) => saveDailystocker(raw));
  ipcMain.handle("tickr:setMode", (_e, raw: unknown) => setMode(raw));
  ipcMain.handle("tickr:setOpenAtLogin", (_e, value: unknown) => {
    app.setLoginItemSettings({ openAtLogin: value === true });
    notifyPanel();
  });
  ipcMain.handle("tickr:hide", () => {
    panel?.hide();
  });
  ipcMain.handle("tickr:quit", () => {
    app.quit();
  });
  ipcMain.handle("tickr:fitHeight", (_e, height: unknown) => {
    if (typeof height === "number" && Number.isFinite(height)) fitPanelToContent(height);
  });
}

/**
 * Start at login on the first packaged launch, unless the Swift-era
 * `tickr enable` LaunchAgent already does that (two launchers would race).
 */
function enableLoginOnFirstRun(): void {
  if (!store.firstRun || !app.isPackaged) return;
  if (isMac && fs.existsSync(swiftLaunchAgentPath())) return;
  app.setLoginItemSettings({ openAtLogin: true });
}

function boot(): void {
  if (isMac) app.dock?.hide();
  store = new PrefsStore();
  enableLoginOnFirstRun();

  tray = new Tray(dotImage("flat", prefs().pastelBarColors));
  renderTray();
  tray.on("click", () => togglePanel());
  tray.on("right-click", () => {
    const menu = Menu.buildFromTemplate([
      { label: "Open Tickr", click: () => togglePanel() },
      { label: "Refresh", click: () => void refresh() },
      { type: "separator" },
      { label: "Quit Tickr", click: () => app.quit() },
    ]);
    tray?.popUpContextMenu(menu);
  });

  panel = createPanel();
  wireIpc();
  void refresh();
  pollTimer = setInterval(() => void refresh(), POLL_MS);
  rescheduleTimers();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(() => boot());

  app.on("second-instance", () => {
    togglePanel();
  });

  app.on("before-quit", () => {
    for (const t of [pollTimer, rotateTimer, scrollTimer]) if (t) clearInterval(t);
  });

  // Tray app: stay alive with no windows.
  app.on("window-all-closed", () => {});
}
