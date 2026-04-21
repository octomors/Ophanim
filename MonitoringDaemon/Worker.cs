using MonitoringDaemon.Abstractions;
using MonitoringDaemon.Infrastructure;

namespace MonitoringDaemon;

/// <summary>
/// Coordinates event sources and persistence for the monitoring daemon lifecycle.
/// </summary>
internal sealed class Worker : BackgroundService
{
    private readonly ILogger<Worker> _logger;
    private readonly IMonitorEventSink _sink;
    private readonly IEventFilterPolicy _eventFilterPolicy;
    private readonly IEnumerable<IMonitorEventSource> _eventSources;
    private readonly SessionEndMonitor _sessionEndMonitor;

    /// <summary>
    /// Creates a worker that orchestrates all monitoring components.
    /// </summary>
    public Worker(
        ILogger<Worker> logger,
        IMonitorEventSink sink,
        IEventFilterPolicy eventFilterPolicy,
        IEnumerable<IMonitorEventSource> eventSources,
        SessionEndMonitor sessionEndMonitor)
    {
        _logger = logger;
        _sink = sink;
        _eventFilterPolicy = eventFilterPolicy;
        _eventSources = eventSources;
        _sessionEndMonitor = sessionEndMonitor;
    }

    /// <summary>
    /// Starts sink and event sources and keeps daemon alive until cancellation.
    /// </summary>
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _eventFilterPolicy.Load();
        _sink.Start();
        _sessionEndMonitor.Start(() => _sink.FlushToDisk());

        foreach (var source in _eventSources)
        {
            source.Start(AppendIfAllowed);
        }

        _logger.LogInformation("Monitoring daemon started.");

        try
        {
            await Task.Delay(Timeout.Infinite, stoppingToken);
        }
        catch (OperationCanceledException)
        {
            // Expected on graceful shutdown.
        }
    }

    /// <summary>
    /// Stops all sources and forces final flush/dispose.
    /// </summary>
    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation("Monitoring daemon stopping.");

        _sessionEndMonitor.Stop();

        foreach (var source in _eventSources)
        {
            source.Stop();
        }

        _sink.FlushToDisk();
        _sink.Dispose();

        await base.StopAsync(cancellationToken);
    }

    private void AppendIfAllowed(Models.EventPayload evt)
    {
        if (_eventFilterPolicy.ShouldWrite(evt))
        {
            _sink.Append(evt);
        }
    }
}
