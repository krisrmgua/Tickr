type Direction = "up" | "down" | "flat";

interface StockView {
  symbol: string;
  name: string;
  logo: string | null;
  hasQuote: boolean;
  direction: Direction;
  priceText: string;
  changeText: string;
  prevText: string;
  asOfText: string | null;
  closes: number[];
  previousClose: number;
}

interface GroupView {
  root: string;
  totalText: string;
  direction: Direction;
  summary: string;
  contracts: { line: string; direction: Direction }[];
}

interface SectionView {
  title: string;
  totalText: string;
  direction: Direction;
  warning: string | null;
  emptyText: string | null;
  groups: GroupView[];
}

interface Choice<T = number> {
  value: T;
  label: string;
}

interface Prefs {
  trackedSymbols: string[];
  rotateOneAtATime: boolean;
  rotateIntervalSeconds: number;
  stackTwoTickers: boolean;
  scrollTickers: boolean;
  scrollWidthPoints: number;
  scrollSpeedPointsPerSecond: number;
  scrollDirection: "rightToLeft" | "leftToRight";
  pastelBarColors: boolean;
  colorTrayTitle: boolean;
  dailystockerBaseURL: string;
  dailystockerMode: "live" | "paper";
}

interface State {
  version: string;
  platform: string;
  pollSeconds: number;
  lastUpdated: number | null;
  lastError: string | null;
  prefs: Prefs;
  stocks: StockView[];
  choices: {
    rotateInterval: Choice[];
    scrollWidth: Choice[];
    scrollSpeed: Choice[];
    scrollDirection: Choice<string>[];
  };
  dailystocker: { baseURL: string; mode: "live" | "paper"; hasKey: boolean; configured: boolean };
  positionSections: SectionView[];
  positionsLoaded: boolean;
  positionsError: string | null;
  openAtLogin: boolean;
}

declare global {
  interface Window {
    tickr: {
      getState: () => Promise<State>;
      addSymbol: (symbol: string) => Promise<{ symbol: string } | { error: string }>;
      removeSymbol: (symbol: string) => Promise<{ ok: true } | { error: string }>;
      refresh: () => Promise<void>;
      setPrefs: (patch: Partial<Prefs>) => Promise<void>;
      saveDailystocker: (input: { baseURL: string; apiKey: string }) => Promise<{ ok: true } | { error: string }>;
      setMode: (mode: "live" | "paper") => Promise<void>;
      setOpenAtLogin: (value: boolean) => Promise<void>;
      onChanged: (cb: () => void) => () => void;
      hide: () => Promise<void>;
      quit: () => Promise<void>;
      fitHeight: (height: number) => Promise<void>;
    };
  }
}

let state: State | null = null;
/** Symbols / position roots the user has expanded; rows start collapsed. */
const expanded = new Set<string>();
let dsFormLoaded = false;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const statusLine = $("status-line");
const stockList = $("stock-list");
const stockError = $("stock-error");
const positionsView = $("view-positions");
const positionsTab = $("tab-positions");
const addForm = $<HTMLFormElement>("add-form");
const addInput = $<HTMLInputElement>("add-input");
const addHint = $("add-hint");
const dsForm = $<HTMLFormElement>("ds-form");
const dsUrl = $<HTMLInputElement>("ds-url");
const dsKey = $<HTMLInputElement>("ds-key");
const dsHint = $("ds-hint");

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function requestFit(): void {
  requestAnimationFrame(() => {
    const app = document.getElementById("app");
    if (!app) return;
    void window.tickr.fitHeight(Math.ceil(app.getBoundingClientRect().height));
  });
}

function selectTab(name: string): void {
  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.tab === name);
  });
  document.querySelectorAll(".view").forEach((v) => {
    v.classList.toggle("active", v.id === `view-${name}`);
  });
  requestFit();
}

document.querySelectorAll<HTMLButtonElement>(".tab").forEach((btn) => {
  btn.addEventListener("click", () => selectTab(btn.dataset.tab ?? "stocks"));
});

/** Line of session closes; dashed horizontal is the previous close. */
function sparkline(closes: number[], previousClose: number, upDay: boolean): string {
  const pts = closes.filter((v) => Number.isFinite(v) && v > 0);
  if (pts.length < 2) return "";
  const w = 340;
  const h = 48;
  const pad = { x: 8, y: 6 };
  const lo = Math.min(...pts, previousClose);
  let hi = Math.max(...pts, previousClose);
  if (hi <= lo) hi = lo + 0.01;
  const y = (v: number) => (pad.y + (h - pad.y * 2) * (1 - (v - lo) / (hi - lo))).toFixed(1);
  const x = (i: number) => (pad.x + ((w - pad.x * 2) * i) / (pts.length - 1)).toFixed(1);
  const path = pts.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ");
  const prevY = y(previousClose);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <line class="guide" x1="${pad.x}" y1="${prevY}" x2="${w - pad.x}" y2="${prevY}" />
    <path class="line ${upDay ? "up" : "down"}" d="${path}" vector-effect="non-scaling-stroke" />
  </svg>`;
}

function logoHtml(s: StockView): string {
  if (s.logo) return `<img class="logo" src="${s.logo}" alt="" />`;
  return `<span class="logo letter">${escapeHtml(s.symbol.slice(0, 1))}</span>`;
}

function renderStocks(s: State): void {
  stockError.textContent = s.lastError ?? "";
  stockError.classList.toggle("hidden", !s.lastError);
  const canRemove = s.stocks.length > 1;
  stockList.innerHTML = s.stocks
    .map((stock) => {
      const open = expanded.has(`stock:${stock.symbol}`);
      const details = stock.hasQuote
        ? `${sparkline(stock.closes, stock.previousClose, stock.direction !== "down")}
          <dl class="kv">
            <dt>Price</dt><dd class="${stock.direction}">${escapeHtml(stock.priceText)}</dd>
            <dt>Change</dt><dd class="${stock.direction}">${escapeHtml(stock.changeText)}</dd>
            <dt>Prev</dt><dd class="${stock.direction}">${escapeHtml(stock.prevText)}</dd>
            ${stock.asOfText ? `<dt>As of</dt><dd>${escapeHtml(stock.asOfText)}</dd>` : ""}
          </dl>`
        : `<div class="note">${escapeHtml(stock.symbol)} — no quote yet</div>`;
      return `<article class="card stock${open ? " open" : ""}" data-symbol="${escapeHtml(stock.symbol)}">
        <button type="button" class="stock-toggle" aria-expanded="${open}">
          <span class="chev" aria-hidden="true"></span>
          ${logoHtml(stock)}
          <span class="stock-main">
            <span class="stock-name">${escapeHtml(stock.name)}</span>
            <span class="stock-symbol">${escapeHtml(stock.symbol)}</span>
          </span>
          <span class="stock-price">
            <div class="price ${stock.direction}">${escapeHtml(stock.priceText)}</div>
            <div class="chg ${stock.direction}">${stock.hasQuote ? escapeHtml(stock.changeText) : ""}</div>
          </span>
        </button>
        <div class="stock-body">
          ${details}
          ${canRemove ? `<div class="row-actions"><button type="button" class="danger" data-act="remove">Remove ${escapeHtml(stock.symbol)}</button></div>` : ""}
        </div>
      </article>`;
    })
    .join("");

  stockList.querySelectorAll<HTMLElement>(".stock").forEach((card) => {
    const symbol = card.dataset.symbol ?? "";
    card.querySelector(".stock-toggle")?.addEventListener("click", () => {
      const key = `stock:${symbol}`;
      if (expanded.has(key)) expanded.delete(key);
      else expanded.add(key);
      card.classList.toggle("open");
      requestFit();
    });
    card.querySelector('[data-act="remove"]')?.addEventListener("click", async () => {
      const ok = await askConfirm({
        title: `Remove ${symbol}?`,
        message: `Stop tracking ${symbol}? You can add it again later.`,
        confirmLabel: "Remove",
        danger: true,
      });
      if (!ok) return;
      const res = await window.tickr.removeSymbol(symbol);
      if ("error" in res) addHint.textContent = res.error;
    });
  });
}

function renderPositions(s: State): void {
  positionsTab.classList.toggle("hidden", !s.dailystocker.configured);
  if (!s.dailystocker.configured) {
    if (positionsTab.classList.contains("active")) selectTab("stocks");
    positionsView.innerHTML = "";
    return;
  }
  const paper = s.dailystocker.mode === "paper";
  const parts: string[] = [
    `<div class="mode-row">
      <span>Mode: <strong class="${paper ? "mode-paper" : "mode-live"}">${paper ? "Paper" : "Live"}</strong></span>
      <button type="button" class="ghost" id="btn-mode">Switch to ${paper ? "Live" : "Paper"}</button>
    </div>`,
  ];
  if (s.positionsError) parts.push(`<div class="warn">${escapeHtml(s.positionsError)}</div>`);
  if (!s.positionSections.length && !s.positionsError) {
    parts.push(
      `<div class="empty">${s.positionsLoaded ? "Futures and options are both off on the dashboard." : "Loading positions…"}</div>`,
    );
  }
  for (const section of s.positionSections) {
    parts.push(`<div class="section-head">
      <span>${escapeHtml(section.title)}</span>
      <span class="${section.direction}">${escapeHtml(section.totalText)}</span>
    </div>`);
    if (section.warning) parts.push(`<div class="warn">${escapeHtml(section.warning)}</div>`);
    if (section.emptyText) parts.push(`<div class="note card">${escapeHtml(section.emptyText)}</div>`);
    for (const group of section.groups) {
      const key = `group:${section.title}:${group.root}`;
      const open = expanded.has(key);
      parts.push(`<article class="card stock${open ? " open" : ""}" data-key="${escapeHtml(key)}">
        <button type="button" class="stock-toggle" aria-expanded="${open}">
          <span class="chev" aria-hidden="true"></span>
          <span class="stock-main"><span class="stock-name">${escapeHtml(group.root)}</span></span>
          <span class="stock-price"><div class="price ${group.direction}">${escapeHtml(group.totalText)}</div></span>
        </button>
        <div class="stock-body group-lines">
          <div class="summary ${group.direction}">${escapeHtml(group.summary)}</div>
          ${group.contracts.map((c) => `<div class="${c.direction}">${escapeHtml(c.line)}</div>`).join("")}
        </div>
      </article>`);
    }
  }
  positionsView.innerHTML = parts.join("");

  positionsView.querySelector("#btn-mode")?.addEventListener("click", () => {
    void window.tickr.setMode(paper ? "live" : "paper");
  });
  positionsView.querySelectorAll<HTMLElement>("article[data-key]").forEach((card) => {
    const key = card.dataset.key ?? "";
    card.querySelector(".stock-toggle")?.addEventListener("click", () => {
      if (expanded.has(key)) expanded.delete(key);
      else expanded.add(key);
      card.classList.toggle("open");
      requestFit();
    });
  });
}

function fillSelect<T extends string | number>(id: string, choices: Choice<T>[], selected: T): void {
  const el = $<HTMLSelectElement>(id);
  if (el.options.length !== choices.length) {
    el.innerHTML = choices
      .map((c) => `<option value="${escapeHtml(String(c.value))}">${escapeHtml(c.label)}</option>`)
      .join("");
  }
  el.value = String(selected);
}

function renderSettings(s: State): void {
  const p = s.prefs;
  const isMac = s.platform === "darwin";
  $("bar-heading").textContent = isMac ? "Menu bar" : "System tray";
  $<HTMLInputElement>("p-rotate").checked = p.rotateOneAtATime;
  $<HTMLInputElement>("p-stack").checked = p.stackTwoTickers;
  $<HTMLInputElement>("p-scroll").checked = p.scrollTickers;
  $<HTMLInputElement>("p-pastel").checked = p.pastelBarColors;
  $<HTMLInputElement>("p-color-title").checked = p.colorTrayTitle;
  $<HTMLInputElement>("p-login").checked = s.openAtLogin;
  fillSelect("p-rotate-interval", s.choices.rotateInterval, p.rotateIntervalSeconds);
  fillSelect("p-scroll-width", s.choices.scrollWidth, p.scrollWidthPoints);
  fillSelect("p-scroll-speed", s.choices.scrollSpeed, p.scrollSpeedPointsPerSecond);
  fillSelect("p-scroll-direction", s.choices.scrollDirection, p.scrollDirection);
  $("row-rotate-interval").classList.toggle("hidden", !p.rotateOneAtATime);
  $("scroll-opts").classList.toggle("hidden", !p.scrollTickers);
  $("p-stack").closest("label")?.classList.toggle("hidden", !isMac);
  $("bar-note").textContent = isMac
    ? "Stack shows two tickers side by side in the title; rotate with stack pages through pairs."
    : "Windows trays show an icon only: rotate cycles the logo, and the tooltip lists every price.";

  if (!dsFormLoaded) {
    dsUrl.value = s.dailystocker.baseURL;
    dsFormLoaded = true;
  }
  dsKey.placeholder = s.dailystocker.hasKey ? "stored (leave blank to keep)" : "paste key";
}

function renderStatus(s: State): void {
  if (s.lastUpdated) {
    const at = new Date(s.lastUpdated).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    statusLine.textContent = `Updated ${at} · every ${s.pollSeconds}s`;
  } else {
    statusLine.textContent = s.lastError ?? "Waiting for Yahoo quote…";
  }
}

function render(): void {
  if (!state) return;
  document.body.classList.toggle("pastel", state.prefs.pastelBarColors);
  document.body.classList.toggle("win", state.platform !== "darwin");
  $("app-version").textContent = `v${state.version}`;
  renderStatus(state);
  renderStocks(state);
  renderPositions(state);
  renderSettings(state);
  requestFit();
}

async function refreshState(): Promise<void> {
  state = await window.tickr.getState();
  render();
}

function bindCheckbox(id: string, key: keyof Prefs): void {
  $<HTMLInputElement>(id).addEventListener("change", (e) => {
    void window.tickr.setPrefs({ [key]: (e.target as HTMLInputElement).checked });
  });
}

function bindSelect(id: string, key: keyof Prefs, numeric: boolean): void {
  $<HTMLSelectElement>(id).addEventListener("change", (e) => {
    const raw = (e.target as HTMLSelectElement).value;
    void window.tickr.setPrefs({ [key]: numeric ? Number(raw) : raw });
  });
}

bindCheckbox("p-rotate", "rotateOneAtATime");
bindCheckbox("p-stack", "stackTwoTickers");
bindCheckbox("p-scroll", "scrollTickers");
bindCheckbox("p-pastel", "pastelBarColors");
bindCheckbox("p-color-title", "colorTrayTitle");
bindSelect("p-rotate-interval", "rotateIntervalSeconds", true);
bindSelect("p-scroll-width", "scrollWidthPoints", true);
bindSelect("p-scroll-speed", "scrollSpeedPointsPerSecond", true);
bindSelect("p-scroll-direction", "scrollDirection", false);
$<HTMLInputElement>("p-login").addEventListener("change", (e) => {
  void window.tickr.setOpenAtLogin((e.target as HTMLInputElement).checked);
});

addForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const raw = addInput.value.trim();
  if (!raw) return;
  addHint.classList.remove("error");
  addHint.textContent = `Checking ${raw.toUpperCase()} with Yahoo…`;
  const res = await window.tickr.addSymbol(raw);
  if ("error" in res) {
    addHint.classList.add("error");
    addHint.textContent = res.error;
  } else {
    addHint.textContent = `Added ${res.symbol}.`;
    addInput.value = "";
  }
  requestFit();
});

dsForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  dsHint.classList.remove("error");
  const res = await window.tickr.saveDailystocker({ baseURL: dsUrl.value, apiKey: dsKey.value });
  if ("error" in res) {
    dsHint.classList.add("error");
    dsHint.textContent = res.error;
  } else {
    dsKey.value = "";
    dsHint.textContent = dsUrl.value.trim() ? "Saved. Positions are loading." : "Saved. Positions hidden.";
  }
  requestFit();
});

$("btn-refresh").addEventListener("click", async () => {
  const btn = $<HTMLButtonElement>("btn-refresh");
  btn.disabled = true;
  try {
    await window.tickr.refresh();
  } finally {
    btn.disabled = false;
  }
});

$("btn-quit").addEventListener("click", () => {
  void window.tickr.quit();
});

function askConfirm(opts: {
  title: string;
  message: string;
  confirmLabel: string;
  danger: boolean;
}): Promise<boolean> {
  const root = $("confirm");
  const cancel = $<HTMLButtonElement>("confirm-cancel");
  const ok = $<HTMLButtonElement>("confirm-ok");
  $("confirm-title").textContent = opts.title;
  $("confirm-message").textContent = opts.message;
  ok.textContent = opts.confirmLabel;
  ok.className = opts.danger ? "danger" : "primary";
  root.classList.remove("hidden");
  ok.focus();

  return new Promise((resolve) => {
    const finish = (value: boolean) => {
      root.classList.add("hidden");
      cancel.removeEventListener("click", onCancel);
      ok.removeEventListener("click", onOk);
      root.removeEventListener("click", onBackdrop);
      document.removeEventListener("keydown", onKey, true);
      resolve(value);
    };
    const onCancel = () => finish(false);
    const onOk = () => finish(true);
    const onBackdrop = (e: MouseEvent) => {
      if (e.target === root) finish(false);
    };
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") finish(false);
      if (e.key === "Enter") finish(true);
    };
    cancel.addEventListener("click", onCancel);
    ok.addEventListener("click", onOk);
    root.addEventListener("click", onBackdrop);
    document.addEventListener("keydown", onKey, true);
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") void window.tickr.hide();
});

void refreshState();
window.tickr.onChanged(() => {
  void refreshState();
});
window.addEventListener("load", () => requestFit());

export {};
