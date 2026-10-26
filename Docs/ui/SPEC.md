# Ophanim client: UI/UX specification

Visual reference: `prototype/index.html` (open with `fixtures/demo.ndjson`). This document holds the rules
that cannot be seen from screenshots. UI text is English.

## 1. Data semantics

- **Key of an app** = lower-cased `exe_name`. `friendly_name` is display-only (use the latest non-empty one, else exe).
- **Focus interval**: from a `focus_changed` to the next `focus_changed` or `logout`. `logon` closes a still-open
  interval at the last event before it. If the file ends, the open interval ends at the last event.
- **No idle detection** (an interval lasts until the next event). **Day boundary is fixed at 00:00** and intervals are
  split there. **DST is ignored**: use the local time written in `time`, ignore the offset.
- **Session**: `logon` to `logout`. A missing `logout` ends the session at the last event before the next `logon`
  (or the last event in the data). **Off period** = gap between two sessions. Several sessions per day are summed.
- **Launches** = count of `process_start` per app.
- Bad NDJSON lines are skipped and counted (shown in the header info / data state).
- "Today" = the last day that has data. Time spans end on that day.
- Time spans (sliding windows, no "last day"): Last 7 / 30 / 90 / 180 / 365 days, All time. Default 30.
- Per-app metrics: total, per-day sums, max per day, average per day (over active days; checkbox
  "count unused days" switches the divisor to all calendar days in the span), longest/average focus.

## 2. Global layout

- The app never scrolls as a page. Header (title + data buttons), then sidebar (260 px) + main area filling the window.
  Only these scroll internally: sidebar list, window titles list, day-screen rows when many.
- Charts size themselves to the free space and re-render on resize.
- Custom tooltips (not native) on every chart element and on tiles; they follow the cursor.
- Formats: dates `dd.mm.yy` (axis labels `dd.mm`), durations `3h 05m` / `12m` / `40s`, weekdays Mon..Sun, months Jan..Dec.
- Colors: each app gets a stable color from a hash of the exe name; folders use `hsl(round(id*137.508) mod 360, 65%, 50%)`
  (golden angle, recomputed from the id, never stored); "Other" is gray `#9aa1ad`; off periods are diagonal
  gray hatch (`--gap` background with `--mut` stripes at 45 deg, 6 px period).
- Theme tokens (light / dark): bg `#f4f5f7`/`#14161b`, panel `#fff`/`#1c1f26`, ink `#1b1f27`/`#e8eaf0`,
  muted `#6b7280`/`#8b93a3`, line `#dfe2e8`/`#2c303a`, accent `#2f6fed`/`#6c9bff`, gap `#e7e9ee`/`#262a33`.
  Font Onest 14px/1.4, radius 6 px (controls) / 8 px (cards), follow system theme.

## 3. Sidebar

Top to bottom:
1. Time-span select + the span as `dd.mm.yy – dd.mm.yy`. **Only place where the span is chosen.**
   On the day screen this row is replaced by `◀ dd.mm.yy, Wed ▶`; on the app screen it stays.
2. Search by name (exactly one row high; matches app name, exe, folder name).
3. Sort select + direction button. Options: By time, By first seen, Max per day, Average per day, By launches, By name.
   Default: by time, descending. Each row shows the value of the current sort attribute on the right.
4. Two buttons (hidden on the app screen):
   - **Select All Apps**: among listed apps whose checkbox is active (not dimmed by an enabled folder): if not all are
     checked, check all; if all are checked, uncheck all.
   - **Select All + folder icon**: same toggle for folders (enable all / disable all).
   Both act only on what is currently listed (span + search).
5. App list. Row = checkbox, color dot, name, sort value. Clicking the name opens the app screen.
   Checkbox = include in all stats/charts ("show").
6. Pinned at the bottom of the sidebar (always visible, gray): `Total: N apps` (apps, not folders).

Context rules: on the **day screen** the list and all values (time, max, avg, launches) are for that single day.
On the **app screen** checkboxes and the select buttons are hidden and the open app/folder row has an accent outline.

## 4. Folders (VS Code-like)

- Create: drag an app onto another ungrouped app. A folder "Folder N" is created with both, enabled, expanded,
  and its name goes straight into rename mode. Drag an app onto a folder or onto an app inside a folder to add it.
- No nested folders; folders are not draggable; an app belongs to at most one folder.
- Remove from folder: drag the app from the folder and drop it anywhere except another folder or another app
  (main area, header, empty sidebar space). It becomes a normal app again. Esc cancels the drag. Dropping on itself or
  on a sibling in the same folder does nothing. A folder with no apps is deleted automatically.
- Folder row looks like an app row: checkbox, colored folder icon, name, combined sort value, expand chevron (right).
  Expanded folders show their apps below, indented. Search auto-expands folders.
- Rename: double-click the name; Enter or blur saves, Esc cancels. Single click on the name opens the folder screen
  (delayed about 250 ms so a double-click does not open it).
- **Folder checked (on)**: all member checkboxes are shown checked and dimmed/disabled. Stats count **all** members,
  regardless of their own checkbox state (the view must reflect reality). In every view (heatmap, histogram, donut,
  day screen) the members are **one entity** with the folder's name and color.
  Consecutive focus intervals of members that touch in time are **merged into one focus**: switching inside the folder
  is not a focus switch, longest/average focus use the merged intervals.
- **Folder unchecked (off)**: member checkboxes become active again and keep their previous states; everything is shown
  per app as if the folder did not exist.
- Folder row value = aggregate over members (sum of time, merged day sums for max/avg, sum of launches, earliest first seen).
- Folder screen = app screen over the union of members. Under the name it says `Folder · N apps`; window titles
  come from all members. It also opens by clicking the folder's color on any chart.
- Folders (id, name, on, open, items) persist between runs.

## 5. Main window

Top row of tiles (equal height, one row): **View** (dropdown: Heatmap / Histogram / Donut chart), **Screen time**
(tooltip: total time of the selected apps, plus how many are hidden), **Active days**, **Most active day**
(clickable, opens that day), **Focus switches**, **Daemon** (green dot + last event date/time).
Below: the chart card filling all remaining space.

Heatmap
- X = days of the span, Y = 24 hours: `00:00` at the bottom, `24:00` at the top, a label and a horizontal line every hour.
- Disabled for spans over 60 days (option disabled; automatically falls back to the histogram).
- Segments are drawn at their true time and height. Grouping rule: consecutive intervals each shorter than 30 min are
  merged into one block while the block is shorter than 30 min; the gap between merged intervals must be at most 2 min.
  Intervals of 30 min or more are drawn individually. A block with one entity is solid; with several it is hatched
  diagonally with up to 4 colors (largest first). Minimum block height 3 px (1.5 px solid).
- Off periods (between sessions) are drawn behind as gray hatch, tooltip `PC off · duration`.
- Tooltip of a block: date and each entity with its time (plus window title for single intervals).
- Click: day label -> that day; solid block -> that app/folder; mixed block -> its longest entity; off hatch -> that day.

Histogram
- Stacked bars per day (per month if the span is over 120 days). Y axis in hours with a line every hour
  (step grows if there are too many). Inside a bar the biggest entity is at the bottom.
- Entities below 3% of the axis maximum in that bar are summed into gray "Other" on top; its tooltip lists them with times.
- Click: segment -> app/folder; "Other" and the x label (day mode) -> that day.

Donut
- Share of each entity in total screen time; slices under 2% merge into "Other"; total time in the center;
  legend beside it. Click a slice or legend row -> app/folder screen.

## 6. Day screen

- Back button; sidebar shows the day navigation (see 3). Arrows go through all days that have data.
- Tiles: **Session time** (tooltip lists `hh:mm–hh:mm` periods the PC was on), **Screen time** (tooltip as above),
  **Focus switches**, **Longest focus** (time + app name), **Apps launched**.
- Timeline card: one row per entity used that day (sorted by time, descending), X = 00:00..24:00 with hour lines and labels.
  Off periods as gray hatch across all rows. Mouse wheel scrolls horizontally, Ctrl+wheel zooms (no hint text on screen).
  Segment tooltip: app, window title, duration. Click a segment or the row label -> app/folder screen.

## 7. App / folder screen

Three columns:
1. Back button, name (36 px), exe or `Folder · N apps` (28 px), then two rows of tiles:
   Total + Max per day (opens that day); Average per day (with the "count unused days" checkbox; tooltip shows
   the divisor) + Avg/Max focus (opens the day of the longest focus).
2. Column width equals the width of the 24 h ring. Top to bottom: **Hours of day** ring, **Calendar**,
   **By weekday**. The ring is sized from available height; calendar and weekday card adapt to its width.
   - Ring: 24 sectors; opacity = 0.08 + 0.92 * (focus time in that hour over the span / max hour). Hour labels every 3 h
     around the ring, top label `00:00 / 24:00`. Tooltip: hour range and total.
   - Calendar (GitHub-style): columns = weeks, rows Sun..Sat with labels Mon/Wed/Fri, month labels on top,
     cell opacity by that day's time, tooltip `dd.mm.yy: time`, click opens the day. Shows the last 371 days of the span.
   - By weekday: 7 bars Mon..Sun showing the **average** per weekday (honours "count unused days"), tooltip `Mon: avg 1h 20m on 6 days`.
3. Window titles (min 420 px, takes the free width): title with the app suffix stripped (text after the last " - "),
   time and share, sorted by time.

## 8. States and not-in-scope

- First run / no data: "Connect your logs" screen with folder picker, files and demo; drag-and-drop files supported.
- Not in scope for v1: idle detection, DST handling, settings screen, raw-events table, rules by window title,
  app icons, day notes, period comparison, live updating (planned next), editing the daemon FilterPolicy.

## 9. Acceptance checklist

- Every screen matches the prototype at 1440x900 and 1280x720 with `demo.ndjson`, with no page scrolling.
- Every click-through in sections 5-7 works; every tooltip listed exists.
- Folder rules of section 4 pass tests (merge, dim states, drag-out, rename, persistence).
- Numbers equal the prototype's for the same fixture (screen time, active days, most active day, focus switches).
