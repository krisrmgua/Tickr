import { num, record } from "./quote";

/** One open futures or options contract from dailystocker's positions summary. */
export interface PositionContract {
  symbol: string;
  qty: number;
  side: string;
  avg: number;
  mark: number;
  unrealizedPnl: number;
  dayPnl: number;
  optionType: string | null;
  strike: number | null;
  expiration: string | null;
}

/** Contracts sharing a root symbol (MES, SPY, ...), with their combined P&L. */
export interface PositionGroup {
  root: string;
  totalUnrealizedPnl: number;
  totalDayPnl: number;
  contracts: PositionContract[];
}

/**
 * One section of the summary (futures or options). `stale` means the server's
 * last snapshot is older than its threshold, so the numbers may lag the broker.
 */
export interface PositionSection {
  enabled: boolean;
  /** Epoch milliseconds. */
  recordedAt: number | null;
  stale: boolean;
  totalUnrealizedPnl: number;
  totalDayPnl: number;
  groups: PositionGroup[];
}

export interface PositionSummary {
  mode: string;
  generatedAt: number | null;
  futures: PositionSection;
  options: PositionSection;
}

export type PositionsResult =
  | { ok: true; summary: PositionSummary }
  | { ok: false; error: string };

const TIMEOUT_MS = 15_000;

export function httpErrorMessage(status: number): string {
  if (status === 401) return "Dailystocker rejected the API key (401)";
  if (status === 503) return "Dailystocker API key not configured on the server (503)";
  return `Dailystocker HTTP ${status}`;
}

export const BAD_URL_MESSAGE = "Dailystocker URL must be https://…";
export const UNREADABLE_MESSAGE = "Dailystocker response unreadable";

/**
 * Python isoformat can emit microseconds; trim the fraction to milliseconds
 * before parsing so every engine reads it the same way.
 */
export function parseDate(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  const trimmed = value.replace(/(\.\d{3})\d+/, "$1");
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? ms : null;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function contract(raw: Record<string, unknown>): PositionContract {
  return {
    symbol: str(raw.symbol),
    qty: num(raw.qty) ?? 0,
    side: str(raw.side),
    avg: num(raw.avg) ?? 0,
    mark: num(raw.mark) ?? 0,
    unrealizedPnl: num(raw.unrealized_pnl) ?? 0,
    dayPnl: num(raw.day_pnl) ?? 0,
    optionType: typeof raw.option_type === "string" ? raw.option_type : null,
    strike: num(raw.strike),
    expiration: typeof raw.expiration === "string" ? raw.expiration : null,
  };
}

function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.map(record).filter((r): r is Record<string, unknown> => r != null);
}

function group(raw: Record<string, unknown>): PositionGroup {
  return {
    root: str(raw.root),
    totalUnrealizedPnl: num(raw.total_unrealized_pnl) ?? 0,
    totalDayPnl: num(raw.total_day_pnl) ?? 0,
    contracts: records(raw.contracts).map(contract),
  };
}

function section(raw: Record<string, unknown>): PositionSection {
  return {
    enabled: raw.enabled === true,
    recordedAt: parseDate(raw.recorded_at),
    stale: typeof raw.stale === "boolean" ? raw.stale : true,
    totalUnrealizedPnl: num(raw.total_unrealized_pnl) ?? 0,
    totalDayPnl: num(raw.total_day_pnl) ?? 0,
    groups: records(raw.groups).map(group),
  };
}

/** Parse the JSON from `GET /api/positions/summary.json`. */
export function parseSummary(json: unknown): PositionSummary | null {
  const root = record(json);
  if (!root || typeof root.mode !== "string") return null;
  const futures = record(root.futures);
  const options = record(root.options);
  if (!futures || !options) return null;
  return {
    mode: root.mode,
    generatedAt: parseDate(root.generated_at),
    futures: section(futures),
    options: section(options),
  };
}

/** https only: the API key travels in a header, so plain http is refused. */
export function summaryURL(baseURL: string, mode: string): string | null {
  let url: URL;
  try {
    url = new URL(baseURL.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !url.hostname) return null;
  url.pathname = "/api/positions/summary.json";
  url.search = "";
  url.hash = "";
  url.searchParams.set("mode", mode);
  return url.toString();
}

export async function fetchPositions(
  baseURL: string,
  mode: string,
  apiKey: string,
): Promise<PositionsResult> {
  const url = summaryURL(baseURL, mode);
  if (!url) return { ok: false, error: BAD_URL_MESSAGE };
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "X-Api-Key": apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Dailystocker unreachable (${why})` };
  }
  if (!res.ok) return { ok: false, error: httpErrorMessage(res.status) };
  try {
    const summary = parseSummary(await res.json());
    return summary ? { ok: true, summary } : { ok: false, error: UNREADABLE_MESSAGE };
  } catch {
    return { ok: false, error: UNREADABLE_MESSAGE };
  }
}

/** "+$110.00" / "-$12.50" (no thousands separator, to keep rows short). */
export function signedMoney(value: number): string {
  const sign = value < 0 ? "-" : "+";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

/** Whole numbers without a decimal point: 2 -> "2", 1.5 -> "1.5". */
export function quantity(qty: number): string {
  return String(qty);
}

/**
 * Futures: "MESU6  LONG 2 @ 6400.25  +$100.00  (day +$25.00)"
 * Options: "2026-08-11 CALL 770  LONG 1 @ 2.50  +$60.00  (day +$12.00)"
 */
export function contractLine(c: PositionContract): string {
  let label = c.symbol;
  if (c.optionType) {
    const strike = c.strike == null ? "" : String(Number(c.strike.toPrecision(6)));
    label = [c.expiration ?? "", c.optionType, strike].filter(Boolean).join(" ");
  }
  const side = c.side ? `${c.side} ` : "";
  return (
    `${label}  ${side}${quantity(c.qty)} @ ${c.avg.toFixed(2)}  ` +
    `${signedMoney(c.unrealizedPnl)}  (day ${signedMoney(c.dayPnl)})`
  );
}
