import fs from "node:fs";
import path from "node:path";
import { nativeImage, type NativeImage } from "electron";
import { USER_AGENT } from "./core/quote";
import { normalizeSymbol } from "./core/prefs";
import { bundledLogosDir, logosDir } from "./paths";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
/** One download attempt per symbol per launch; a miss falls back to a dot / letter tile. */
const attempted = new Set<string>();
const trayCache = new Map<string, NativeImage>();
const dataUrlCache = new Map<string, string>();

export function logoPath(symbol: string): string | null {
  const name = `${normalizeSymbol(symbol)}.png`;
  for (const dir of [bundledLogosDir(), logosDir()]) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

/** Downloads from Financial Modeling Prep when missing. Resolves true when a new logo landed. */
export async function ensureLogo(symbol: string): Promise<boolean> {
  const name = normalizeSymbol(symbol);
  if (!name || logoPath(name) || attempted.has(name)) return false;
  attempted.add(name);
  try {
    const res = await fetch(`https://images.financialmodelingprep.com/symbol/${encodeURIComponent(name)}.png`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 8 || !buf.subarray(0, 4).equals(PNG_MAGIC)) return false;
    if (nativeImage.createFromBuffer(buf).isEmpty()) return false;
    const dest = path.join(logosDir(), `${name}.png`);
    fs.writeFileSync(`${dest}.tmp`, buf);
    fs.renameSync(`${dest}.tmp`, dest);
    return true;
  } catch {
    return false;
  }
}

function load(symbol: string): NativeImage | null {
  const file = logoPath(symbol);
  if (!file) return null;
  const img = nativeImage.createFromPath(file);
  return img.isEmpty() ? null : img;
}

/** 16pt tray image, drawn at 2x so it stays sharp on Retina / high-DPI trays. */
export function logoTrayImage(symbol: string): NativeImage | null {
  const key = normalizeSymbol(symbol);
  const cached = trayCache.get(key);
  if (cached) return cached;
  const img = load(key);
  if (!img) return null;
  const png = img.resize({ width: 32, height: 32, quality: "best" }).toPNG();
  const out = nativeImage.createFromBuffer(png, { scaleFactor: 2 });
  trayCache.set(key, out);
  return out;
}

export function logoDataUrl(symbol: string): string | null {
  const key = normalizeSymbol(symbol);
  const cached = dataUrlCache.get(key);
  if (cached) return cached;
  const img = load(key);
  if (!img) return null;
  const url = img.resize({ width: 48, height: 48, quality: "best" }).toDataURL();
  dataUrlCache.set(key, url);
  return url;
}
