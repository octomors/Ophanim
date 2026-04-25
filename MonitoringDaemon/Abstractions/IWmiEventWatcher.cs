using System.Management;

namespace MonitoringDaemon.Abstractions;

/// <summary>
/// Wrapper around one WMI event watcher.
/// </summary>
internal interface IWmiEventWatcher : IDisposable
{
    event EventArrivedEventHandler? EventArrived;

    void Start();

    void Stop();
}
