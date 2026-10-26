# Architecture

Goal: a clean layered codebase that a new developer can navigate in minutes, without over-engineering.
**Principle: the backend decides what happened (data semantics), the frontend decides how it is drawn (presentation).**

## Backend (Rust, `src-tauri/src`)

```
domain/            pure logic, no IO, no Tauri types. Fully unit-tested.
  event.rs           raw NDJSON event types
  interval.rs        FocusInterval, Session, off-periods
  builder.rs         events -> intervals + sessions (midnight split, missing logout, merging)
  aggregate.rs       per-day / per-app / per-span statistics
  entity.rs          app-or-folder entity resolution (folder merging rules)
infra/             talks to the outside world
  ndjson_reader.rs   reads day files, skips and counts bad lines
  watcher.rs         file watching (notify)
  settings_store.rs  client settings JSON (folders, checkbox states, theme) in %AppData%\Ophanim\Settings
service.rs         LogService: owns the per-day cache, answers queries (overview, day, app, sidebar)
dto.rs             serde structs sent to the UI (the only types the frontend sees)
commands.rs        thin #[tauri::command] functions: validate input, call service, return DTO
main.rs            wiring only
```

Dependencies point one way: `commands -> service -> domain`, `service -> infra`. `domain` imports nothing from the rest.
Folder membership and checkbox states live in the backend settings and are applied inside aggregation
(the UI sends mutations such as `set_folder_items`, then re-queries).

## Frontend (TypeScript + React, `src`)

```
app/               App shell, screen switching (main / day / app), providers
api/               typed wrappers over invoke(), DTO types mirrored from dto.rs. No logic.
features/
  sidebar/           span picker, search, sort, select buttons, app list, folder rows
  folders/           folder drag-and-drop rules (pure functions) + rename UI
  overview/          tiles, Heatmap/, Histogram/, Donut/ (each: component + pure geometry file)
  day/               day tiles, timeline
  app-detail/        tiles, ring, calendar, weekday bars, titles list
shared/
  ui/                Tile, Card, Select, Tooltip (only what 2+ features use)
  lib/               format.ts (dates, durations), colors.ts, scale.ts
  state/             one small store (Zustand): screen, span, view, sort, search, selected app/day
styles/
  tokens.css         CSS variables (copied exactly from the prototype), light + dark
  base.css           reset, typography, layout shell
  *.module.css       one CSS module next to each component
```

## Rules

- **Separation**: markup in components, styles in CSS modules + `tokens.css`, logic in plain `.ts` files or hooks.
  Inline `style` only for values that are computed at runtime (colors, sizes, positions).
- **Chart components are pure**: props in, SVG out. Geometry (scales, heatmap block grouping, histogram stacking,
  ring sectors) lives in separate pure functions next to the component and is unit-tested (Vitest).
- **No premature abstraction**. Extract a helper/component only when it is used in 2+ places. No interface with a single
  implementation, no `Manager`/`Factory`/`Service` classes in the frontend, no DI container, no generic repository layer,
  no event bus. Plain functions and modules first.
- **Size**: soft limit ~300 lines per file and ~50 lines per function; split by responsibility, not mechanically.
- **State**: server data comes from commands via small hooks (`useOverview(span)`, `useDay(date)`, ...); UI state in the one
  store. No Redux, no global event emitters.
- **Naming**: domain words from `SPEC.md` (entity, interval, session, span, folder). Same word, same meaning everywhere.
- **Errors**: backend returns typed errors; UI shows the empty/error states from SPEC section 8, never silent failures.

## Tests

- Rust: unit tests in `domain/` against fixtures (`docs/ui/fixtures` plus edge cases: bad line, no logout, no friendly_name,
  midnight crossing, folder merging).
- TypeScript: Vitest for `shared/lib`, folder rules, heatmap grouping, scales.
- Visual: Playwright screenshots of each screen vs the prototype with the same fixture.
