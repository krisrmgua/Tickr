import XCTest
@testable import TickrCore

final class YahooQuoteParseTests: XCTestCase {
    func testParsesChartMeta() throws {
        let json = """
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
                "quote": [{
                  "close": [15.20, null, 14.90, 14.15]
                }]
              }
            }]
          }
        }
        """.data(using: .utf8)!

        let quote = try XCTUnwrap(YahooQuoteParse.quote(from: json))
        XCTAssertEqual(quote.symbol, "SOFI")
        XCTAssertEqual(quote.price, 14.15, accuracy: 0.000_001)
        XCTAssertEqual(quote.previousClose, 15.24, accuracy: 0.000_001)
        XCTAssertEqual(quote.change, 14.15 - 15.24, accuracy: 0.000_001)
        XCTAssertEqual(quote.shortName, "SoFi Technologies, Inc.")
        XCTAssertEqual(quote.intradayCloses, [15.20, 14.90, 14.15])
        XCTAssertEqual(QuoteFormatting.statusTitle(quote), "SOFI $14.15")
    }

    func testRejectsMissingResult() {
        XCTAssertNil(YahooQuoteParse.quote(from: Data(#"{"chart":{"result":null}}"#.utf8)))
    }

    func testSparklineNeedsTwoPoints() {
        XCTAssertNil(DaySparkline.image(closes: [14.1], previousClose: 15.0, upDay: false))
        XCTAssertNotNil(DaySparkline.image(
            closes: [15.0, 14.5, 14.1], previousClose: 15.2, upDay: false))
    }

    func testChartURLUsesIntradayBars() throws {
        let url = try XCTUnwrap(YahooQuoteClient.chartURL(symbol: "SOFI"))
        XCTAssertTrue(url.absoluteString.contains("interval=5m"))
        XCTAssertTrue(url.absoluteString.contains("range=1d"))
    }
}
