import { change, changePercent, signedChange, statusPrice, type Quote } from "./quote";
import {
  rotateIntervalLabel,
  scrollDirectionTitle,
  scrollSpeedLabel,
  type Prefs,
} from "./prefs";

export type Direction = "up" | "down" | "flat";

export interface BarEntry {
  symbol: string;
  priceText: string;
  direction: Direction;
}

export function directionOf(value: number): Direction {
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "flat";
}

/** Symbols shown in the tray right now (all, rotating one/pair, or scroll). */
export function barSymbols(symbols: string[], prefs: Prefs, rotateIndex: number): string[] {
  if (prefs.scrollTickers || symbols.length === 0) return symbols;
  if (prefs.stackTwoTickers) {
    if (prefs.rotateOneAtATime && symbols.length >= 3) {
      const i = rotateIndex % symbols.length;
      return i + 1 < symbols.length ? [symbols[i], symbols[i + 1]] : [symbols[i]];
    }
    return symbols;
  }
  if (!prefs.rotateOneAtATime) return symbols;
  return [symbols[rotateIndex % symbols.length]];
}

/**
 * How far the rotate index moves per tick, or null when rotation is idle.
 * Stack+rotate pages one pair and needs 3+ symbols; plain rotate needs 2+.
 */
export function rotateStep(prefs: Prefs, count: number): number | null {
  if (!prefs.rotateOneAtATime || prefs.scrollTickers) return null;
  if (count < (prefs.stackTwoTickers ? 3 : 2)) return null;
  return prefs.stackTwoTickers ? 2 : 1;
}

export function entriesFor(shown: string[], quotes: ReadonlyMap<string, Quote>): BarEntry[] {
  const entries = shown.map((symbol): BarEntry => {
    const q = quotes.get(symbol);
    if (!q) return { symbol, priceText: "—", direction: "flat" };
    return { symbol: q.symbol, priceText: statusPrice(q), direction: directionOf(change(q)) };
  });
  return entries.length ? entries : [{ symbol: "TICKR", priceText: "—", direction: "flat" }];
}

interface Run {
  text: string;
  direction: Direction;
}

const ANSI: Record<Direction, string> = { up: "\x1b[32m", down: "\x1b[31m", flat: "\x1b[0m" };
const RESET = "\x1b[0m";

/** Whitespace keeps the running color so separators do not emit extra codes. */
function colorize(runs: Run[], color: boolean): string {
  const plain = runs.map((r) => r.text).join("");
  if (!color || runs.every((r) => r.direction === "flat" || !r.text.trim())) return plain;
  let out = "";
  let current: Direction | null = null;
  for (const run of runs) {
    if (run.text.trim() && run.direction !== current) {
      out += ANSI[run.direction];
      current = run.direction;
    }
    out += run.text;
  }
  return out + RESET;
}

/** `$14.15  AAPL $230.10`; the first symbol is dropped when its logo is the tray image. */
export function titleText(
  entries: BarEntry[],
  opts: { omitFirstSymbol: boolean; color: boolean },
): string {
  const runs: Run[] = [{ text: " ", direction: "flat" }];
  entries.forEach((e, i) => {
    if (i > 0) runs.push({ text: "  ", direction: "flat" });
    const label = i === 0 && opts.omitFirstSymbol ? e.priceText : `${e.symbol} ${e.priceText}`;
    runs.push({ text: label, direction: e.direction });
  });
  return colorize(runs, opts.color);
}

export interface Cell {
  ch: string;
  direction: Direction;
}

const SCROLL_GAP = "   ";
/** Rough width of one monospaced menu-bar character, in points. */
const CHAR_POINTS = 7;

export function scrollCells(entries: BarEntry[]): Cell[] {
  const cells: Cell[] = [];
  for (const e of entries) {
    for (const ch of `${e.symbol} ${e.priceText}`) cells.push({ ch, direction: e.direction });
    for (const ch of SCROLL_GAP) cells.push({ ch, direction: "flat" });
  }
  return cells;
}

export function scrollWidthChars(points: number): number {
  return Math.max(8, Math.round(points / CHAR_POINTS));
}

export function scrollTickMs(pointsPerSecond: number): number {
  return Math.max(50, Math.round(1000 / Math.max(1, pointsPerSecond / CHAR_POINTS)));
}

/** A fixed-width window onto the looping strip; offset wraps in both directions. */
export function scrollFrame(cells: Cell[], width: number, offset: number, color: boolean): string {
  if (!cells.length) return "";
  const n = cells.length;
  const start = ((offset % n) + n) % n;
  const runs: Run[] = [];
  for (let i = 0; i < width; i++) {
    const cell = cells[(start + i) % n];
    const last = runs[runs.length - 1];
    if (last && last.direction === cell.direction) last.text += cell.ch;
    else runs.push({ text: cell.ch, direction: cell.direction });
  }
  return colorize(runs, color);
}

/** Every symbol with price and change; Windows has no tray title, so this is the main readout. */
export function tooltipText(
  symbols: string[],
  quotes: ReadonlyMap<string, Quote>,
  prefs: Prefs,
  lastError: string | null,
): string {
  const lines = symbols.map((s) => {
    const q = quotes.get(s);
    if (!q) return `${s} —`;
    return `${q.symbol} ${statusPrice(q)}  ${signedChange(change(q), changePercent(q))}`;
  });
  if (prefs.scrollTickers) {
    lines.push(
      `Scrolling ${symbols.length} tickers · ${scrollDirectionTitle(prefs.scrollDirection)} · ${scrollSpeedLabel(prefs.scrollSpeedPointsPerSecond)}`,
    );
  } else if (rotateStep(prefs, symbols.length) != null) {
    const every = rotateIntervalLabel(prefs.rotateIntervalSeconds);
    lines.push(
      prefs.stackTwoTickers
        ? `Rotating pairs of ${symbols.length} · every ${every}`
        : `Rotating ${symbols.length} tickers · every ${every}`,
    );
  }
  if (lastError) lines.push(lastError);
  return lines.join("\n");
}
