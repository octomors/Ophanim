namespace MonitoringDaemon.Abstractions;

/// <summary>
/// Creates WMI event watchers for WQL subscriptions.
/// </summary>
internal interface IWmiEventWatcherFactory
{
    IWmiEventWatcher Create(string wqlQuery);
}
