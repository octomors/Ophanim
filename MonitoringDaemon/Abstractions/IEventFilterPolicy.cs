using MonitoringDaemon.Models;

namespace MonitoringDaemon.Abstractions;

/// <summary>
/// Defines process-name based filtering policy for outgoing events.
/// </summary>
internal interface IEventFilterPolicy
{
    /// <summary>
    /// Loads filter configuration from AppData and initializes runtime state.
    /// </summary>
    void Load();

    /// <summary>
    /// Returns true when an event should be written to DayLogs.
    /// </summary>
    bool ShouldWrite(EventPayload evt);
}
