import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate, NSTextFieldDelegate {
    private var statusItem: NSStatusItem!
    private var pollTimer: Timer?
    private var rotateTimer: Timer?
    private var watchdog: Timer?
    private var marqueeView: TickrMarqueeView?
    private var quotes: [String: Quote] = [:]
    private var lastError: String?
    private var symbols: [String]
    private let pollInterval: TimeInterval
    private var rotateIndex = 0
    private var addSymbolField: NSTextField?
    /// Last good dailystocker summary. Kept across a failed fetch, like stock quotes.
    private var positions: PositionSummary?
    private var positionsError: String?

    init(symbols: [String]? = nil, pollInterval: TimeInterval = 60) {
        self.symbols = (symbols ?? Watchlist.symbols).map { Watchlist.normalize($0) }
        self.pollInterval = pollInterval
        super.init()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { false }

    func applicationDidFinishLaunching(_ notification: Notification) {
        installStatusItem()
        refresh()
        pollTimer = Timer.scheduledTimer(withTimeInterval: pollInterval, repeats: true) {
            [weak self] _ in self?.refresh()
        }
        scheduleRotateTimer()
        watchdog = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) {
            [weak self] _ in self?.ensureStatusItem()
        }
    }

    private func installStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem.button {
            button.toolTip = "Tickr — stock quotes"
            applyBarBackground(to: button)
            button.attributedTitle = barTitlePlaceholder()
        }
        rebuildMenu()
    }

    /// Same treatment as TokenPulse' dark menu-bar backdrop: always on for Tickr.
    private func applyBarBackground(to button: NSStatusBarButton) {
        button.wantsLayer = true
        button.layer?.backgroundColor = NSColor.black.withAlphaComponent(0.55).cgColor
        button.layer?.cornerRadius = 5
    }

    private static func dayColor(for change: Double) -> NSColor {
        if change > 0 { return .systemGreen }
        if change < 0 { return .systemRed }
        return .white
    }

    private func barTitlePlaceholder() -> NSAttributedString {
        barTitle(entries: symbols.map { ($0, "…", NSColor.white) })
    }

    /// One or more `logo + $price` segments for the menu bar.
    private func barTitle(entries: [(symbol: String, priceText: String, color: NSColor)])
        -> NSAttributedString {
        let font = NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .medium)
        let out = NSMutableAttributedString(string: " ")
        for (i, entry) in entries.enumerated() {
            if i > 0 {
                out.append(NSAttributedString(
                    string: "  ",
                    attributes: [.font: font, .foregroundColor: NSColor.white]))
            }
            if let logo = SymbolLogo.image(for: entry.symbol) {
                out.append(glyphRun(logo, font: font))
                out.append(NSAttributedString(
                    string: " \(entry.priceText)",
                    attributes: [.foregroundColor: entry.color, .font: font]))
            } else {
                out.append(NSAttributedString(
                    string: "\(entry.symbol) \(entry.priceText)",
                    attributes: [.foregroundColor: entry.color, .font: font]))
            }
        }
        out.append(NSAttributedString(string: " ", attributes: [.font: font]))
        return out
    }

    private func glyphRun(_ img: NSImage, font: NSFont) -> NSAttributedString {
        let attachment = NSTextAttachment()
        attachment.image = img
        let size = img.size
        attachment.bounds = CGRect(x: 0, y: (font.capHeight - size.height) / 2,
                                   width: size.width, height: size.height)
        return NSAttributedString(attachment: attachment)
    }

    private func ensureStatusItem() {
        if statusItem == nil || statusItem.button == nil {
            installStatusItem()
            render()
        }
    }

    private func reloadSymbolsFromPrefs() {
        symbols = Watchlist.symbols
        // Drop quotes for removed tickers.
        quotes = quotes.filter { symbols.contains($0.key) }
        if rotateIndex >= symbols.count { rotateIndex = 0 }
        scheduleRotateTimer()
    }

    private func scheduleRotateTimer() {
        rotateTimer?.invalidate()
        rotateTimer = nil
        guard TickrPrefs.rotateOneAtATime, !TickrPrefs.scrollTickers else { return }
        // Stack+rotate pages one column (2 symbols); need 3+ to change. Plain
        // rotate needs 2+.
        let minimum = TickrPrefs.stackTwoTickers ? 3 : 2
        guard symbols.count >= minimum else { return }
        let seconds = TimeInterval(TickrPrefs.rotateIntervalSeconds)
        rotateTimer = Timer.scheduledTimer(withTimeInterval: seconds, repeats: true) {
            [weak self] _ in
            guard let self, !self.symbols.isEmpty else { return }
            if TickrPrefs.stackTwoTickers {
                // Advance by a full column so the pair swaps cleanly.
                self.rotateIndex = (self.rotateIndex + 2) % self.symbols.count
            } else {
                self.rotateIndex = (self.rotateIndex + 1) % self.symbols.count
            }
            self.render()
        }
    }

    /// Symbols drawn in the menu bar right now (all, rotating one/column, or scroll).
    private var barSymbols: [String] {
        if TickrPrefs.scrollTickers { return symbols }
        if TickrPrefs.stackTwoTickers {
            guard !symbols.isEmpty else { return [] }
            // Rotate limits the bar to one stacked column; otherwise every
            // symbol becomes another column to the right.
            if TickrPrefs.rotateOneAtATime, symbols.count >= 3 {
                let i = rotateIndex % symbols.count
                if i + 1 < symbols.count {
                    return [symbols[i], symbols[i + 1]]
                }
                // Odd leftover: show last alone, then wrap next tick.
                return [symbols[i]]
            }
            return symbols
        }
        guard TickrPrefs.rotateOneAtATime, !symbols.isEmpty else { return symbols }
        let i = rotateIndex % symbols.count
        return [symbols[i]]
    }

    /// Two-high columns left to right. Attributed newlines do not lay out
    /// reliably on NSStatusBarButton, so this paints an image.
    private func stackedBarImage(entries: [(symbol: String, priceText: String, color: NSColor)])
        -> NSImage {
        let font = NSFont.monospacedDigitSystemFont(ofSize: 9.5, weight: .semibold)
        let logoSize: CGFloat = 9
        let rowHeight: CGFloat = 9.5
        let padX: CGFloat = 5
        let padY: CGFloat = 2.5
        let columnGap: CGFloat = 8
        let columns: [[(symbol: String, priceText: String, color: NSColor)]] = stride(
            from: 0, to: entries.count, by: 2
        ).map { start in
            Array(entries[start..<min(start + 2, entries.count)])
        }
        func measure(_ entry: (symbol: String, priceText: String, color: NSColor)) -> CGFloat {
            let priceW = ceil((entry.priceText as NSString)
                .size(withAttributes: [.font: font]).width)
            if SymbolLogo.image(for: entry.symbol, pointSize: logoSize) != nil {
                return logoSize + 3 + priceW
            }
            let symW = ceil((entry.symbol as NSString)
                .size(withAttributes: [.font: font]).width)
            return symW + 3 + priceW
        }
        let columnWidths = columns.map { col in max(col.map(measure).max() ?? 36, 36) }
        let width = padX * 2
            + columnWidths.reduce(0, +)
            + CGFloat(max(columns.count - 1, 0)) * columnGap
        let height = padY * 2 + rowHeight * 2
        let image = NSImage(size: NSSize(width: max(40, width), height: height), flipped: true) { _ in
            var originX = padX
            for (c, column) in columns.enumerated() {
                for (r, entry) in column.enumerated() {
                    let y = padY + CGFloat(r) * rowHeight
                    var x = originX
                    if let logo = SymbolLogo.image(for: entry.symbol, pointSize: logoSize) {
                        logo.draw(
                            in: NSRect(x: x, y: y + 0.25, width: logoSize, height: logoSize),
                            from: .zero, operation: .sourceOver, fraction: 1,
                            respectFlipped: true, hints: nil)
                        x += logoSize + 3
                    } else {
                        (entry.symbol as NSString).draw(
                            at: NSPoint(x: x, y: y),
                            withAttributes: [.font: font, .foregroundColor: entry.color])
                        x += ceil((entry.symbol as NSString)
                            .size(withAttributes: [.font: font]).width) + 3
                    }
                    (entry.priceText as NSString).draw(
                        at: NSPoint(x: x, y: y),
                        withAttributes: [.font: font, .foregroundColor: entry.color])
                }
                originX += columnWidths[c] + columnGap
            }
            return true
        }
        image.isTemplate = false
        return image
    }

    private func syncMarquee(entries: [(String, String, NSColor)], tip: String) {
        guard let button = statusItem?.button else { return }
        if TickrPrefs.scrollTickers {
            let width = CGFloat(TickrPrefs.scrollWidthPoints)
            statusItem.length = width
            button.image = nil
            button.imagePosition = .noImage
            button.attributedTitle = NSAttributedString(string: "")
            button.title = ""
            let view: TickrMarqueeView
            if let existing = marqueeView {
                view = existing
            } else {
                view = TickrMarqueeView(frame: .zero)
                marqueeView = view
                button.addSubview(view)
                view.start()
            }
            view.frame = NSRect(x: 0, y: 0, width: width, height: max(button.bounds.height, 22))
            view.autoresizingMask = [.width, .height]
            view.strip = barTitle(entries: entries)
            view.applyPrefs()
            view.start()
            button.toolTip = tip
        } else if TickrPrefs.stackTwoTickers {
            marqueeView?.stop()
            marqueeView?.removeFromSuperview()
            marqueeView = nil
            statusItem.length = NSStatusItem.variableLength
            button.attributedTitle = NSAttributedString(string: "")
            button.title = ""
            button.image = stackedBarImage(entries: entries)
            button.imagePosition = .imageOnly
            button.toolTip = tip
        } else {
            marqueeView?.stop()
            marqueeView?.removeFromSuperview()
            marqueeView = nil
            statusItem.length = NSStatusItem.variableLength
            button.image = nil
            button.imagePosition = .noImage
            button.attributedTitle = barTitle(entries: entries)
            button.toolTip = tip
        }
    }

    private func refresh() {
        refreshPositions()
        let group = DispatchGroup()
        var next: [String: Quote] = [:]
        var errors: [String] = []
        let lock = NSLock()
        let tracked = symbols

        for symbol in tracked {
            group.enter()
            YahooQuoteClient.fetch(symbol: symbol) { quote in
                lock.lock()
                if let quote {
                    next[symbol] = quote
                } else {
                    errors.append(symbol)
                }
                lock.unlock()
                group.leave()
            }
            SymbolLogo.ensureCached(for: symbol)
        }

        group.notify(queue: .main) { [weak self] in
            guard let self else { return }
            for (symbol, quote) in next {
                self.quotes[symbol] = quote
            }
            if !errors.isEmpty && next.isEmpty {
                self.lastError = "Yahoo quote failed for \(errors.joined(separator: ", "))"
            } else {
                self.lastError = nil
            }
            self.render()
        }
    }

    private func render() {
        guard let button = statusItem?.button else { return }
        applyBarBackground(to: button)
        button.contentTintColor = nil

        var entries: [(String, String, NSColor)] = []
        for symbol in barSymbols {
            if let quote = quotes[symbol] {
                entries.append((
                    quote.symbol,
                    QuoteFormatting.statusPrice(quote),
                    Self.dayColor(for: quote.change)
                ))
            } else {
                entries.append((symbol, "—", .white))
            }
        }
        if entries.isEmpty {
            entries = [("TICKR", "—", .white)]
        }

        let tip: String
        if TickrPrefs.scrollTickers {
            tip = "Scrolling \(symbols.count) tickers · \(TickrPrefs.scrollDirection.title) · "
                + TickrPrefs.scrollSpeedLabel(TickrPrefs.scrollSpeedPointsPerSecond)
        } else if TickrPrefs.stackTwoTickers {
            var lines = barSymbols.map { symbol -> String in
                guard let quote = quotes[symbol] else { return "\(symbol) —" }
                let change = QuoteFormatting.signedChange(quote.change, percent: quote.changePercent)
                return "\(quote.shortName ?? symbol)  \(change)"
            }
            if TickrPrefs.rotateOneAtATime, symbols.count >= 3 {
                lines.append(
                    "1 column · rotating \(symbols.count) · every \(TickrPrefs.rotateIntervalLabel(TickrPrefs.rotateIntervalSeconds))")
            } else if symbols.count > 2 {
                lines.append("\(symbols.count) tickers · 2 high")
            }
            tip = lines.isEmpty ? "Stacked tickers" : lines.joined(separator: "\n")
        } else if let primary = barSymbols.compactMap({ quotes[$0] }).first {
            let change = QuoteFormatting.signedChange(primary.change, percent: primary.changePercent)
            var line = "\(primary.shortName ?? primary.symbol)\n\(change)"
            if TickrPrefs.rotateOneAtATime, symbols.count > 1 {
                line += "\nRotating \(symbols.count) tickers · every \(TickrPrefs.rotateIntervalLabel(TickrPrefs.rotateIntervalSeconds))"
            }
            tip = line
        } else {
            tip = lastError ?? "Waiting for Yahoo quote"
        }
        syncMarquee(entries: entries, tip: tip)
        rebuildMenu()
    }

    private func rebuildMenu() {
        let menu = NSMenu()
        menu.autoenablesItems = false

        menu.addItem(sectionHeaderItem("Stocks"))
        for symbol in symbols {
            menu.addItem(stockSubmenuItem(for: symbol))
        }

        menu.addItem(.separator())
        addPositionSections(to: menu)

        let addItem = NSMenuItem(
            title: "Add Stock…",
            action: #selector(addStockClicked),
            keyEquivalent: "a")
        addItem.target = self
        menu.addItem(addItem)

        menu.addItem(.separator())
        let rotateItem = NSMenuItem(
            title: "Rotate one at a time",
            action: #selector(toggleRotateClicked),
            keyEquivalent: "")
        rotateItem.target = self
        rotateItem.state = TickrPrefs.rotateOneAtATime ? .on : .off
        menu.addItem(rotateItem)

        if TickrPrefs.rotateOneAtATime {
            let intervalItem = NSMenuItem(title: "Rotate every", action: nil, keyEquivalent: "")
            let intervalMenu = NSMenu()
            intervalMenu.autoenablesItems = false
            for seconds in TickrPrefs.rotateIntervalChoices {
                let choice = NSMenuItem(
                    title: TickrPrefs.rotateIntervalLabel(seconds),
                    action: #selector(rotateIntervalClicked(_:)),
                    keyEquivalent: "")
                choice.target = self
                choice.tag = seconds
                choice.state = seconds == TickrPrefs.rotateIntervalSeconds ? .on : .off
                intervalMenu.addItem(choice)
            }
            intervalItem.submenu = intervalMenu
            menu.addItem(intervalItem)
        }

        let stackItem = NSMenuItem(
            title: "Stack two tickers",
            action: #selector(toggleStackClicked),
            keyEquivalent: "")
        stackItem.target = self
        stackItem.state = TickrPrefs.stackTwoTickers ? .on : .off
        menu.addItem(stackItem)

        let scrollItem = NSMenuItem(
            title: "Scroll tickers",
            action: #selector(toggleScrollClicked),
            keyEquivalent: "")
        scrollItem.target = self
        scrollItem.state = TickrPrefs.scrollTickers ? .on : .off
        menu.addItem(scrollItem)

        if TickrPrefs.scrollTickers {
            menu.addItem(scrollChoiceMenu(
                title: "Scroll width",
                values: TickrPrefs.scrollWidthChoices,
                selected: TickrPrefs.scrollWidthPoints,
                label: TickrPrefs.scrollWidthLabel,
                action: #selector(scrollWidthClicked(_:))))
            menu.addItem(scrollChoiceMenu(
                title: "Scroll speed",
                values: TickrPrefs.scrollSpeedChoices,
                selected: TickrPrefs.scrollSpeedPointsPerSecond,
                label: TickrPrefs.scrollSpeedLabel,
                action: #selector(scrollSpeedClicked(_:))))
            let directionItem = NSMenuItem(title: "Scroll direction", action: nil, keyEquivalent: "")
            let directionMenu = NSMenu()
            directionMenu.autoenablesItems = false
            for direction in [TickrPrefs.ScrollDirection.rightToLeft, .leftToRight] {
                let choice = NSMenuItem(
                    title: direction.title,
                    action: #selector(scrollDirectionClicked(_:)),
                    keyEquivalent: "")
                choice.target = self
                choice.representedObject = direction.rawValue
                choice.state = direction == TickrPrefs.scrollDirection ? .on : .off
                directionMenu.addItem(choice)
            }
            directionItem.submenu = directionMenu
            menu.addItem(directionItem)
        }

        let settingsItem = NSMenuItem(
            title: "Dailystocker Settings…",
            action: #selector(dailystockerSettingsClicked),
            keyEquivalent: "")
        settingsItem.target = self
        menu.addItem(settingsItem)

        if DailystockerSettings.isConfigured {
            // Live is green, Paper is orange. Click to switch.
            let isPaper = DailystockerSettings.mode == "paper"
            let modeItem = NSMenuItem(
                title: isPaper ? "Mode: Paper" : "Mode: Live",
                action: #selector(togglePositionsModeClicked),
                keyEquivalent: "")
            // Only the mode word is colored; "Mode:" keeps the normal menu text color.
            let title = NSMutableAttributedString(
                string: "Mode: ",
                attributes: [.foregroundColor: NSColor.labelColor])
            title.append(NSAttributedString(
                string: isPaper ? "Paper" : "Live",
                attributes: [.foregroundColor: isPaper ? NSColor.systemOrange : NSColor.systemGreen]))
            modeItem.attributedTitle = title
            modeItem.target = self
            menu.addItem(modeItem)
        }

        if let lastError {
            menu.addItem(.separator())
            menu.addItem(makeRow(lastError, color: .systemOrange))
        }

        menu.addItem(.separator())

        let refreshItem = NSMenuItem(
            title: "Refresh",
            action: #selector(refreshClicked),
            keyEquivalent: "r")
        refreshItem.target = self
        menu.addItem(refreshItem)

        let quitItem = NSMenuItem(
            title: "Quit Tickr",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q")
        menu.addItem(quitItem)

        statusItem?.menu = menu
    }

    /// Top-level row: logo + name, details in a hover submenu.
    private func stockSubmenuItem(for symbol: String) -> NSMenuItem {
        let quote = quotes[symbol]
        let name = quote?.shortName ?? symbol
        let item = NSMenuItem(title: name, action: nil, keyEquivalent: "")
        item.image = SymbolLogo.image(for: symbol, pointSize: 16)
            ?? Self.placeholderLogo(for: symbol)
        item.submenu = detailSubmenu(symbol: symbol, quote: quote)
        return item
    }

    private func detailSubmenu(symbol: String, quote: Quote?) -> NSMenu {
        let sub = NSMenu()
        sub.autoenablesItems = false

        if let quote {
            let day = Self.dayColor(for: quote.change)
            sub.addItem(makeRow(quote.symbol, bold: true))
            if let chart = makeChartRow(for: quote) {
                sub.addItem(chart)
            }
            sub.addItem(makeRow(
                "Price  \(QuoteFormatting.price(quote.price, currency: quote.currency))",
                color: day))
            sub.addItem(makeRow(
                "Change \(QuoteFormatting.signedChange(quote.change, percent: quote.changePercent))",
                color: day))
            sub.addItem(makeRow(
                "Prev   \(QuoteFormatting.price(quote.previousClose, currency: quote.currency))",
                color: day))
            if let when = quote.marketTime {
                let df = DateFormatter()
                df.dateStyle = .none
                df.timeStyle = .short
                sub.addItem(makeRow("As of  \(df.string(from: when))"))
            }
        } else {
            sub.addItem(makeRow("\(symbol) — no quote yet"))
        }

        if symbols.count > 1 {
            sub.addItem(.separator())
            let remove = NSMenuItem(
                title: "Remove \(symbol)",
                action: #selector(removeStockClicked(_:)),
                keyEquivalent: "")
            remove.target = self
            remove.representedObject = symbol
            sub.addItem(remove)
        }
        return sub
    }

    private static func placeholderLogo(for symbol: String) -> NSImage {
        let size: CGFloat = 16
        let img = NSImage(size: NSSize(width: size, height: size))
        img.lockFocus()
        NSColor.secondaryLabelColor.setFill()
        NSBezierPath(ovalIn: NSRect(x: 0, y: 0, width: size, height: size)).fill()
        let letter = String(symbol.prefix(1))
        let attrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.boldSystemFont(ofSize: 9),
            .foregroundColor: NSColor.white,
        ]
        let textSize = letter.size(withAttributes: attrs)
        letter.draw(at: NSPoint(x: (size - textSize.width) / 2,
                                y: (size - textSize.height) / 2),
                    withAttributes: attrs)
        img.unlockFocus()
        img.isTemplate = false
        return img
    }

    /// Info rows must be custom-view items. A plain NSMenuItem with no action
    /// is "disabled" and macOS dims it grey; a view item renders at full color.
    private func makeRow(_ s: String, bold: Bool = false,
                         color: NSColor = .labelColor) -> NSMenuItem {
        let label = NSTextField(labelWithString: s)
        label.font = bold ? NSFont.boldSystemFont(ofSize: 13) : NSFont.systemFont(ofSize: 13)
        label.textColor = color
        label.sizeToFit()

        let pad = NSEdgeInsets(top: 3, left: 14, bottom: 3, right: 16)
        let container = NSView(frame: NSRect(
            x: 0, y: 0,
            width: max(label.frame.width + pad.left + pad.right, 180),
            height: label.frame.height + pad.top + pad.bottom))
        label.setFrameOrigin(NSPoint(x: pad.left, y: pad.bottom))
        container.addSubview(label)

        let item = NSMenuItem()
        item.view = container
        return item
    }

    /// Intraday sparkline under the ticker symbol in the detail submenu.
    private func makeChartRow(for quote: Quote) -> NSMenuItem? {
        guard let img = DaySparkline.image(
            closes: quote.intradayCloses,
            previousClose: quote.previousClose,
            upDay: quote.change >= 0
        ) else { return nil }

        let pad = NSEdgeInsets(top: 2, left: 10, bottom: 4, right: 10)
        let view = NSImageView(image: img)
        view.imageScaling = .scaleProportionallyDown
        view.frame = NSRect(
            x: pad.left, y: pad.bottom,
            width: img.size.width, height: img.size.height)

        let container = NSView(frame: NSRect(
            x: 0, y: 0,
            width: img.size.width + pad.left + pad.right,
            height: img.size.height + pad.top + pad.bottom))
        container.addSubview(view)

        let item = NSMenuItem()
        item.view = container
        return item
    }

    // MARK: - Dailystocker futures and options

    /// Fetches open futures and options from dailystocker. A failure keeps the last
    /// good summary and shows the error row, the same way stock quotes behave.
    private func refreshPositions() {
        guard DailystockerSettings.isConfigured, let apiKey = DailystockerSettings.apiKey() else {
            positions = nil
            positionsError = nil
            return
        }
        DailystockerClient.fetch(
            baseURL: DailystockerSettings.baseURL,
            mode: DailystockerSettings.mode,
            apiKey: apiKey
        ) { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let summary):
                self.positions = summary
                self.positionsError = nil
            case .failure(let error):
                self.positionsError = error.message
            }
            self.rebuildMenu()
        }
    }

    private func addPositionSections(to menu: NSMenu) {
        guard DailystockerSettings.isConfigured else { return }
        if let positionsError {
            menu.addItem(makeRow(positionsError, color: .systemOrange))
        }
        guard let positions else { return }

        if positions.futures.enabled {
            addPositionSection(menu, title: "Futures", section: positions.futures)
            menu.addItem(.separator())
        }
        if positions.options.enabled {
            addPositionSection(menu, title: "Options", section: positions.options)
            menu.addItem(.separator())
        }
    }

    private func addPositionSection(_ menu: NSMenu, title: String, section: PositionSection) {
        let total = PositionFormatting.signedMoney(section.totalUnrealizedPnl)
        menu.addItem(sectionHeaderItem("\(title)  \(total)"))

        if let recorded = section.recordedAt {
            if section.stale {
                menu.addItem(makeRow(
                    "Snapshot \(PositionFormatting.clock(recorded)) — stale",
                    color: .systemOrange))
            }
        } else {
            menu.addItem(makeRow("No snapshot yet", color: .systemOrange))
        }

        if section.groups.isEmpty {
            menu.addItem(makeRow("No open \(title.lowercased())", color: .secondaryLabelColor))
        }
        for group in section.groups {
            menu.addItem(positionGroupItem(group))
        }
    }

    /// Root row (for example "MES  +$110.00"); its submenu lists each contract with P&L.
    private func positionGroupItem(_ group: PositionGroup) -> NSMenuItem {
        let total = PositionFormatting.signedMoney(group.totalUnrealizedPnl)
        let item = NSMenuItem(title: "\(group.root)  \(total)", action: nil, keyEquivalent: "")
        let sub = NSMenu()
        sub.autoenablesItems = false
        sub.addItem(makeRow(
            "\(group.root)  open \(total)  ·  day \(PositionFormatting.signedMoney(group.totalDayPnl))",
            bold: true,
            color: Self.dayColor(for: group.totalUnrealizedPnl)))
        for contract in group.contracts {
            sub.addItem(makeRow(
                PositionFormatting.contractLine(contract),
                color: Self.dayColor(for: contract.unrealizedPnl)))
        }
        item.submenu = sub
        return item
    }

    /// Native section header on macOS 14+, otherwise a bold dimmed row (package floor is 13).
    private func sectionHeaderItem(_ title: String) -> NSMenuItem {
        if #available(macOS 14.0, *) {
            return NSMenuItem.sectionHeader(title: title)
        }
        return makeRow(title, bold: true, color: .secondaryLabelColor)
    }

    @objc private func togglePositionsModeClicked() {
        DailystockerSettings.mode = DailystockerSettings.mode == "live" ? "paper" : "live"
        positions = nil
        positionsError = nil
        refreshPositions()
        rebuildMenu()
    }

    @objc private func toggleRotateClicked() {
        TickrPrefs.rotateOneAtATime.toggle()
        rotateIndex = 0
        scheduleRotateTimer()
        render()
    }

    @objc private func rotateIntervalClicked(_ sender: NSMenuItem) {
        TickrPrefs.rotateIntervalSeconds = sender.tag
        scheduleRotateTimer()
        render()
    }

    @objc private func toggleStackClicked() {
        TickrPrefs.stackTwoTickers.toggle()
        rotateIndex = 0
        scheduleRotateTimer()
        render()
    }

    @objc private func toggleScrollClicked() {
        TickrPrefs.scrollTickers.toggle()
        scheduleRotateTimer()
        render()
    }

    @objc private func scrollWidthClicked(_ sender: NSMenuItem) {
        TickrPrefs.scrollWidthPoints = sender.tag
        render()
    }

    @objc private func scrollSpeedClicked(_ sender: NSMenuItem) {
        TickrPrefs.scrollSpeedPointsPerSecond = sender.tag
        marqueeView?.applyPrefs()
        render()
    }

    @objc private func scrollDirectionClicked(_ sender: NSMenuItem) {
        if let raw = sender.representedObject as? String,
           let direction = TickrPrefs.ScrollDirection(rawValue: raw) {
            TickrPrefs.scrollDirection = direction
            marqueeView?.applyPrefs()
            render()
        }
    }

    private func scrollChoiceMenu(
        title: String,
        values: [Int],
        selected: Int,
        label: (Int) -> String,
        action: Selector
    ) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        let sub = NSMenu()
        sub.autoenablesItems = false
        for value in values {
            let choice = NSMenuItem(title: label(value), action: action, keyEquivalent: "")
            choice.target = self
            choice.tag = value
            choice.state = value == selected ? .on : .off
            sub.addItem(choice)
        }
        item.submenu = sub
        return item
    }

    @objc private func dailystockerSettingsClicked() {
        let alert = NSAlert()
        alert.messageText = "Dailystocker"
        alert.informativeText = "Dashboard address (https) and the API key. One key covers "
            + "futures and options. Leave the key blank to keep the stored one."
        alert.alertStyle = .informational
        alert.addButton(withTitle: "Save")
        alert.addButton(withTitle: "Cancel")

        // Explicit frames in a plain container: NSAlert ignores an NSStackView
        // accessory that has no intrinsic size, which left the fields invisible.
        let container = NSView(frame: NSRect(x: 0, y: 0, width: 320, height: 110))
        let urlLabel = NSTextField(labelWithString: "Address")
        urlLabel.frame = NSRect(x: 0, y: 86, width: 320, height: 16)
        let urlField = NSTextField(frame: NSRect(x: 0, y: 58, width: 320, height: 24))
        urlField.placeholderString = "https://example.com"
        urlField.stringValue = DailystockerSettings.baseURL
        let keyLabel = NSTextField(labelWithString: "API key")
        keyLabel.frame = NSRect(x: 0, y: 40, width: 320, height: 16)
        let keyField = NSSecureTextField(frame: NSRect(x: 0, y: 12, width: 320, height: 24))
        keyField.placeholderString = DailystockerSettings.apiKey() == nil
            ? "paste key" : "stored (leave blank to keep)"
        for view in [urlLabel, urlField, keyLabel, keyField] {
            container.addSubview(view)
        }
        alert.accessoryView = container
        alert.window.initialFirstResponder = urlField

        guard alert.runModal() == .alertFirstButtonReturn else { return }

        let url = urlField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard DailystockerClient.summaryURL(baseURL: url, mode: "live") != nil else {
            presentNotice("Invalid address", "Enter an https address such as https://example.com.")
            return
        }
        DailystockerSettings.baseURL = url

        let key = keyField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        if !key.isEmpty, !DailystockerSettings.setAPIKey(key) {
            presentNotice("Keychain", "Could not save the API key.")
            return
        }

        positions = nil
        positionsError = nil
        refreshPositions()
        rebuildMenu()
    }

    @objc private func refreshClicked() { refresh() }

    @objc private func addStockClicked() {
        let alert = NSAlert()
        alert.messageText = "Add Stock"
        alert.informativeText = "Enter a ticker symbol (for example AAPL or MSFT)."
        alert.alertStyle = .informational
        alert.addButton(withTitle: "Add")
        alert.addButton(withTitle: "Cancel")

        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 240, height: 24))
        field.placeholderString = "TICKER"
        field.stringValue = ""
        field.delegate = self
        alert.accessoryView = field
        addSymbolField = field
        alert.window.initialFirstResponder = field

        let response = alert.runModal()
        addSymbolField = nil
        guard response == .alertFirstButtonReturn else { return }

        let raw = field.stringValue
        let symbol = Watchlist.normalize(raw)
        guard !symbol.isEmpty else {
            presentNotice("Invalid ticker", "Enter a symbol like SOFI or AAPL.")
            return
        }
        if symbols.contains(symbol) {
            presentNotice("Already tracked", "\(symbol) is already on your list.")
            return
        }

        YahooQuoteClient.fetch(symbol: symbol) { [weak self] quote in
            guard let self else { return }
            guard let quote else {
                self.presentNotice("Not found",
                                   "Yahoo did not return a quote for \(symbol).")
                return
            }
            guard Watchlist.add(symbol) != nil else { return }
            self.reloadSymbolsFromPrefs()
            self.quotes[symbol] = quote
            SymbolLogo.ensureCached(for: symbol) { [weak self] in
                self?.render()
            }
            self.render()
        }
    }

    @objc private func removeStockClicked(_ sender: NSMenuItem) {
        guard let symbol = sender.representedObject as? String else { return }
        guard Watchlist.remove(symbol) else {
            presentNotice("Keep one stock", "Tickr needs at least one symbol.")
            return
        }
        reloadSymbolsFromPrefs()
        render()
        refresh()
    }

    private func presentNotice(_ title: String, _ message: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.alertStyle = .warning
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }
}
