# Tickr

Tickr is a macOS menu-bar ticker. It shows a live price for each symbol on your watchlist, in green when the price is up for the day and red when it is down. Click the icon for the list, a small intraday chart, and optional futures and options from a dashboard you configure.

Requires **macOS 13** or later and the Swift command-line tools. Quotes come from Yahoo Finance’s public chart API. No Yahoo key is required.

## Install

```bash
git clone https://github.com/krisrmgua/Tickr.git
cd Tickr/menubar
./install.sh
```

That builds `Tickr.app`, copies it to `~/Applications/Tickr.app`, and starts it at login. Run `./install.sh` again to update. The bundle id is `com.krsimmons.tickr`, so an update keeps the watchlist and display settings you already set.

A manual build, without installing, is:

```bash
cd menubar
./make-app.sh
open Tickr.app
```

From the repo root, `./tickr` is the same control script: `status`, `install`, `enable`, `disable`, `start`, and `stop`. You can symlink it onto your PATH:

```bash
ln -sfn "$(pwd)/tickr" ~/bin/tickr
```

## Menu bar

Each symbol is a logo plus `$price` on a dark rounded backdrop. The logo ships in the app for `SOFI`. Other logos are cached under `~/Library/Application Support/Tickr/logos/` after a download from Financial Modeling Prep’s public symbol images. A missing logo falls back to a letter tile.

The bar polls Yahoo every 60 seconds. A failed refresh keeps the last good quote and shows the error in orange in the menu.

Three display modes, set from the menu:

- **Rotate one at a time** (off). Shows one symbol and cycles the watchlist. **Rotate every** is 3, 5, 10, 15, 30, or 60 seconds. The default is 5. Rotation starts once you have at least two symbols.
- **Stack two tickers** (off). Draws logo and price in two-high columns, left to right. A third and fourth symbol add another column. Turn rotate on with stack to keep a single column and page through pairs. Stack turns scroll off.
- **Scroll tickers** (off). Keeps a fixed width and marquee-scrolls every logo and price. Scroll turns rotate and stack off.
  - **Scroll width:** 100, 140, 180, 220, or 280 points. The default is 180.
  - **Scroll speed:** Crawl, Very slow, Slow, Medium, Fast, Very fast. The default is Medium.
  - **Scroll direction:** Right to left (default) or Left to right.

## Dropdown

**Stocks** lists each symbol as its logo and name. Hover a row for Price, Change, Prev, As of, and a sparkline of the day’s 5-minute bars with a dashed previous-close line. **Remove** is on that submenu. The last symbol cannot be removed.

**Add Stock…** asks for a ticker, checks it against Yahoo, and appends it. Tickers are uppercased. Letters, digits, `.`, `-`, and `^` are kept.

**Refresh** fetches quotes and positions now. **Quit Tickr** leaves the login agent in place until you disable it.

## Futures and options

The menu can also show open futures and options from a dashboard that serves `GET /api/positions/summary.json`. Futures are grouped by root (MES, ES, and so on). Options are grouped by underlying. Each group shows open P&L. Hover a group for quantity, average, mark, unrealized P&L, and day P&L.

**Dailystocker Settings…** asks for the dashboard address and the API key. The address has to be `https`. The key is sent as the `X-Api-Key` header. Leave the key blank to keep the one already stored.

Until both are set, the Futures and Options sections stay hidden. A failed request shows an orange row and keeps the last good numbers. The dashboard’s own `stale` flag marks an old snapshot.

**Mode: Live** is the default. **Mode: Paper** switches the `mode` query. Live is green and Paper is orange. The same key covers both.

## What is stored

| Item | Where |
|---|---|
| Watchlist (`trackedSymbols`) | UserDefaults, domain `com.krsimmons.tickr`. Empty falls back to `SOFI`. |
| Rotate, stack, and scroll settings | Same domain. |
| Dashboard address and Live/Paper | `dailystockerBaseURL` and `dailystockerMode` in that domain. |
| API key | `~/Library/Application Support/Tickr/positions-api-key`, mode `600`. An older key in the Keychain (`com.krsimmons.tickr.positions`, account `api`) is copied into that file once and then removed. |

The app does not store a Yahoo password. It is not sandboxed. It is an accessory app (`LSUIElement`), so it has no Dock icon.

## Develop

```bash
cd menubar
swift build -c release
.build/release/Tickr --self-check
```

`--self-check` parses a fixture quote and a fixture positions summary. It does not call Yahoo or a dashboard.

`swift test` needs a full Xcode install. Command Line Tools can build the package and run `--self-check`.

## Layout

| Path | What |
|---|---|
| `menubar/` | Swift Package Manager app |
| `menubar/install.sh` | Build, install to `~/Applications`, and login start |
| `menubar/Resources/logos/` | Logos shipped with the app |
| `tickr` | Status, install, start, stop, and login control |

## License

[MIT](LICENSE). Copyright 2026 Kristopher Simmons.
