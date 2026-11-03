import Foundation

/// One open futures or options contract from dailystocker's positions summary.
struct PositionContract: Equatable, Sendable {
    let symbol: String
    let qty: Double
    let side: String
    let avg: Double
    let mark: Double
    let unrealizedPnl: Double
    let dayPnl: Double
    let optionType: String?
    let strike: Double?
    let expiration: String?
}

/// Contracts sharing a root symbol (MES, SPY, ...), with their combined P&L.
struct PositionGroup: Equatable, Sendable {
    let root: String
    let totalUnrealizedPnl: Double
    let totalDayPnl: Double
    let contracts: [PositionContract]
}

/// One section of the summary (futures or options). `stale` means the server's
/// last snapshot is older than its threshold, so the numbers may lag the broker.
struct PositionSection: Equatable, Sendable {
    let enabled: Bool
    let recordedAt: Date?
    let stale: Bool
    let totalUnrealizedPnl: Double
    let totalDayPnl: Double
    let groups: [PositionGroup]
}

struct PositionSummary: Equatable, Sendable {
    let mode: String
    let generatedAt: Date?
    let futures: PositionSection
    let options: PositionSection
}

enum DailystockerError: Error, Equatable {
    case badURL
    case http(Int)
    case unreadable

    var message: String {
        switch self {
        case .badURL: return "Dailystocker URL must be https://…"
        case .http(401): return "Dailystocker rejected the API key (401)"
        case .http(503): return "Dailystocker API key not configured on the server (503)"
        case .http(let code): return "Dailystocker HTTP \(code)"
        case .unreadable: return "Dailystocker response unreadable"
        }
    }
}

enum DailystockerParse {
    /// Parse the JSON from `GET /api/positions/summary.json`.
    static func summary(from data: Data) -> PositionSummary? {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let mode = root["mode"] as? String,
              let futures = root["futures"] as? [String: Any],
              let options = root["options"] as? [String: Any]
        else { return nil }
        return PositionSummary(
            mode: mode,
            generatedAt: date(root["generated_at"]),
            futures: section(futures),
            options: section(options)
        )
    }

    private static func section(_ raw: [String: Any]) -> PositionSection {
        PositionSection(
            enabled: raw["enabled"] as? Bool ?? false,
            recordedAt: date(raw["recorded_at"]),
            stale: raw["stale"] as? Bool ?? true,
            totalUnrealizedPnl: number(raw["total_unrealized_pnl"]) ?? 0,
            totalDayPnl: number(raw["total_day_pnl"]) ?? 0,
            groups: (raw["groups"] as? [[String: Any]] ?? []).map(group)
        )
    }

    private static func group(_ raw: [String: Any]) -> PositionGroup {
        PositionGroup(
            root: raw["root"] as? String ?? "",
            totalUnrealizedPnl: number(raw["total_unrealized_pnl"]) ?? 0,
            totalDayPnl: number(raw["total_day_pnl"]) ?? 0,
            contracts: (raw["contracts"] as? [[String: Any]] ?? []).map(contract)
        )
    }

    private static func contract(_ raw: [String: Any]) -> PositionContract {
        PositionContract(
            symbol: raw["symbol"] as? String ?? "",
            qty: number(raw["qty"]) ?? 0,
            side: raw["side"] as? String ?? "",
            avg: number(raw["avg"]) ?? 0,
            mark: number(raw["mark"]) ?? 0,
            unrealizedPnl: number(raw["unrealized_pnl"]) ?? 0,
            dayPnl: number(raw["day_pnl"]) ?? 0,
            optionType: raw["option_type"] as? String,
            strike: number(raw["strike"]),
            expiration: raw["expiration"] as? String
        )
    }

    /// Python isoformat can emit microseconds; ISO8601DateFormatter wants at most
    /// milliseconds, so trim the fraction before parsing.
    static func date(_ value: Any?) -> Date? {
        guard let raw = value as? String else { return nil }
        let trimmed = raw.replacingOccurrences(
            of: #"(\.\d{3})\d+"#, with: "$1", options: .regularExpression)
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: trimmed) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: trimmed)
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

enum DailystockerClient {
    static let timeout: TimeInterval = 15

    /// https only: the API key travels in a header, so plain http is refused.
    static func summaryURL(baseURL: String, mode: String) -> URL? {
        guard var components = URLComponents(
                string: baseURL.trimmingCharacters(in: .whitespacesAndNewlines)),
              components.scheme == "https",
              components.host?.isEmpty == false
        else { return nil }
        components.path = "/api/positions/summary.json"
        components.queryItems = [URLQueryItem(name: "mode", value: mode)]
        return components.url
    }

    static func fetch(baseURL: String, mode: String, apiKey: String,
                      session: URLSession = .shared,
                      completion: @escaping (Result<PositionSummary, DailystockerError>) -> Void) {
        guard let url = summaryURL(baseURL: baseURL, mode: mode) else {
            DispatchQueue.main.async { completion(.failure(.badURL)) }
            return
        }
        var request = URLRequest(url: url, timeoutInterval: timeout)
        request.setValue(apiKey, forHTTPHeaderField: "X-Api-Key")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        session.dataTask(with: request) { data, response, _ in
            let result: Result<PositionSummary, DailystockerError>
            if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
                result = .failure(.http(http.statusCode))
            } else if let data, let summary = DailystockerParse.summary(from: data) {
                result = .success(summary)
            } else {
                result = .failure(.unreadable)
            }
            DispatchQueue.main.async { completion(result) }
        }.resume()
    }
}

enum PositionFormatting {
    /// "+$110.00" / "-$12.50" (no thousands separator, to keep menu rows short).
    static func signedMoney(_ value: Double) -> String {
        let sign = value < 0 ? "-" : "+"
        return String(format: "%@$%.2f", sign, abs(value))
    }

    /// Whole numbers without a decimal point: 2 -> "2", 1.5 -> "1.5".
    static func quantity(_ qty: Double) -> String {
        qty == qty.rounded() ? String(Int(qty)) : String(qty)
    }

    /// Clock time for snapshot labels, e.g. "14:58".
    static func clock(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    /// One contract line for a group's submenu.
    /// Futures: "MESU6  LONG 2 @ 6400.25  +$100.00  (day +$25.00)"
    /// Options: "SPY 2026-08-11 CALL 770  LONG 1 @ 2.50  +$60.00  (day +$12.00)"
    static func contractLine(_ c: PositionContract) -> String {
        var label = c.symbol
        if let type = c.optionType {
            let strike = c.strike.map { String(format: "%g", $0) } ?? ""
            label = [c.expiration, type, strike].compactMap { $0 }.filter { !$0.isEmpty }
                .joined(separator: " ")
        }
        let side = c.side.isEmpty ? "" : "\(c.side) "
        return "\(label)  \(side)\(quantity(c.qty)) @ \(String(format: "%.2f", c.avg))  "
            + "\(signedMoney(c.unrealizedPnl))  (day \(signedMoney(c.dayPnl)))"
    }
}
