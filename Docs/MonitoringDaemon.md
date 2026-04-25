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
- time (string): local timestamp in ISO 8601 with seconds and timezone offset: yyyy-MM-ddTHH:mm:sszzz

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
{"event_type":"logon","time":"2026-04-21T12:00:00+03:00"}
{"event_type":"process_start","pid":12345,"exe_name":"chrome.exe","friendly_name":"Google Chrome","window_visible":true,"window_title":"YouTube - Google Chrome","time":"2026-04-21T16:30:00+03:00"}
{"event_type":"process_end","pid":12345,"time":"2026-04-21T16:35:00+03:00"}
{"event_type":"focus_changed","pid":12345,"exe_name":"chrome.exe","friendly_name":"Google Chrome","window_visible":true,"window_title":"YouTube - Google Chrome","class_name":"Chrome_WidgetWin_1","time":"2026-04-21T16:30:00+03:00"}
{"event_type":"logout","time":"2026-04-21T21:00:00+03:00"}
```

Notes:

- Null optional fields are omitted from output.
- Timestamps use local machine time with second precision and timezone offset.

## Reliability

- Immediate ingestion: each event is enqueued right after capture.
- Single-writer persistence: one dedicated writer task appends NDJSON lines to reduce lock contention.
- Periodic durability: flush-to-disk every `Monitoring:FlushIntervalSeconds`.
- Graceful shutdown flush:
	- ProcessExit
	- WM_ENDSESSION
- Flush loop resilience: periodic flush exceptions are logged and loop continues.

Implementation detail:

- StreamWriter does not expose Flush(true).
- Durable flush is implemented as StreamWriter.Flush() + FileStream.Flush(true).

## Lifecycle

Startup sequence:

1. Ensure %AppData%\\Ophanim\\DayLogs exists.
2. Open daily NDJSON file in append mode (write-through).
3. Start WMI start/stop watchers.
4. Start WinEvent foreground hook.
5. Start periodic flush loop using configured interval.

Startup fail-fast policy:

- If any event source fails to start and `Monitoring:FailFastOnSourceStartFailure=true`, daemon requests host stop.

Shutdown sequence:

1. Stop and dispose native event subscriptions.
2. Write `logout` event once (including session-end/PC shutdown path).
3. Force flush pending data to disk.
4. Dispose writer/stream safely.

Shutdown timeout knobs:

- `Monitoring:HookStopTimeoutSeconds` for foreground hook thread join.
- `Monitoring:SessionMonitorStopTimeoutSeconds` for WM_ENDSESSION thread join.

## Runtime Configuration

`appsettings*.json` section:

```json
"Monitoring": {
	"FlushIntervalSeconds": 30,
	"HookStopTimeoutSeconds": 2,
	"SessionMonitorStopTimeoutSeconds": 2,
	"FailFastOnSourceStartFailure": true,
	"ProcessMetadataCacheTtlSeconds": 15,
	"ProcessMetadataCacheCapacity": 1024,
	"EnableSingleWriterQueue": true,
	"WriteQueueCapacity": 4096,
	"QueueDrainTimeoutMilliseconds": 2000
}
```

Performance-oriented settings:

- `ProcessMetadataCacheTtlSeconds`: cache lifetime for static process metadata (exe/friendly name).
- `ProcessMetadataCacheCapacity`: upper bound for in-memory metadata cache entries.
- `EnableSingleWriterQueue`: enables queue-based single-writer append path.
- `WriteQueueCapacity`: bounded queue capacity for pending serialized events.
- `QueueDrainTimeoutMilliseconds`: max wait for queue drain before durable flush.

## Performance Smoke

Use `Scripts/perf-smoke.ps1` to collect CPU/RAM metrics and NDJSON line growth for a running daemon process.

Example:

```powershell
.\Scripts\perf-smoke.ps1 -ProcessName MonitoringDaemon -DurationSeconds 120 -IntervalMs 1000
```

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

