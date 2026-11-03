import AppKit
import Foundation

public enum TickrCLI {
    public static func run() {
        let args = Array(CommandLine.arguments.dropFirst())
        if args.contains("--self-check") {
            let ok = TickrSelfChecks.run()
            exit(ok ? 0 : 1)
        }
        if args.contains("--help") || args.contains("-h") {
            fputs("""
            Tickr — menu-bar stock quotes (Yahoo Finance)

            Usage:
              Tickr                 launch the menu-bar app
              Tickr --self-check    offline parse checks
              Tickr --help

            """, stderr)
            exit(0)
        }

        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.accessory)
        app.run()
    }
}

enum TickrSelfChecks {
    static func run() -> Bool {
        var failed = 0
        func check(_ name: String, _ condition: Bool) {
            if condition {
                print("ok  \(name)")
            } else {
                print("FAIL \(name)")
                failed += 1
            }
        }

        let fixture = """
        {
          "chart": {
            "result": [{
              "meta": {
                "currency": "USD",
                "symbol": "SOFI",
                "regularMarketPrice": 14.15,
                "chartPreviousClose": 15.24,
                "shortName": "SoFi Technologies, Inc.",
                "regularMarketTime": 1792006846
              },
              "indicators": {
                "quote": [{ "close": [15.20, null, 14.90, 14.15] }]
              }
            }],
            "error": null
          }
        }
        """.data(using: .utf8)!

        let quote = YahooQuoteParse.quote(from: fixture)
        check("parses SOFI fixture", quote != nil)
        check("symbol", quote?.symbol == "SOFI")
        check("price", abs((quote?.price ?? 0) - 14.15) < 0.0001)
        check("previousClose", abs((quote?.previousClose ?? 0) - 15.24) < 0.0001)
        check("change negative", (quote?.change ?? 0) < 0)
        check("intraday closes", quote?.intradayCloses == [15.20, 14.90, 14.15])
        check("sparkline draws", DaySparkline.image(
            closes: quote?.intradayCloses ?? [], previousClose: 15.24, upDay: false) != nil)
        check("status price", QuoteFormatting.statusPrice(quote!) == "$14.15")
        check("status title fallback", QuoteFormatting.statusTitle(quote!) == "SOFI $14.15")
        check("down day is red", quote!.change < 0)
        check("SOFI logo asset", SymbolLogo.resolvePath(for: "SOFI") != nil)
        check("normalize ticker", Watchlist.normalize(" aapl ") == "AAPL")
        check("rotate interval choices", TickrPrefs.rotateIntervalChoices == [3, 5, 10, 15, 30, 60])
        check("rotate interval label", TickrPrefs.rotateIntervalLabel(5) == "5 seconds")
        let previousStack = UserDefaults.standard.object(forKey: "stackTwoTickers")
        let previousScroll = UserDefaults.standard.object(forKey: "scrollTickers")
        let previousRotate = UserDefaults.standard.object(forKey: "rotateOneAtATime")
        UserDefaults.standard.set(true, forKey: "scrollTickers")
        UserDefaults.standard.set(false, forKey: "stackTwoTickers")
        TickrPrefs.stackTwoTickers = true
        check("stack turns scroll off", TickrPrefs.stackTwoTickers && !TickrPrefs.scrollTickers)
        TickrPrefs.scrollTickers = true
        check("scroll turns stack off", TickrPrefs.scrollTickers && !TickrPrefs.stackTwoTickers)
        if let previousStack { UserDefaults.standard.set(previousStack, forKey: "stackTwoTickers") }
        else { UserDefaults.standard.removeObject(forKey: "stackTwoTickers") }
        if let previousScroll { UserDefaults.standard.set(previousScroll, forKey: "scrollTickers") }
        else { UserDefaults.standard.removeObject(forKey: "scrollTickers") }
        if let previousRotate { UserDefaults.standard.set(previousRotate, forKey: "rotateOneAtATime") }
        else { UserDefaults.standard.removeObject(forKey: "rotateOneAtATime") }
        check("scroll width choices", TickrPrefs.scrollWidthChoices.contains(180))
        check("scroll speed label", TickrPrefs.scrollSpeedLabel(40) == "Medium")
        check("scroll direction default title",
              TickrPrefs.ScrollDirection.rightToLeft.title == "Right to left")
        check("rejects empty", YahooQuoteParse.quote(from: Data("{}".utf8)) == nil)
        check("chart URL", YahooQuoteClient.chartURL(symbol: "SOFI")?.host == "query1.finance.yahoo.com")
        check("intraday interval", YahooQuoteClient.chartURL(symbol: "SOFI")?
            .absoluteString.contains("interval=5m") == true)

        let positionsFixture = """
        {
          "mode": "live",
          "generated_at": "2026-10-21T15:00:00.123456+00:00",
          "futures": {
            "enabled": true,
            "recorded_at": "2026-10-21T14:58:00.654321+00:00",
            "stale": false,
            "total_unrealized_pnl": -140.0,
            "total_day_pnl": 15.0,
            "groups": [
              {"root": "MES", "total_unrealized_pnl": 110.0, "total_day_pnl": 20.0,
               "contracts": [
                 {"symbol": "MESH7", "qty": -1, "side": "SHORT", "avg": 6500.0, "mark": 6490.0,
                  "unrealized_pnl": 10.0, "day_pnl": -5.0},
                 {"symbol": "MESU6", "qty": 2, "side": "LONG", "avg": 6400.25, "mark": 6410.25,
                  "unrealized_pnl": 100.0, "day_pnl": 25.0}
               ]},
              {"root": "ES", "total_unrealized_pnl": -250.0, "total_day_pnl": -40.0,
               "contracts": [
                 {"symbol": "ESU6", "qty": 1, "side": "LONG", "avg": 6400.0, "mark": 6395.0,
                  "unrealized_pnl": -250.0, "day_pnl": -40.0}
               ]}
            ]
          },
          "options": {
            "enabled": false,
            "recorded_at": null,
            "stale": false,
            "total_unrealized_pnl": 0.0,
            "total_day_pnl": 0.0,
            "groups": []
          }
        }
        """.data(using: .utf8)!

        let summary = DailystockerParse.summary(from: positionsFixture)
        check("parses positions summary", summary != nil)
        check("futures enabled", summary?.futures.enabled == true)
        check("options disabled", summary?.options.enabled == false)
        check("futures roots in order", summary?.futures.groups.map(\.root) == ["MES", "ES"])
        check("MES group total", summary?.futures.groups.first?.totalUnrealizedPnl == 110.0)
        check("contract fields", summary?.futures.groups.first?.contracts.last?.avg == 6400.25)
        check("short side kept", summary?.futures.groups.first?.contracts.first?.side == "SHORT")
        check("microsecond timestamp parses", summary?.futures.recordedAt != nil)
        check("not stale", summary?.futures.stale == false)
        check("rejects non-JSON", DailystockerParse.summary(from: Data("nope".utf8)) == nil)
        check("rejects missing sections", DailystockerParse.summary(
            from: Data(#"{"mode":"live"}"#.utf8)) == nil)
        check("summary URL is https", DailystockerClient.summaryURL(
            baseURL: "https://example.com", mode: "live")?
            .absoluteString == "https://example.com/api/positions/summary.json?mode=live")
        check("summary URL refuses http", DailystockerClient.summaryURL(
            baseURL: "http://example.com", mode: "live") == nil)
        check("summary URL paper mode", DailystockerClient.summaryURL(
            baseURL: "https://example.com/some/other", mode: "paper")?
            .path == "/api/positions/summary.json")
        check("signed money positive", PositionFormatting.signedMoney(110) == "+$110.00")
        check("signed money negative", PositionFormatting.signedMoney(-12.5) == "-$12.50")
        check("quantity whole", PositionFormatting.quantity(2) == "2")
        check("futures contract line", PositionFormatting.contractLine(
            summary!.futures.groups.first!.contracts.last!)
            == "MESU6  LONG 2 @ 6400.25  +$100.00  (day +$25.00)")

        if failed == 0 {
            print("self-check: all passed")
            return true
        }
        print("self-check: \(failed) failed")
        return false
    }
}
