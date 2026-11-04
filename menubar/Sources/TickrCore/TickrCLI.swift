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
        let previousPastel = UserDefaults.standard.object(forKey: "pastelBarColors")
        UserDefaults.standard.removeObject(forKey: "pastelBarColors")
        check("pastel defaults on", TickrPrefs.pastelBarColors)
        TickrPrefs.pastelBarColors = false
        check("pastel can turn off", !TickrPrefs.pastelBarColors)
        if let previousPastel { UserDefaults.standard.set(previousPastel, forKey: "pastelBarColors") }
        else { UserDefaults.standard.removeObject(forKey: "pastelBarColors") }
        check("pastel green is soft",
              TickrPalette.green.greenComponent > TickrPalette.green.redComponent)
        check("pastel red is soft",
              TickrPalette.red.redComponent > TickrPalette.red.greenComponent)
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

        if failed == 0 {
            print("self-check: all passed")
            return true
        }
        print("self-check: \(failed) failed")
        return false
    }
}
