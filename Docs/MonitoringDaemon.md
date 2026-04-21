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
- File naming: yyyy-MM-dd.ndjson
- Mode: append-only

## NDJSON Contract (Current)

Each line is one JSON object.

Common fields:

- t (string): event type
	- ps = process_start
	- pe = process_end
	- wf = window_focus
- a (string): UTC timestamp in ISO 8601 with milliseconds: yyyy-MM-ddTHH:mm:ss.fffZ
- p (number): process id
- n (string): process name (exe)

Optional fields:

- c (string?): command line, only for ps
- r (number?): parent pid, only for ps
- w (string?): window title, only for wf
- k (string?): window class, only for wf
- x (number?): exit code, only for pe

Examples:

```json
{"t":"ps","a":"2026-04-21T13:28:16.009Z","p":6800,"n":"conhost.exe","c":"\"C:\\Windows\\System32\\conhost.exe\" 0x4","r":5120}
{"t":"wf","a":"2026-04-21T13:29:01.442Z","p":22092,"n":"chrome.exe","w":"ChatGPT - Google Chrome","k":"Chrome_WidgetWin_1"}
{"t":"pe","a":"2026-04-21T13:30:28.161Z","p":22092,"n":"chrome.exe","x":0}
```

Notes:

- Null optional fields are omitted from output.
- Timestamps are normalized to UTC with millisecond precision.

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
2. Force flush pending data to disk.
3. Dispose writer/stream safely.

## Boundaries

- No polling-based process scan.
- Event ordering can be very tight during bursty process trees (WMI delivery order is system-driven).
- Abrupt termination or power loss can still drop last in-flight events.

## Documentation Sync Policy

This file must be updated in the same change set whenever one of these is modified:

- NDJSON field names/types/semantics
- Event type codes (t)
- Timestamp format
- Log location and rotation rules
- Data collection scope (cmdline, parent pid, window metadata, exit code)

