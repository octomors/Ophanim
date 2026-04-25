using MonitoringDaemon.Abstractions;
using MonitoringDaemon.Infrastructure;
using Microsoft.Extensions.Options;

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
    private readonly IHostApplicationLifetime _hostApplicationLifetime;
    private readonly MonitoringRuntimeOptions _runtimeOptions;
    private int _logoutWritten;

    /// <summary>
    /// Creates a worker that orchestrates all monitoring components.
    /// </summary>
    public Worker(
        ILogger<Worker> logger,
        IMonitorEventSink sink,
        IEventFilterPolicy eventFilterPolicy,
        IEnumerable<IMonitorEventSource> eventSources,
        SessionEndMonitor sessionEndMonitor,
        IHostApplicationLifetime hostApplicationLifetime,
        IOptions<MonitoringRuntimeOptions> runtimeOptions)
    {
        _logger = logger;
        _sink = sink;
        _eventFilterPolicy = eventFilterPolicy;
        _eventSources = eventSources;
        _sessionEndMonitor = sessionEndMonitor;
        _hostApplicationLifetime = hostApplicationLifetime;
        _runtimeOptions = runtimeOptions.Value;
    }

    /// <summary>
    /// Starts sink and event sources and keeps daemon alive until cancellation.
    /// </summary>
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _eventFilterPolicy.Load();
        _sink.Start();
        _sessionEndMonitor.Start(() =>
        {
            WriteLogoutEventOnce();
            _sink.FlushToDisk();
        });

        var sourceStartFailed = false;

        foreach (var source in _eventSources)
        {
            try
            {
                source.Start(AppendIfAllowed);
            }
            catch (Exception ex)
            {
                sourceStartFailed = true;
                _logger.LogError(ex, "Failed to start event source {SourceType}", source.GetType().Name);
            }
        }

        if (sourceStartFailed && _runtimeOptions.FailFastOnSourceStartFailure)
        {
            _logger.LogCritical("Stopping daemon due to event source startup failure (Monitoring:FailFastOnSourceStartFailure=true).");
            _hostApplicationLifetime.StopApplication();
            return;
        }

        AppendIfAllowed(new Models.EventPayload
        {
            event_type = "logon",
            time = EventFormatting.ToIsoLocalSeconds(DateTimeOffset.Now)
        });

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

        WriteLogoutEventOnce();

        foreach (var source in _eventSources)
        {
            try
            {
                source.Stop();
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to stop event source {SourceType}", source.GetType().Name);
            }

            try
            {
                source.Dispose();
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to dispose event source {SourceType}", source.GetType().Name);
            }
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

    private void WriteLogoutEventOnce()
    {
        if (System.Threading.Interlocked.Exchange(ref _logoutWritten, 1) != 0)
        {
            return;
        }

        _sink.Append(new Models.EventPayload
        {
            event_type = "logout",
            time = EventFormatting.ToIsoLocalSeconds(DateTimeOffset.Now)
        });
    }
}
