using MonitoringDaemon.Models;

namespace MonitoringDaemon.Abstractions;

/// <summary>
/// Writes monitoring events to a persistent store.
/// </summary>
internal interface IMonitorEventSink : IDisposable
{
    /// <summary>
    /// Initializes sink resources and starts background durability routines.
    /// </summary>
    void Start();

    /// <summary>
    /// Appends a single event.
    /// </summary>
    void Append(EventPayload evt);

    /// <summary>
    /// Flushes buffered data to durable storage.
    /// </summary>
    void FlushToDisk();
}
