import AppKit

/// Fixed-width menu-bar strip that scrolls an attributed ticker row.
final class TickrMarqueeView: NSView {
    var strip = NSAttributedString() {
        didSet { needsDisplay = true }
    }
    var pointsPerSecond: CGFloat = 40
    var rightToLeft = true
    private var offset: CGFloat = 0
    private var timer: Timer?
    private var lastTick: Date?

    override var isFlipped: Bool { false }
    override var wantsDefaultClipping: Bool { true }

    func applyPrefs() {
        pointsPerSecond = CGFloat(TickrPrefs.scrollSpeedPointsPerSecond)
        rightToLeft = TickrPrefs.scrollDirection == .rightToLeft
    }

    func start() {
        applyPrefs()
        guard timer == nil else { return }
        lastTick = Date()
        let timer = Timer(timeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in
            self?.tick()
        }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        lastTick = nil
    }

    private func tick() {
        let now = Date()
        let dt = lastTick.map { now.timeIntervalSince($0) } ?? (1.0 / 30.0)
        lastTick = now
        let period = loopPeriod
        guard period > 0 else { return }
        offset += pointsPerSecond * CGFloat(dt)
        if offset >= period { offset = offset.truncatingRemainder(dividingBy: period) }
        needsDisplay = true
    }

    private var loopPeriod: CGFloat {
        let width = ceil(strip.size().width)
        let gap: CGFloat = 36
        return max(width + gap, bounds.width + 1)
    }

    override func draw(_ dirtyRect: NSRect) {
        NSColor.clear.setFill()
        bounds.fill()
        guard strip.length > 0 else { return }
        let size = strip.size()
        let period = loopPeriod
        let y = max(0, (bounds.height - size.height) / 2)
        var x = rightToLeft ? -offset : offset - period
        // Draw enough copies to cover the clip plus one period of padding.
        while x < bounds.width + period {
            strip.draw(at: NSPoint(x: x, y: y))
            x += period
        }
    }

    /// Let clicks fall through to the status-item button (opens the menu).
    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    deinit { stop() }
}
