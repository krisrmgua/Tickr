# Contributing

Issues and pull requests are welcome.

1. Fork the repository and create a branch from `main`.
2. Keep the change focused. Use a conventional commit such as `feat:`, `fix:`, or `docs:`.
3. From `menubar/`, run:

```bash
swift build -c release
.build/release/Tickr --self-check
```

4. Do not commit API keys, dashboard addresses that identify a private host, or a personal watchlist export. The app reads those on the machine that runs it.
5. Open a pull request that says what changed and how you tested it.

`main` only accepts changes through a pull request. Direct pushes are rejected.

The app targets macOS 13 and is built with Swift Package Manager. A live check needs a network path to Yahoo Finance.

User-facing behavior belongs in the README when install steps, the watchlist, the menu-bar modes, or the positions dashboard change.
