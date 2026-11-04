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
  applyPrefsPatch,
  DEFAULT_PREFS,
  normalizeSymbol,
  parseSwiftDefaultsPlist,
  yahooNewsURL,
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
check("yahoo news url", yahooNewsURL(" sofi ") === "https://finance.yahoo.com/quote/SOFI/news/");
check(
  "yahoo news encodes index",
  yahooNewsURL("^gspc") === "https://finance.yahoo.com/quote/%5EGSPC/news/",
);
check("yahoo news rejects blank", yahooNewsURL("  ") == null);
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
</dict></plist>`;
const imported = sanitizePrefs({ ...DEFAULT_PREFS, ...parseSwiftDefaultsPlist(plist) });
check("swift import symbols", imported.trackedSymbols.join() === "SOFI,AAPL");
check("swift import rotate", imported.rotateOneAtATime && imported.rotateIntervalSeconds === 10);
check("swift import pastel off", !imported.pastelBarColors);

if (failed === 0) {
  console.log("self-check: all passed");
  process.exit(0);
}
console.log(`self-check: ${failed} failed`);
process.exit(1);
