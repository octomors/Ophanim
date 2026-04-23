namespace MonitoringDaemon.Models;

/// <summary>
/// Represents one NDJSON monitoring event payload.
/// </summary>
internal sealed class EventPayload
{
    /// <summary>Event type: process_start, process_end, focus_changed, logon, logout.</summary>
    public string event_type { get; init; } = string.Empty;

    /// <summary>Process identifier when the event is process-related.</summary>
    public int? pid { get; init; }

    /// <summary>Technical executable filename.</summary>
    public string? exe_name { get; init; }

    /// <summary>Human-friendly process name from file description.</summary>
    public string? friendly_name { get; init; }

    /// <summary>Whether process main window is visible.</summary>
    public bool? window_visible { get; init; }

    /// <summary>Main process window title when available.</summary>
    public string? window_title { get; init; }

    /// <summary>Window class for focus_changed events.</summary>
    public string? class_name { get; init; }

    /// <summary>Event timestamp in UTC ISO 8601 format.</summary>
    public string time { get; init; } = string.Empty;
}
