# Security

Tickr does not store a Yahoo password. Quotes are read from Yahoo Finance’s public chart API with no key.

## Reporting

Open a GitHub issue for a vulnerability in this repository. Describe the behavior and the impact. Do not paste secrets.

## What the app stores

UserDefaults domain `com.krsimmons.tickr` (and Electron `prefs.json` under Application Support) holds the watchlist plus rotate, stack, scroll, pastel, and related display settings. Those are settings.

Logos downloaded for symbols you add are cached under `~/Library/Application Support/Tickr/logos/`.

## Out of scope

The app is not sandboxed. It needs the network for Yahoo quotes and logo downloads.
