# Ophanim client (Tauri): instructions for the coding agent

You are building the desktop client for MonitoringDaemon. It reads the NDJSON day logs
(`%AppData%\Ophanim\DayLogs\yyyy-MM-dd.ndjson`) and presents them to the user.

## Source of truth (priority order)
1. `docs/ui/SPEC.md`: behaviour and UX rules. If code and spec disagree, the spec wins.
2. `docs/ui/prototype/index.html`: visual reference. Open it in a browser, load
   `docs/ui/fixtures/demo.ndjson` (button "Files") and compare. Layout, spacing, colors,
   typography and tooltips must match it. The prototype is throwaway code: do NOT copy its
   structure, but its algorithms (functions `load`, `stats`, `vis`, `clusters`, `segsOf`)
   are the reference for the calculations and must be ported faithfully.
3. The daemon contract (`MonitoringDaemon` summary document) for the NDJSON format.

## Tech and architecture
- Tauri 2, Rust backend, TypeScript + React + Vite frontend, CSS modules, Zustand for UI state, Vitest, Playwright.
  No chart library: charts are custom SVG (the rules are bespoke). Proposed defaults: ask before changing.
- **Read `docs/ARCHITECTURE.md` before writing code and follow it.** The layering and folder structure there are mandatory.
- Quality bar: clean layers, small files, styles separated from markup, domain logic separated from UI. But NO
  over-engineering: no abstraction until it is used in 2+ places, no single-implementation interfaces, no managers/factories/DI.
- All parsing and aggregation happens in Rust (streaming NDJSON, per-day cache, `notify` watcher). The webview only
  receives ready-made DTOs. Virtualize long lists.

## Working rules
- Step 0: scaffold the project skeleton exactly as in `docs/ARCHITECTURE.md` and port the prototype's CSS variables
  into `styles/tokens.css`. Then one screen at a time: data layer + tests, sidebar, main window, day screen,
  app/folder screen. Finish and verify each before starting the next.
- Rust unit tests for: interval building, midnight split, missing logout, session gaps,
  folder merging, per-day aggregates. Use `docs/ui/fixtures/demo.ndjson` plus hand-made
  edge-case fixtures (bad line, no logout, no friendly_name).
- Visual check: Playwright screenshots of every screen at 1440x900 and 1280x720 against the
  prototype loaded with the same fixture. Fix visible differences before reporting done.
- Do not invent behaviour. If the spec is silent, choose the simplest option, list it in
  your report as an assumption, and do not silently add features.
- If a behaviour changes, update `docs/ui/SPEC.md` in the same change.
- UI language is English. Dates `dd.mm.yy`, durations like `3h 05m`.
