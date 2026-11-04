import {
  change,
  changePercent,
  formatPrice,
  signedChange,
  type Quote,
} from "./quote";
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
