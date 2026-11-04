# Contributing

Issues and pull requests are welcome.

1. Fork the repository and create a branch from `main`.
2. Keep the change focused. Use a conventional commit such as `feat:`, `fix:`, or `docs:`.
3. From the repo root, run:

```bash
npm install
npm run build
npm run check
```

4. Do not commit API keys, dashboard addresses that identify a private host, or a personal watchlist export. The app reads those on the machine that runs it.
5. Open a pull request that says what changed and how you tested it.

`main` only accepts changes through a pull request. Direct pushes are rejected.

The app targets macOS 13+ and Windows 10/11 and is built with Electron, TypeScript, and Vite. A live check needs a network path to Yahoo Finance. The Swift app in `menubar/` is kept for reference only.

User-facing behavior belongs in the README when install steps, the watchlist, the tray modes, or the tray modes change.
