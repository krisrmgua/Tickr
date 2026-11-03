# Security

Tickr does not store a Yahoo password. Quotes are read from Yahoo Finance’s public chart API with no key.

## Reporting

Open a GitHub issue for a vulnerability in this repository. Do not paste an API key, a dashboard URL that contains a secret, or the contents of `positions-api-key`. Describe the behavior and the impact.

## What the app stores

UserDefaults domain `com.krsimmons.tickr` holds the watchlist, rotate, stack, and scroll settings, the positions dashboard address, and whether that dashboard is in Live or Paper mode. Those are settings.

The positions API key is a file at `~/Library/Application Support/Tickr/positions-api-key` with mode `600`. The app sends it only as the `X-Api-Key` header, and only to an `https` address. An `http` address is refused. An older copy of the key in the Keychain (service `com.krsimmons.tickr.positions`, account `api`) is migrated into that file once and then deleted.

Logos downloaded for symbols you add are cached under `~/Library/Application Support/Tickr/logos/`.

## Out of scope

The app is not sandboxed. It needs the network for quotes and, when you configure it, for the positions dashboard. Protect the API key file the same way you protect any other secret on this Mac.
