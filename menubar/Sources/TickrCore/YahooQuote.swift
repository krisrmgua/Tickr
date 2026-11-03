import Foundation

/// One symbol quote from Yahoo Finance's chart endpoint.
struct Quote: Equatable, Sendable {
    let symbol: String
    let shortName: String?
    let price: Double
    let previousClose: Double
    let currency: String
    let marketTime: Date?
    /// Intraday closes (e.g. 5m bars) for the sparkline; empty if unavailable.
    let intradayCloses: [Double]

    var change: Double { price - previousClose }
    var changePercent: Double {
        guard previousClose != 0 else { return 0 }
        return (change / previousClose) * 100
    }
}

enum YahooQuoteParse {
    /// Parse `v8/finance/chart/{symbol}` JSON into a `Quote`.
    static func quote(from data: Data, fallbackSymbol: String = "") -> Quote? {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let chart = root["chart"] as? [String: Any],
              let results = chart["result"] as? [[String: Any]],
              let first = results.first,
              let meta = first["meta"] as? [String: Any]
        else { return nil }

        let symbol = (meta["symbol"] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let resolved = (symbol?.isEmpty == false) ? symbol! : fallbackSymbol
        guard !resolved.isEmpty else { return nil }

        guard let price = number(meta["regularMarketPrice"]) ?? number(meta["previousClose"])
        else { return nil }
        let previous = number(meta["chartPreviousClose"])
            ?? number(meta["previousClose"])
            ?? price
        let currency = (meta["currency"] as? String) ?? "USD"
        let shortName = meta["shortName"] as? String
        let marketTime: Date? = {
            guard let ts = number(meta["regularMarketTime"]) else { return nil }
            return Date(timeIntervalSince1970: ts)
        }()

        return Quote(
            symbol: resolved.uppercased(),
            shortName: shortName,
            price: price,
            previousClose: previous,
            currency: currency,
            marketTime: marketTime,
            intradayCloses: closes(from: first)
        )
    }

    /// `indicators.quote[0].close`, dropping nulls / non-numbers.
    static func closes(from result: [String: Any]) -> [Double] {
        guard let indicators = result["indicators"] as? [String: Any],
              let quotes = indicators["quote"] as? [[String: Any]],
              let first = quotes.first,
              let raw = first["close"] as? [Any]
        else { return [] }
        return raw.compactMap { number($0) }.filter { $0 > 0 && $0.isFinite }
    }

    private static func number(_ value: Any?) -> Double? {
        switch value {
        case let d as Double: return d
        case let i as Int: return Double(i)
        case let n as NSNumber: return n.doubleValue
        case let s as String: return Double(s)
        default: return nil
        }
    }
}

enum YahooQuoteClient {
    static let defaultSymbols = ["SOFI"]
    static let userAgent =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Tickr/1.0"

    /// 5-minute bars for the current session → enough points for a daily sparkline,
    /// while `meta` still carries the live quote fields.
    static func chartURL(symbol: String) -> URL? {
        let encoded = symbol.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? symbol
        return URL(string:
            "https://query1.finance.yahoo.com/v8/finance/chart/\(encoded)?interval=5m&range=1d")
    }

    static func fetch(symbol: String, session: URLSession = .shared,
                      completion: @escaping (Quote?) -> Void) {
        guard let url = chartURL(symbol: symbol) else {
            DispatchQueue.main.async { completion(nil) }
            return
        }
        var request = URLRequest(url: url, timeoutInterval: 15)
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        session.dataTask(with: request) { data, response, _ in
            let quote: Quote?
            if let data,
               let http = response as? HTTPURLResponse,
               (200...299).contains(http.statusCode) {
                quote = YahooQuoteParse.quote(from: data, fallbackSymbol: symbol)
            } else {
                quote = nil
            }
            DispatchQueue.main.async { completion(quote) }
        }.resume()
    }
}

enum QuoteFormatting {
    static func price(_ value: Double, currency: String = "USD") -> String {
        if currency == "USD" {
            return String(format: "$%.2f", value)
        }
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.numberStyle = .currency
        formatter.currencyCode = currency
        formatter.maximumFractionDigits = 2
        formatter.minimumFractionDigits = 2
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.2f %@", value, currency)
    }

    static func signedChange(_ value: Double, percent: Double) -> String {
        let sign = value >= 0 ? "+" : ""
        return String(format: "%@%.2f (%@%.2f%%)", sign, value, sign, percent)
    }

    /// Compact menu-bar price only (logo replaces the ticker text).
    static func statusPrice(_ quote: Quote) -> String {
        price(quote.price, currency: quote.currency)
    }

    /// Fallback when no logo is bundled: `SOFI $14.15`.
    static func statusTitle(_ quote: Quote) -> String {
        "\(quote.symbol) \(statusPrice(quote))"
    }
}
