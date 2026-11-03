import {
  change,
  changePercent,
  formatPrice,
  signedChange,
  type Quote,
} from "./quote";
import {
  contractLine,
  signedMoney,
  type PositionGroup,
  type PositionSection,
  type PositionSummary,
} from "./positions";
import { directionOf, type Direction } from "./ticker";

/** Display-ready rows so the panel renderer never re-implements formatting. */
export interface StockView {
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

export interface ContractView {
  line: string;
  direction: Direction;
}

export interface GroupView {
  root: string;
  totalText: string;
  direction: Direction;
  summary: string;
  contracts: ContractView[];
}

export interface SectionView {
  title: string;
  totalText: string;
  direction: Direction;
  warning: string | null;
  emptyText: string | null;
  groups: GroupView[];
}

export function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function stockView(symbol: string, quote: Quote | undefined, logo: string | null): StockView {
  if (!quote) {
    return {
      symbol,
      name: symbol,
      logo,
      hasQuote: false,
      direction: "flat",
      priceText: "—",
      changeText: "no quote yet",
      prevText: "—",
      asOfText: null,
      closes: [],
      previousClose: 0,
    };
  }
  return {
    symbol: quote.symbol,
    name: quote.shortName ?? quote.symbol,
    logo,
    hasQuote: true,
    direction: directionOf(change(quote)),
    priceText: formatPrice(quote.price, quote.currency),
    changeText: signedChange(change(quote), changePercent(quote)),
    prevText: formatPrice(quote.previousClose, quote.currency),
    asOfText: quote.marketTime == null ? null : clock(quote.marketTime),
    closes: quote.intradayCloses,
    previousClose: quote.previousClose,
  };
}

function groupView(g: PositionGroup): GroupView {
  const total = signedMoney(g.totalUnrealizedPnl);
  return {
    root: g.root,
    totalText: total,
    direction: directionOf(g.totalUnrealizedPnl),
    summary: `${g.root}  open ${total}  ·  day ${signedMoney(g.totalDayPnl)}`,
    contracts: g.contracts.map((c) => ({
      line: contractLine(c),
      direction: directionOf(c.unrealizedPnl),
    })),
  };
}

function sectionView(title: string, s: PositionSection): SectionView {
  let warning: string | null = null;
  if (s.recordedAt == null) warning = "No snapshot yet";
  else if (s.stale) warning = `Snapshot ${clock(s.recordedAt)} — stale`;
  return {
    title,
    totalText: signedMoney(s.totalUnrealizedPnl),
    direction: directionOf(s.totalUnrealizedPnl),
    warning,
    emptyText: s.groups.length ? null : `No open ${title.toLowerCase()}`,
    groups: s.groups.map(groupView),
  };
}

export function positionSections(summary: PositionSummary | null): SectionView[] {
  if (!summary) return [];
  const out: SectionView[] = [];
  if (summary.futures.enabled) out.push(sectionView("Futures", summary.futures));
  if (summary.options.enabled) out.push(sectionView("Options", summary.options));
  return out;
}
