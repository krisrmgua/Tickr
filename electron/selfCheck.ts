/**
 * Offline parse and logic checks (`npm run check`). Imports only `core/`, so it
 * runs under plain Node without Electron, Yahoo, or a dashboard.
 */
import {
  chartURL,
  change,
  parseYahooChart,
  statusPrice,
  statusTitle,
  type Quote,
} from "./core/quote";
import {
  contractLine,
  parseSummary,
  quantity,
  signedMoney,
  summaryURL,
} from "./core/positions";
import {
  applyPrefsPatch,
  DEFAULT_PREFS,
  normalizeSymbol,
  parseSwiftDefaultsPlist,
  removeSymbol,
  rotateIntervalLabel,
  ROTATE_INTERVAL_CHOICES,
  sanitizePrefs,
  scrollDirectionTitle,
  scrollSpeedLabel,
  SCROLL_WIDTH_CHOICES,
} from "./core/prefs";
import {
  barSymbols,
  entriesFor,
  rotateStep,
  scrollCells,
  scrollFrame,
  titleText,
} from "./core/ticker";

let failed = 0;
function check(name: string, condition: boolean): void {
  console.log(`${condition ? "ok  " : "FAIL"} ${name}`);
  if (!condition) failed++;
}

const fixture = {
  chart: {
    result: [
      {
        meta: {
          currency: "USD",
          symbol: "SOFI",
          regularMarketPrice: 14.15,
          chartPreviousClose: 15.24,
          shortName: "SoFi Technologies, Inc.",
          regularMarketTime: 1792006846,
        },
        indicators: { quote: [{ close: [15.2, null, 14.9, 14.15] }] },
      },
    ],
    error: null,
  },
};

const quote = parseYahooChart(fixture);
check("parses SOFI fixture", quote != null);
check("symbol", quote?.symbol === "SOFI");
check("price", Math.abs((quote?.price ?? 0) - 14.15) < 0.0001);
check("previousClose", Math.abs((quote?.previousClose ?? 0) - 15.24) < 0.0001);
check("change negative", quote != null && change(quote) < 0);
check("intraday closes", JSON.stringify(quote?.intradayCloses) === "[15.2,14.9,14.15]");
check("market time in ms", quote?.marketTime === 1792006846000);
check("status price", quote != null && statusPrice(quote) === "$14.15");
check("status title fallback", quote != null && statusTitle(quote) === "SOFI $14.15");
check("normalize ticker", normalizeSymbol(" aapl ") === "AAPL");
check("normalize keeps ^.-", normalizeSymbol("^gspc brk.b-x!") === "^GSPCBRK.B-X");
check("rejects empty", parseYahooChart({}) == null);
check("chart URL host", new URL(chartURL("SOFI")).host === "query1.finance.yahoo.com");
check("intraday interval", chartURL("SOFI").includes("interval=5m"));

check("rotate interval choices", JSON.stringify(ROTATE_INTERVAL_CHOICES) === "[3,5,10,15,30,60]");
check("rotate interval label", rotateIntervalLabel(5) === "5 seconds");
check("scroll width choices", SCROLL_WIDTH_CHOICES.includes(180));
check("scroll speed label", scrollSpeedLabel(40) === "Medium");
check("scroll direction default title", scrollDirectionTitle("rightToLeft") === "Right to left");
check("pastel defaults on", DEFAULT_PREFS.pastelBarColors);
check("default watchlist", JSON.stringify(sanitizePrefs({}).trackedSymbols) === '["SOFI"]');
check("empty watchlist falls back", sanitizePrefs({ trackedSymbols: [] }).trackedSymbols[0] === "SOFI");
check("watchlist de-dupes", sanitizePrefs({ trackedSymbols: ["sofi", "SOFI", "aapl"] }).trackedSymbols.join() === "SOFI,AAPL");
check("bad interval falls back", sanitizePrefs({ rotateIntervalSeconds: 7 }).rotateIntervalSeconds === 5);

const scrolling = applyPrefsPatch(DEFAULT_PREFS, { scrollTickers: true });
const stacked = applyPrefsPatch(scrolling, { stackTwoTickers: true });
check("stack turns scroll off", stacked.stackTwoTickers && !stacked.scrollTickers);
const rescrolled = applyPrefsPatch(stacked, { scrollTickers: true });
check("scroll turns stack off", rescrolled.scrollTickers && !rescrolled.stackTwoTickers);
const rotating = applyPrefsPatch(rescrolled, { rotateOneAtATime: true });
check("rotate turns scroll off", rotating.rotateOneAtATime && !rotating.scrollTickers);
check("last symbol cannot be removed", removeSymbol(["SOFI"], "SOFI") == null);
check("remove symbol", removeSymbol(["SOFI", "AAPL"], "aapl")?.join() === "SOFI");

const three = ["A", "B", "C"];
const rotatePrefs = { ...DEFAULT_PREFS, rotateOneAtATime: true };
check("rotate shows one", barSymbols(three, rotatePrefs, 4).join() === "B");
check("rotate step 1", rotateStep(rotatePrefs, 3) === 1);
check("rotate idle with one symbol", rotateStep(rotatePrefs, 1) == null);
const pairPrefs = { ...rotatePrefs, stackTwoTickers: true };
check("stack+rotate pages a pair", barSymbols(three, pairPrefs, 0).join() === "A,B");
check("stack+rotate odd leftover", barSymbols(three, pairPrefs, 2).join() === "C");
check("stack+rotate step 2", rotateStep(pairPrefs, 3) === 2);
check("all mode shows every symbol", barSymbols(three, DEFAULT_PREFS, 1).join() === "A,B,C");

const quotes = new Map<string, Quote>();
if (quote) quotes.set("SOFI", quote);
const entries = entriesFor(["SOFI", "AAPL"], quotes);
check("missing quote placeholder", entries[1].priceText === "—");
check("plain title", titleText(entries, { omitFirstSymbol: true, color: false }) === " $14.15  AAPL —");
check("ansi title is red for a down day", titleText(entries, { omitFirstSymbol: false, color: true }).includes("\x1b[31mSOFI $14.15"));
check("empty watchlist placeholder", entriesFor([], quotes)[0].symbol === "TICKR");
const cells = scrollCells(entries);
check("scroll frame width", scrollFrame(cells, 10, 0, false).length === 10);
check("scroll frame wraps backwards", scrollFrame(cells, 4, -1, false) === " SOF");

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>NSStatusItem Visible Item-0</key><true/>
  <key>trackedSymbols</key><array><string>SOFI</string><string>AAPL</string></array>
  <key>rotateOneAtATime</key><true/>
  <key>rotateIntervalSeconds</key><integer>10</integer>
  <key>pastelBarColors</key><false/>
  <key>dailystockerBaseURL</key><string>https://example.com/a&amp;b</string>
  <key>dailystockerMode</key><string>paper</string>
</dict></plist>`;
const imported = sanitizePrefs({ ...DEFAULT_PREFS, ...parseSwiftDefaultsPlist(plist) });
check("swift import symbols", imported.trackedSymbols.join() === "SOFI,AAPL");
check("swift import rotate", imported.rotateOneAtATime && imported.rotateIntervalSeconds === 10);
check("swift import pastel off", !imported.pastelBarColors);
check("swift import url unescaped", imported.dailystockerBaseURL === "https://example.com/a&b");
check("swift import paper mode", imported.dailystockerMode === "paper");

const positionsFixture = {
  mode: "live",
  generated_at: "2026-10-21T15:00:00.123456+00:00",
  futures: {
    enabled: true,
    recorded_at: "2026-10-21T14:58:00.654321+00:00",
    stale: false,
    total_unrealized_pnl: -140.0,
    total_day_pnl: 15.0,
    groups: [
      {
        root: "MES",
        total_unrealized_pnl: 110.0,
        total_day_pnl: 20.0,
        contracts: [
          { symbol: "MESH7", qty: -1, side: "SHORT", avg: 6500.0, mark: 6490.0, unrealized_pnl: 10.0, day_pnl: -5.0 },
          { symbol: "MESU6", qty: 2, side: "LONG", avg: 6400.25, mark: 6410.25, unrealized_pnl: 100.0, day_pnl: 25.0 },
        ],
      },
      {
        root: "ES",
        total_unrealized_pnl: -250.0,
        total_day_pnl: -40.0,
        contracts: [
          { symbol: "ESU6", qty: 1, side: "LONG", avg: 6400.0, mark: 6395.0, unrealized_pnl: -250.0, day_pnl: -40.0 },
        ],
      },
    ],
  },
  options: {
    enabled: false,
    recorded_at: null,
    stale: false,
    total_unrealized_pnl: 0.0,
    total_day_pnl: 0.0,
    groups: [],
  },
};

const summary = parseSummary(positionsFixture);
check("parses positions summary", summary != null);
check("futures enabled", summary?.futures.enabled === true);
check("options disabled", summary?.options.enabled === false);
check("futures roots in order", summary?.futures.groups.map((g) => g.root).join() === "MES,ES");
check("MES group total", summary?.futures.groups[0]?.totalUnrealizedPnl === 110);
check("contract fields", summary?.futures.groups[0]?.contracts[1]?.avg === 6400.25);
check("short side kept", summary?.futures.groups[0]?.contracts[0]?.side === "SHORT");
check("microsecond timestamp parses", summary?.futures.recordedAt != null);
check("not stale", summary?.futures.stale === false);
check("rejects non-object", parseSummary("nope") == null);
check("rejects missing sections", parseSummary({ mode: "live" }) == null);
check(
  "summary URL is https",
  summaryURL("https://example.com", "live") === "https://example.com/api/positions/summary.json?mode=live",
);
check("summary URL refuses http", summaryURL("http://example.com", "live") == null);
check(
  "summary URL paper mode",
  new URL(summaryURL("https://example.com/some/other", "paper") ?? "https://x").pathname ===
    "/api/positions/summary.json",
);
check("signed money positive", signedMoney(110) === "+$110.00");
check("signed money negative", signedMoney(-12.5) === "-$12.50");
check("quantity whole", quantity(2) === "2");
check(
  "futures contract line",
  summary != null &&
    contractLine(summary.futures.groups[0].contracts[1]) === "MESU6  LONG 2 @ 6400.25  +$100.00  (day +$25.00)",
);
check(
  "options contract line",
  contractLine({
    symbol: "SPY",
    qty: 1,
    side: "LONG",
    avg: 2.5,
    mark: 3.1,
    unrealizedPnl: 60,
    dayPnl: 12,
    optionType: "CALL",
    strike: 770,
    expiration: "2026-08-11",
  }) === "2026-08-11 CALL 770  LONG 1 @ 2.50  +$60.00  (day +$12.00)",
);

if (failed === 0) {
  console.log("self-check: all passed");
  process.exit(0);
}
console.log(`self-check: ${failed} failed`);
process.exit(1);
