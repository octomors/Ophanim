using System.Management;
using MonitoringDaemon.Abstractions;

namespace MonitoringDaemon.Infrastructure;

internal sealed class ManagementWmiEventWatcherFactory : IWmiEventWatcherFactory
{
    public IWmiEventWatcher Create(string wqlQuery)
    {
        var watcher = new ManagementEventWatcher(new WqlEventQuery(wqlQuery));
        return new ManagementWmiEventWatcher(watcher);
    }

    private sealed class ManagementWmiEventWatcher : IWmiEventWatcher
    {
        private readonly ManagementEventWatcher _watcher;

        public ManagementWmiEventWatcher(ManagementEventWatcher watcher)
        {
            _watcher = watcher;
        }

        public event EventArrivedEventHandler? EventArrived
        {
            add => _watcher.EventArrived += value;
            remove => _watcher.EventArrived -= value;
        }

        public void Start() => _watcher.Start();

        public void Stop() => _watcher.Stop();

        public void Dispose() => _watcher.Dispose();
    }
}
