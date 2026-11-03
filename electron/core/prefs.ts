import { DEFAULT_SYMBOLS } from "./quote";

export const ROTATE_INTERVAL_CHOICES = [3, 5, 10, 15, 30, 60];
export const SCROLL_WIDTH_CHOICES = [100, 140, 180, 220, 280];
/** Points per second for the marquee. */
export const SCROLL_SPEED_CHOICES = [8, 14, 24, 40, 64, 96];

export type ScrollDirection = "rightToLeft" | "leftToRight";
export type DailystockerMode = "live" | "paper";

/**
 * Same keys as the Swift app's UserDefaults. Stack and scroll are mutually
 * exclusive; rotate can pair with stack (two at a time) or run alone.
 */
export interface Prefs {
  trackedSymbols: string[];
  rotateOneAtATime: boolean;
  rotateIntervalSeconds: number;
  stackTwoTickers: boolean;
  scrollTickers: boolean;
  scrollWidthPoints: number;
  scrollSpeedPointsPerSecond: number;
  scrollDirection: ScrollDirection;
  pastelBarColors: boolean;
  /** macOS tray title in green/red ANSI color. Electron only. */
  colorTrayTitle: boolean;
  dailystockerBaseURL: string;
  dailystockerMode: DailystockerMode;
}

export const DEFAULT_PREFS: Prefs = {
  trackedSymbols: [...DEFAULT_SYMBOLS],
  rotateOneAtATime: false,
  rotateIntervalSeconds: 5,
  stackTwoTickers: false,
  scrollTickers: false,
  scrollWidthPoints: 180,
  scrollSpeedPointsPerSecond: 40,
  scrollDirection: "rightToLeft",
  pastelBarColors: true,
  colorTrayTitle: true,
  dailystockerBaseURL: "",
  dailystockerMode: "live",
};

/** Uppercase ticker; keep letters, digits, `.`, `-`, `^`. */
export function normalizeSymbol(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9.\-^]/g, "");
}

/** Normalized, order-preserving, de-duplicated. Empty falls back to SOFI. */
export function cleanSymbols(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const s = normalizeSymbol(item);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out.length ? out : [...DEFAULT_SYMBOLS];
}

/** Returns the new list, or null when the symbol would empty the watchlist or is absent. */
export function removeSymbol(list: string[], raw: string): string[] | null {
  const symbol = normalizeSymbol(raw);
  if (list.length <= 1) return null;
  const next = list.filter((s) => s !== symbol);
  return next.length < list.length ? next : null;
}

function pick<T>(value: unknown, choices: readonly T[], fallback: T): T {
  return choices.includes(value as T) ? (value as T) : fallback;
}

export function sanitizePrefs(raw: unknown): Prefs {
  const r =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const bool = (key: keyof Prefs): boolean =>
    typeof r[key] === "boolean" ? (r[key] as boolean) : (DEFAULT_PREFS[key] as boolean);

  const prefs: Prefs = {
    trackedSymbols: cleanSymbols(r.trackedSymbols),
    rotateOneAtATime: bool("rotateOneAtATime"),
    rotateIntervalSeconds: pick(r.rotateIntervalSeconds, ROTATE_INTERVAL_CHOICES, 5),
    stackTwoTickers: bool("stackTwoTickers"),
    scrollTickers: bool("scrollTickers"),
    scrollWidthPoints: pick(r.scrollWidthPoints, SCROLL_WIDTH_CHOICES, 180),
    scrollSpeedPointsPerSecond: pick(r.scrollSpeedPointsPerSecond, SCROLL_SPEED_CHOICES, 40),
    scrollDirection: pick<ScrollDirection>(
      r.scrollDirection,
      ["rightToLeft", "leftToRight"],
      "rightToLeft",
    ),
    pastelBarColors: bool("pastelBarColors"),
    colorTrayTitle: bool("colorTrayTitle"),
    dailystockerBaseURL:
      typeof r.dailystockerBaseURL === "string" ? r.dailystockerBaseURL.trim() : "",
    dailystockerMode: r.dailystockerMode === "paper" ? "paper" : "live",
  };
  if (prefs.scrollTickers) {
    prefs.rotateOneAtATime = false;
    prefs.stackTwoTickers = false;
  }
  return prefs;
}

/** Scroll turns rotate and stack off; rotate or stack turns scroll off. */
export function applyPrefsPatch(current: Prefs, patch: Partial<Prefs>): Prefs {
  const next: Prefs = { ...current, ...patch };
  if (patch.scrollTickers === true) {
    next.rotateOneAtATime = false;
    next.stackTwoTickers = false;
  } else if (patch.rotateOneAtATime === true || patch.stackTwoTickers === true) {
    next.scrollTickers = false;
  }
  return sanitizePrefs(next);
}

export function rotateIntervalLabel(seconds: number): string {
  return seconds === 1 ? "1 second" : `${seconds} seconds`;
}

export function scrollWidthLabel(points: number): string {
  return `${points} pt`;
}

export function scrollSpeedLabel(pointsPerSecond: number): string {
  switch (pointsPerSecond) {
    case 8:
      return "Crawl";
    case 14:
      return "Very slow";
    case 24:
      return "Slow";
    case 40:
      return "Medium";
    case 64:
      return "Fast";
    case 96:
      return "Very fast";
    default:
      return `${pointsPerSecond} pt/s`;
  }
}

export function scrollDirectionTitle(direction: ScrollDirection): string {
  return direction === "rightToLeft" ? "Right to left" : "Left to right";
}

const SWIFT_KEYS: (keyof Prefs)[] = [
  "trackedSymbols",
  "rotateOneAtATime",
  "rotateIntervalSeconds",
  "stackTwoTickers",
  "scrollTickers",
  "scrollWidthPoints",
  "scrollSpeedPointsPerSecond",
  "scrollDirection",
  "pastelBarColors",
  "dailystockerBaseURL",
  "dailystockerMode",
];

function unescapeXml(s: string): string {
  return s
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

/**
 * Reads the Swift app's settings from `defaults export com.krsimmons.tickr -`
 * (XML plist). Only top-level keys Tickr owns are returned.
 */
export function parseSwiftDefaultsPlist(xml: string): Partial<Prefs> {
  const out: Record<string, unknown> = {};
  const re =
    /<key>([^<]+)<\/key>\s*(?:<(true|false)\s*\/>|<integer>([^<]*)<\/integer>|<real>([^<]*)<\/real>|<string>([^<]*)<\/string>|<array>([\s\S]*?)<\/array>|<array\s*\/>)/g;
  for (const m of xml.matchAll(re)) {
    const key = unescapeXml(m[1]) as keyof Prefs;
    if (!SWIFT_KEYS.includes(key)) continue;
    if (m[2] != null) out[key] = m[2] === "true";
    else if (m[3] != null) out[key] = Number(m[3]);
    else if (m[4] != null) out[key] = Number(m[4]);
    else if (m[5] != null) out[key] = unescapeXml(m[5]);
    else if (m[6] != null) {
      out[key] = [...m[6].matchAll(/<string>([^<]*)<\/string>/g)].map((s) =>
        unescapeXml(s[1]),
      );
    } else out[key] = [];
  }
  return out as Partial<Prefs>;
}
