# MonitoringDaemon: Summary

## Short Description

MonitoringDaemon is a Windows background daemon that tracks process and window activity in real time.
It uses an event-driven model (no polling):

- Window focus changes via SetWinEventHook(EVENT_SYSTEM_FOREGROUND)
- Process lifecycle via WMI events:
	- Win32_ProcessStartTrace
	- Win32_ProcessStopTrace

Each event is serialized immediately and appended to NDJSON.

## Event Sources

1. Foreground changes:
	 - Win32 hook: SetWinEventHook
	 - Event: EVENT_SYSTEM_FOREGROUND
2. Process lifecycle:
	 - WMI query: SELECT * FROM Win32_ProcessStartTrace
	 - WMI query: SELECT * FROM Win32_ProcessStopTrace

## Simple Architecture

The project is intentionally split into small components:

- Worker (orchestrator): starts/stops all components and controls lifecycle.
- Abstractions:
	- IMonitorEventSource: event producer contract.
	- IMonitorEventSink: event persistence contract.
- Infrastructure:
	- ProcessWmiEventSource: process start/stop events.
	- ForegroundWindowFocusEventSource: focus events.
	- SessionEndMonitor: WM_ENDSESSION graceful-flush trigger.
	- NdjsonEventSink: append + periodic durable flush.
- Models:
	- EventPayload: compact NDJSON contract model.

Current folder map:

- MonitoringDaemon/Worker.cs
- MonitoringDaemon/Abstractions
- MonitoringDaemon/Infrastructure
- MonitoringDaemon/Models

## Output Path

- Root folder: %AppData%\\Ophanim
- Daily logs folder: %AppData%\\Ophanim\\DayLogs
- Filter policy folder: %AppData%\\Ophanim\\Settings\\FilterPolicy
- Filter files:
	- processLifecycle.whitelist.json
	- processLifecycle.blacklist.json
	- focusChanged.whitelist.json
	- focusChanged.blacklist.json
- File naming: yyyy-MM-dd.ndjson
- Mode: append-only

## Event Filter

At daemon startup, filter policy config is loaded from %AppData%\\Ophanim\\Settings\\FilterPolicy.
If files do not exist, daemon creates them with default content.

Each file schema:

```json
{
	"processes": ["chrome.exe", "code.exe"]
}
```

Rules:

- `processLifecycle.*` applies to `process_start` / `process_end` handlers.
- `focusChanged.*` applies to `focus_changed` handler.
- Filtering order inside handlers:
	1. If process is in whitelist: save event.
	2. Else if process is in blacklist: drop event.
	3. Else apply remaining hardcoded checks (for example, SessionId / MainWindowHandle checks).
- Process names are matched case-insensitively and normalized to .exe form.

Default generated content for each file:

```json
{
	"processes": []
}
```

## NDJSON Contract (Current)

Each line is one JSON object.

Common fields:

- event_type (string): process_start | process_end | focus_changed | logon | logout
- pid (number): process id
- time (string): UTC timestamp in ISO 8601 with seconds: yyyy-MM-ddTHH:mm:ssZ

Optional fields:

- exe_name (string): technical executable filename (for process_start/focus_changed)
- friendly_name (string): process display name from FileDescription when available
- window_visible (bool): IsWindowVisible(mainWindowHandle), false when main window exists but is not visible
- window_title (string): Process.MainWindowTitle when available
- class_name (string): foreground window class for focus_changed

Per-event JSON shape in practice:

- logon:
	- event_type, time
- logout:
	- event_type, time
- process_start:
	- event_type, pid, exe_name, friendly_name?, window_visible, window_title?, time
- process_end:
	- event_type, pid, time
- focus_changed:
	- event_type, pid, exe_name, friendly_name?, window_visible, window_title?, class_name?, time

Examples:

```json
{"event_type":"logon","time":"2026-04-21T09:00:00Z"}
{"event_type":"process_start","pid":12345,"exe_name":"chrome.exe","friendly_name":"Google Chrome","window_visible":true,"window_title":"YouTube - Google Chrome","time":"2026-04-21T13:30:00Z"}
{"event_type":"process_end","pid":12345,"time":"2026-04-21T13:35:00Z"}
{"event_type":"focus_changed","pid":12345,"exe_name":"chrome.exe","friendly_name":"Google Chrome","window_visible":true,"window_title":"YouTube - Google Chrome","class_name":"Chrome_WidgetWin_1","time":"2026-04-21T13:30:00Z"}
{"event_type":"logout","time":"2026-04-21T18:00:00Z"}
```

Notes:

- Null optional fields are omitted from output.
- Timestamps are normalized to UTC with second precision.

## Reliability

- Immediate write: each event is appended right after capture.
- Periodic durability: flush-to-disk every 30 seconds.
- Graceful shutdown flush:
	- ProcessExit
	- WM_ENDSESSION

Implementation detail:

- StreamWriter does not expose Flush(true).
- Durable flush is implemented as StreamWriter.Flush() + FileStream.Flush(true).

## Lifecycle

Startup sequence:

1. Ensure %AppData%\\Ophanim\\DayLogs exists.
2. Open daily NDJSON file in append mode (write-through).
3. Start WMI start/stop watchers.
4. Start WinEvent foreground hook.
5. Start 30-second flush loop.

Shutdown sequence:

1. Stop and dispose native event subscriptions.
2. Write `logout` event once (including session-end/PC shutdown path).
3. Force flush pending data to disk.
4. Dispose writer/stream safely.

## Boundaries

- No polling-based process scan.
- Event ordering can be very tight during bursty process trees (WMI delivery order is system-driven).
- Abrupt termination or power loss can still drop last in-flight events.

## Documentation Sync Policy

This file must be updated in the same change set whenever one of these is modified:

- NDJSON field names/types/semantics
- Event type names (event_type)
- Timestamp format
- Log location and rotation rules
- Data collection scope (exe_name, friendly_name, window visibility/title/class, filtering rules)

