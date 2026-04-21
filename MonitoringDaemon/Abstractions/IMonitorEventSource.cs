using MonitoringDaemon.Models;

namespace MonitoringDaemon.Abstractions;

/// <summary>
/// Produces monitoring events from one event-driven source.
/// </summary>
internal interface IMonitorEventSource : IDisposable
{
    /// <summary>
    /// Starts producing events.
    /// </summary>
    /// <param name="onEvent">Callback to deliver events.</param>
    void Start(Action<EventPayload> onEvent);

    /// <summary>
    /// Stops producing events.
    /// </summary>
    void Stop();
}
