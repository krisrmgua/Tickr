import { createCanvas, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { nativeImage, type NativeImage } from "electron";
import { COLORS } from "./trayIcon";
import { logoPath } from "./logos";
import type { BarEntry, Direction } from "./core/ticker";

/** Swift `applyBarBackground`: black @ 0.55. Stack radius matches TokenPulse (6). */
const CAPSULE = "rgba(0, 0, 0, 0.55)";
const RADIUS_ROW = 5;
const RADIUS_STACK = 6;
const SCALE = 2;

const ROW_HEIGHT = 22;
const ROW_PAD_X = 6;
const ROW_LOGO = 14;
const ROW_FONT =
  '500 12px ".AppleSystemUIFontMonospacedDigit", "SF Pro Text", Menlo, monospace';
const ROW_GAP = 10;

/** Two price rows with a gap so the logos are not sitting on each other. */
const STACK_HEIGHT = 34;
const STACK_PAD_X = 7;
const STACK_PAD_Y = 3;
const STACK_ROW = 12;
const STACK_ROW_GAP = 4;
const STACK_LOGO = 12;
const STACK_GAP = 10;
const STACK_FONT =
  '600 12px ".AppleSystemUIFontMonospacedDigit", "SF Pro Text", Menlo, monospace';

const logoCache = new Map<string, Image | null>();

export interface CapsuleOpts {
  entries: BarEntry[];
  stacked: boolean;
  pastel: boolean;
  color: boolean;
  /** When a logo is present, paint `ADBE $246.14` instead of just the price. */
  showSymbol: boolean;
}

function priceLabel(entry: BarEntry, showSymbol: boolean, hasLogo: boolean): string {
  // No logo → always include the symbol. With a logo, optional `ADBE $246.14`.
  if (!hasLogo || showSymbol) return `${entry.symbol} ${entry.priceText}`;
  return entry.priceText;
}

/** Pre-rendered marquee strip (logos + prices, no capsule). Composited each frame. */
export interface ScrollStrip {
  image: Image;
  width: number;
  height: number;
  key: string;
}

/** Space between the end of the strip and the next loop copy. 0 = seamless. */
export const SCROLL_LOOP_GAP = 0;

function roundRect(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function ink(direction: Direction, pastel: boolean, color: boolean): string {
  if (!color || direction === "flat") return "#ffffff";
  return COLORS[pastel ? "pastel" : "saturated"][direction];
}

async function logo(symbol: string): Promise<Image | null> {
  const key = symbol.toUpperCase();
  if (logoCache.has(key)) return logoCache.get(key) ?? null;
  const file = logoPath(key);
  if (!file) {
    logoCache.set(key, null);
    return null;
  }
  try {
    const img = await loadImage(file);
    logoCache.set(key, img);
    return img;
  } catch {
    logoCache.set(key, null);
    return null;
  }
}

function drawBandText(
  ctx: SKRSContext2D,
  text: string,
  x: number,
  bandTop: number,
  bandH: number,
  color: string,
): number {
  const m = ctx.measureText(text);
  const ascent = m.actualBoundingBoxAscent ?? 9;
  const descent = m.actualBoundingBoxDescent ?? 0;
  const y = bandTop + (bandH - (ascent + descent)) / 2 + ascent;
  ctx.fillStyle = color;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, x, y);
  return Math.ceil(m.width);
}

async function measureRow(
  ctx: SKRSContext2D,
  entries: BarEntry[],
  showSymbol: boolean,
): Promise<number> {
  ctx.font = ROW_FONT;
  let x = ROW_PAD_X;
  for (let i = 0; i < entries.length; i++) {
    if (i > 0) x += ROW_GAP;
    const e = entries[i];
    const hasLogo = Boolean(await logo(e.symbol));
    if (hasLogo) x += ROW_LOGO + 4;
    x += Math.ceil(ctx.measureText(priceLabel(e, showSymbol, hasLogo)).width);
  }
  return x + ROW_PAD_X;
}

async function paintRow(
  ctx: SKRSContext2D,
  entries: BarEntry[],
  pastel: boolean,
  color: boolean,
  showSymbol: boolean,
): Promise<void> {
  ctx.font = ROW_FONT;
  let x = ROW_PAD_X;
  for (let i = 0; i < entries.length; i++) {
    if (i > 0) x += ROW_GAP;
    const e = entries[i];
    const c = ink(e.direction, pastel, color);
    const img = await logo(e.symbol);
    const hasLogo = Boolean(img);
    if (img) {
      ctx.drawImage(img, x, (ROW_HEIGHT - ROW_LOGO) / 2, ROW_LOGO, ROW_LOGO);
      x += ROW_LOGO + 4;
    }
    x += drawBandText(ctx, priceLabel(e, showSymbol, hasLogo), x, 0, ROW_HEIGHT, c);
  }
}

async function columnWidths(
  ctx: SKRSContext2D,
  columns: BarEntry[][],
  showSymbol: boolean,
): Promise<number[]> {
  ctx.font = STACK_FONT;
  const widths: number[] = [];
  for (const col of columns) {
    let w = 36;
    for (const e of col) {
      const hasLogo = Boolean(await logo(e.symbol));
      const textW = Math.ceil(ctx.measureText(priceLabel(e, showSymbol, hasLogo)).width);
      const row = hasLogo ? STACK_LOGO + 3 + textW : textW;
      w = Math.max(w, row);
    }
    widths.push(w);
  }
  return widths;
}

async function measureStack(
  ctx: SKRSContext2D,
  entries: BarEntry[],
  showSymbol: boolean,
): Promise<number> {
  const columns: BarEntry[][] = [];
  for (let i = 0; i < entries.length; i += 2) columns.push(entries.slice(i, i + 2));
  const widths = await columnWidths(ctx, columns, showSymbol);
  return Math.max(
    40,
    STACK_PAD_X * 2 + widths.reduce((a, b) => a + b, 0) + Math.max(0, columns.length - 1) * STACK_GAP,
  );
}

async function paintStack(
  ctx: SKRSContext2D,
  entries: BarEntry[],
  pastel: boolean,
  color: boolean,
  showSymbol: boolean,
): Promise<void> {
  ctx.font = STACK_FONT;
  const columns: BarEntry[][] = [];
  for (let i = 0; i < entries.length; i += 2) columns.push(entries.slice(i, i + 2));
  const widths = await columnWidths(ctx, columns, showSymbol);

  let originX = STACK_PAD_X;
  for (let c = 0; c < columns.length; c++) {
    for (let r = 0; r < columns[c].length; r++) {
      const e = columns[c][r];
      const rowTop = STACK_PAD_Y + r * (STACK_ROW + STACK_ROW_GAP);
      let x = originX;
      const colorInk = ink(e.direction, pastel, color);
      const img = await logo(e.symbol);
      const hasLogo = Boolean(img);
      if (img) {
        ctx.drawImage(img, x, rowTop + (STACK_ROW - STACK_LOGO) / 2, STACK_LOGO, STACK_LOGO);
        x += STACK_LOGO + 3;
      }
      drawBandText(ctx, priceLabel(e, showSymbol, hasLogo), x, rowTop, STACK_ROW, colorInk);
    }
    originX += widths[c] + STACK_GAP;
  }
}

export function scrollStripKey(
  entries: BarEntry[],
  pastel: boolean,
  color: boolean,
  showSymbol: boolean,
): string {
  return JSON.stringify({
    pastel,
    color,
    showSymbol,
    e: entries.map((x) => [x.symbol, x.priceText, x.direction]),
  });
}

/**
 * Full ticker row with logos (Swift `barTitle`), used as the scrolling strip.
 * Rebuild when quotes / prefs change; keep across smooth scroll frames.
 */
export async function buildScrollStrip(
  entries: BarEntry[],
  pastel: boolean,
  color: boolean,
  showSymbol: boolean,
): Promise<ScrollStrip> {
  const key = scrollStripKey(entries, pastel, color, showSymbol);
  const measure = createCanvas(4, 4).getContext("2d");
  const contentW = Math.max(36, await measureRow(measure, entries, showSymbol));
  const canvas = createCanvas(Math.ceil(contentW * SCALE), Math.ceil(ROW_HEIGHT * SCALE));
  const ctx = canvas.getContext("2d");
  ctx.scale(SCALE, SCALE);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  await paintRow(ctx, entries, pastel, color, showSymbol);
  const image = await loadImage(canvas.toBuffer("image/png"));
  return { image, width: contentW, height: ROW_HEIGHT, key };
}

export function scrollLoopPeriod(stripWidth: number, _viewportWidth?: number): number {
  // Period is the strip only — do not pad out to the viewport or the join
  // shows a long empty stretch before the next logos.
  return Math.max(stripWidth + SCROLL_LOOP_GAP, 1);
}

/**
 * Capsule viewport over a pre-rendered strip. Sync — call every ~30fps with a
 * point offset (Swift marquee), not character steps.
 */
export function scrollCapsuleFrame(
  strip: ScrollStrip,
  viewportWidth: number,
  offsetPts: number,
  rightToLeft: boolean,
): NativeImage {
  const width = Math.max(80, Math.ceil(viewportWidth));
  const height = ROW_HEIGHT;
  const period = scrollLoopPeriod(strip.width, width);
  let offset = period > 0 ? ((offsetPts % period) + period) % period : 0;

  const canvas = createCanvas(Math.ceil(width * SCALE), Math.ceil(height * SCALE));
  const ctx = canvas.getContext("2d");
  ctx.scale(SCALE, SCALE);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  roundRect(ctx, 0, 0, width, height, RADIUS_ROW);
  ctx.fillStyle = CAPSULE;
  ctx.fill();

  ctx.save();
  roundRect(ctx, 0, 0, width, height, RADIUS_ROW);
  ctx.clip();
  let x = rightToLeft ? -offset : offset - period;
  while (x < width + period) {
    ctx.drawImage(strip.image, x, 0, strip.width, strip.height);
    x += period;
  }
  ctx.restore();

  return nativeImage.createFromBuffer(canvas.toBuffer("image/png"), {
    scaleFactor: SCALE,
    width,
    height,
  });
}

/**
 * Swift menu-bar capsule: dark rounded backdrop with logo + price content.
 * Returns a 2× Retina PNG sized in points. (Row / stack only — scroll uses
 * `buildScrollStrip` + `scrollCapsuleFrame`.)
 */
export async function trayCapsuleImage(opts: CapsuleOpts): Promise<NativeImage> {
  const stacked = opts.stacked;
  const height = stacked ? STACK_HEIGHT : ROW_HEIGHT;

  const measure = createCanvas(4, 4).getContext("2d");
  let width = stacked
    ? await measureStack(measure, opts.entries, opts.showSymbol)
    : await measureRow(measure, opts.entries, opts.showSymbol);
  width = Math.max(36, Math.ceil(width));

  const canvas = createCanvas(Math.ceil(width * SCALE), Math.ceil(height * SCALE));
  const ctx = canvas.getContext("2d");
  ctx.scale(SCALE, SCALE);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  roundRect(ctx, 0, 0, width, height, stacked ? RADIUS_STACK : RADIUS_ROW);
  ctx.fillStyle = CAPSULE;
  ctx.fill();

  if (stacked) await paintStack(ctx, opts.entries, opts.pastel, opts.color, opts.showSymbol);
  else await paintRow(ctx, opts.entries, opts.pastel, opts.color, opts.showSymbol);

  return nativeImage.createFromBuffer(canvas.toBuffer("image/png"), {
    scaleFactor: SCALE,
    width,
    height,
  });
}

/** Drop cached logos after a download lands so the next frame picks them up. */
export function clearCapsuleLogoCache(): void {
  logoCache.clear();
}
