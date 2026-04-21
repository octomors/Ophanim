namespace MonitoringDaemon.Models;

/// <summary>
/// Represents one NDJSON monitoring event in compact format.
/// </summary>
internal sealed class EventPayload
{
    /// <summary>Event type: ps, pe, wf.</summary>
    public string t { get; init; } = string.Empty;

    /// <summary>UTC timestamp in yyyy-MM-ddTHH:mm:ss.fffZ format.</summary>
    public string a { get; init; } = string.Empty;

    /// <summary>Process ID.</summary>
    public int p { get; init; }

    /// <summary>Process executable name.</summary>
    public string n { get; init; } = string.Empty;

    /// <summary>Full command line (ps only).</summary>
    public string? c { get; init; }

    /// <summary>Parent process ID (ps only).</summary>
    public int? r { get; init; }

    /// <summary>Window title (wf only).</summary>
    public string? w { get; init; }

    /// <summary>Window class (wf only).</summary>
    public string? k { get; init; }

    /// <summary>Exit code (pe only).</summary>
    public int? x { get; init; }
}
