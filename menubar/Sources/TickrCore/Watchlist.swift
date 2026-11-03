import Foundation

/// Menu-bar display options. Stack and scroll are mutually exclusive; rotate
/// can pair with stack (two at a time) or run alone (one at a time).
enum TickrPrefs {
    private static let rotateKey = "rotateOneAtATime"
    private static let rotateIntervalKey = "rotateIntervalSeconds"
    private static let stackKey = "stackTwoTickers"
    private static let scrollKey = "scrollTickers"
    private static let scrollWidthKey = "scrollWidthPoints"
    private static let scrollSpeedKey = "scrollSpeedPointsPerSecond"
    private static let scrollDirectionKey = "scrollDirection"

    static let rotateIntervalChoices = [3, 5, 10, 15, 30, 60]
    static let scrollWidthChoices = [100, 140, 180, 220, 280]
    /// Points per second for the marquee.
    static let scrollSpeedChoices = [8, 14, 24, 40, 64, 96]

    enum ScrollDirection: String {
        case rightToLeft
        case leftToRight

        var title: String {
            switch self {
            case .rightToLeft: return "Right to left"
            case .leftToRight: return "Left to right"
            }
        }
    }

    static var rotateOneAtATime: Bool {
        get { UserDefaults.standard.object(forKey: rotateKey) as? Bool ?? false }
        set {
            UserDefaults.standard.set(newValue, forKey: rotateKey)
            if newValue { UserDefaults.standard.set(false, forKey: scrollKey) }
        }
    }

    /// Seconds between ticker swaps when rotate is on. Falls back to 5 if unset/invalid.
    static var rotateIntervalSeconds: Int {
        get {
            let v = UserDefaults.standard.object(forKey: rotateIntervalKey) as? Int ?? 5
            return rotateIntervalChoices.contains(v) ? v : 5
        }
        set {
            let v = rotateIntervalChoices.contains(newValue) ? newValue : 5
            UserDefaults.standard.set(v, forKey: rotateIntervalKey)
        }
    }

    /// Two-high columns of logo+$price in the menu bar. Off by default; turns scroll off.
    static var stackTwoTickers: Bool {
        get { UserDefaults.standard.object(forKey: stackKey) as? Bool ?? false }
        set {
            UserDefaults.standard.set(newValue, forKey: stackKey)
            if newValue { UserDefaults.standard.set(false, forKey: scrollKey) }
        }
    }

    static var scrollTickers: Bool {
        get { UserDefaults.standard.object(forKey: scrollKey) as? Bool ?? false }
        set {
            UserDefaults.standard.set(newValue, forKey: scrollKey)
            if newValue {
                UserDefaults.standard.set(false, forKey: rotateKey)
                UserDefaults.standard.set(false, forKey: stackKey)
            }
        }
    }

    static var scrollWidthPoints: Int {
        get {
            let v = UserDefaults.standard.object(forKey: scrollWidthKey) as? Int ?? 180
            return scrollWidthChoices.contains(v) ? v : 180
        }
        set {
            let v = scrollWidthChoices.contains(newValue) ? newValue : 180
            UserDefaults.standard.set(v, forKey: scrollWidthKey)
        }
    }

    static var scrollSpeedPointsPerSecond: Int {
        get {
            let v = UserDefaults.standard.object(forKey: scrollSpeedKey) as? Int ?? 40
            return scrollSpeedChoices.contains(v) ? v : 40
        }
        set {
            let v = scrollSpeedChoices.contains(newValue) ? newValue : 40
            UserDefaults.standard.set(v, forKey: scrollSpeedKey)
        }
    }

    static var scrollDirection: ScrollDirection {
        get {
            let raw = UserDefaults.standard.string(forKey: scrollDirectionKey) ?? ""
            return ScrollDirection(rawValue: raw) ?? .rightToLeft
        }
        set { UserDefaults.standard.set(newValue.rawValue, forKey: scrollDirectionKey) }
    }

    static func rotateIntervalLabel(_ seconds: Int) -> String {
        seconds == 1 ? "1 second" : "\(seconds) seconds"
    }

    static func scrollWidthLabel(_ points: Int) -> String { "\(points) pt" }

    static func scrollSpeedLabel(_ pointsPerSecond: Int) -> String {
        switch pointsPerSecond {
        case 8: return "Crawl"
        case 14: return "Very slow"
        case 24: return "Slow"
        case 40: return "Medium"
        case 64: return "Fast"
        case 96: return "Very fast"
        default: return "\(pointsPerSecond) pt/s"
        }
    }
}

enum Watchlist {
    private static let symbolsKey = "trackedSymbols"

    static var symbols: [String] {
        get {
            if let stored = UserDefaults.standard.stringArray(forKey: symbolsKey),
               !stored.isEmpty {
                return stored.map { normalize($0) }.filter { !$0.isEmpty }
            }
            return YahooQuoteClient.defaultSymbols
        }
        set {
            let cleaned = newValue.map { normalize($0) }.filter { !$0.isEmpty }
            // Preserve order, drop dupes.
            var seen = Set<String>()
            let unique = cleaned.filter { seen.insert($0).inserted }
            UserDefaults.standard.set(unique.isEmpty ? YahooQuoteClient.defaultSymbols : unique,
                                     forKey: symbolsKey)
        }
    }

    /// Uppercase ticker; keep letters, digits, `.`, `-`, `^`.
    static func normalize(_ raw: String) -> String {
        let upper = raw.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: ".-^"))
        return String(upper.unicodeScalars.filter { allowed.contains($0) })
    }

    @discardableResult
    static func add(_ raw: String) -> String? {
        let symbol = normalize(raw)
        guard !symbol.isEmpty else { return nil }
        var list = symbols
        guard !list.contains(symbol) else { return symbol }
        list.append(symbol)
        symbols = list
        return symbol
    }

    @discardableResult
    static func remove(_ raw: String) -> Bool {
        let symbol = normalize(raw)
        var list = symbols
        guard list.count > 1 else { return false }
        list.removeAll { $0 == symbol }
        guard list.count < symbols.count else { return false }
        symbols = list
        return true
    }
}
