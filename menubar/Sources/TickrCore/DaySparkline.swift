import AppKit

/// Tiny intraday price chart for the Tickr detail submenu.
enum DaySparkline {
    static let defaultSize = NSSize(width: 200, height: 48)

    /// Line chart of session closes; dashed horizontal = previous close.
    static func image(
        closes: [Double],
        previousClose: Double,
        size: NSSize = defaultSize,
        upDay: Bool
    ) -> NSImage? {
        let pts = closes.filter { $0.isFinite && $0 > 0 }
        guard pts.count >= 2 else { return nil }

        let lo = min(pts.min() ?? previousClose, previousClose)
        var hi = max(pts.max() ?? previousClose, previousClose)
        if hi <= lo { hi = lo + 0.01 }

        let img = NSImage(size: size)
        img.lockFocus()
        defer { img.unlockFocus() }

        let pad = NSEdgeInsets(top: 6, left: 8, bottom: 6, right: 8)
        let plot = NSRect(
            x: pad.left,
            y: pad.bottom,
            width: size.width - pad.left - pad.right,
            height: size.height - pad.top - pad.bottom)

        NSColor.clear.setFill()
        NSRect(origin: .zero, size: size).fill()

        // Previous-close guide.
        let prevY = y(for: previousClose, lo: lo, hi: hi, in: plot)
        let guide = NSBezierPath()
        guide.lineWidth = 1
        let dash: [CGFloat] = [3, 3]
        guide.setLineDash(dash, count: 2, phase: 0)
        guide.move(to: NSPoint(x: plot.minX, y: prevY))
        guide.line(to: NSPoint(x: plot.maxX, y: prevY))
        NSColor.secondaryLabelColor.withAlphaComponent(0.55).setStroke()
        guide.stroke()

        let line = NSBezierPath()
        line.lineWidth = 1.6
        line.lineJoinStyle = .round
        line.lineCapStyle = .round
        let last = pts.count - 1
        for (i, price) in pts.enumerated() {
            let x = plot.minX + plot.width * CGFloat(i) / CGFloat(last)
            let p = NSPoint(x: x, y: y(for: price, lo: lo, hi: hi, in: plot))
            if i == 0 { line.move(to: p) } else { line.line(to: p) }
        }
        let stroke: NSColor
        if TickrPrefs.pastelBarColors {
            stroke = upDay ? TickrPalette.green : TickrPalette.red
        } else {
            stroke = upDay ? .systemGreen : .systemRed
        }
        stroke.setStroke()
        line.stroke()

        return img
    }

    private static func y(for price: Double, lo: Double, hi: Double, in plot: NSRect) -> CGFloat {
        let t = (price - lo) / (hi - lo)
        return plot.minY + plot.height * CGFloat(t)
    }
}
