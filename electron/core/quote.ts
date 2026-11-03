/** One symbol quote from Yahoo Finance's chart endpoint. */
export interface Quote {
  symbol: string;
  shortName: string | null;
  price: number;
  previousClose: number;
  currency: string;
  /** Epoch milliseconds of the last regular-market trade. */
  marketTime: number | null;
  /** Intraday closes (5m bars) for the sparkline; empty if unavailable. */
  intradayCloses: number[];
}

export const DEFAULT_SYMBOLS = ["SOFI"];
export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Tickr/1.0";
const TIMEOUT_MS = 15_000;

export function change(q: Quote): number {
  return q.price - q.previousClose;
}

export function changePercent(q: Quote): number {
  if (q.previousClose === 0) return 0;
  return (change(q) / q.previousClose) * 100;
}

export function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Parse `v8/finance/chart/{symbol}` JSON into a `Quote`. */
export function parseYahooChart(json: unknown, fallbackSymbol = ""): Quote | null {
  const chart = record(record(json)?.chart);
  const results = chart?.result;
  if (!Array.isArray(results) || results.length === 0) return null;
  const first = record(results[0]);
  const meta = record(first?.meta);
  if (!first || !meta) return null;

  const symbol = typeof meta.symbol === "string" ? meta.symbol.trim() : "";
  const resolved = symbol || fallbackSymbol;
  if (!resolved) return null;

  const price = num(meta.regularMarketPrice) ?? num(meta.previousClose);
  if (price == null) return null;
  const previousClose =
    num(meta.chartPreviousClose) ?? num(meta.previousClose) ?? price;
  const ts = num(meta.regularMarketTime);

  return {
    symbol: resolved.toUpperCase(),
    shortName: typeof meta.shortName === "string" ? meta.shortName : null,
    price,
    previousClose,
    currency: typeof meta.currency === "string" ? meta.currency : "USD",
    marketTime: ts == null ? null : ts * 1000,
    intradayCloses: intradayCloses(first),
  };
}

/** `indicators.quote[0].close`, dropping nulls / non-numbers. */
export function intradayCloses(result: Record<string, unknown>): number[] {
  const quotes = record(result.indicators)?.quote;
  if (!Array.isArray(quotes)) return [];
  const raw = record(quotes[0])?.close;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v) => num(v))
    .filter((v): v is number => v != null && v > 0);
}

/** 5-minute bars for the current session; `meta` still carries the live quote. */
export function chartURL(symbol: string): string {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=5m&range=1d`;
}

export async function fetchQuote(symbol: string): Promise<Quote | null> {
  try {
    const res = await fetch(chartURL(symbol), {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return parseYahooChart(await res.json(), symbol);
  } catch {
    return null;
  }
}

export function formatPrice(value: number, currency = "USD"): string {
  if (currency === "USD") return `$${value.toFixed(2)}`;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

export function signedChange(value: number, percent: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)} (${sign}${percent.toFixed(2)}%)`;
}

/** Compact tray price only (the logo replaces the ticker text). */
export function statusPrice(q: Quote): string {
  return formatPrice(q.price, q.currency);
}

/** Fallback when no logo is available: `SOFI $14.15`. */
export function statusTitle(q: Quote): string {
  return `${q.symbol} ${statusPrice(q)}`;
}
