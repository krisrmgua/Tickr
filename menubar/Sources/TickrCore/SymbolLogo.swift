import AppKit

/// Per-symbol logos: bundled Resources, then Application Support cache, then
/// a best-effort download from Financial Modeling Prep's public symbol images.
enum SymbolLogo {
    private static let cacheDir: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory,
                                            in: .userDomainMask).first!
        return base.appendingPathComponent("Tickr/logos", isDirectory: true)
    }()

    static func image(for symbol: String, pointSize: CGFloat = 14) -> NSImage? {
        let name = symbol.uppercased()
        guard let path = resolvePath(for: name),
              let image = NSImage(contentsOfFile: path) else { return nil }
        return sized(image, pointSize: pointSize)
    }

    static func resolvePath(for symbol: String) -> String? {
        let name = symbol.uppercased()
        let fm = FileManager.default
        var candidates: [String] = []
        if let bundled = Bundle.main.path(forResource: name, ofType: "png",
                                          inDirectory: "logos") {
            candidates.append(bundled)
        }
        if let res = Bundle.main.resourcePath {
            candidates.append((res as NSString).appendingPathComponent("logos/\(name).png"))
        }
        candidates.append(cacheDir.appendingPathComponent("\(name).png").path)
        let cwd = fm.currentDirectoryPath
        candidates.append(contentsOf: [
            "\(cwd)/Resources/logos/\(name).png",
            "\(cwd)/menubar/Resources/logos/\(name).png",
        ])
        return candidates.first { fm.fileExists(atPath: $0) }
    }

    /// Download a logo when missing. Calls back on the main queue.
    static func ensureCached(for symbol: String, completion: (() -> Void)? = nil) {
        let name = Watchlist.normalize(symbol)
        guard !name.isEmpty else {
            DispatchQueue.main.async { completion?() }
            return
        }
        if resolvePath(for: name) != nil {
            DispatchQueue.main.async { completion?() }
            return
        }
        guard let url = URL(string: "https://images.financialmodelingprep.com/symbol/\(name).png")
        else {
            DispatchQueue.main.async { completion?() }
            return
        }
        var request = URLRequest(url: url, timeoutInterval: 15)
        request.setValue(YahooQuoteClient.userAgent, forHTTPHeaderField: "User-Agent")
        URLSession.shared.dataTask(with: request) { data, response, _ in
            defer { DispatchQueue.main.async { completion?() } }
            guard let data,
                  let http = response as? HTTPURLResponse,
                  (200...299).contains(http.statusCode),
                  NSImage(data: data) != nil
            else { return }
            try? FileManager.default.createDirectory(at: cacheDir,
                                                     withIntermediateDirectories: true)
            let dest = cacheDir.appendingPathComponent("\(name).png")
            try? data.write(to: dest, options: .atomic)
        }.resume()
    }

    private static func sized(_ image: NSImage, pointSize: CGFloat) -> NSImage {
        let sized = NSImage(size: NSSize(width: pointSize, height: pointSize))
        sized.lockFocus()
        NSGraphicsContext.current?.imageInterpolation = .high
        image.draw(in: NSRect(x: 0, y: 0, width: pointSize, height: pointSize),
                   from: .zero, operation: .sourceOver, fraction: 1)
        sized.unlockFocus()
        sized.isTemplate = false
        return sized
    }
}
