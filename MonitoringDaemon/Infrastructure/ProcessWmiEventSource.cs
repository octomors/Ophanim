using System.Management;
using System.Collections.Concurrent;
using System.Diagnostics;
using MonitoringDaemon.Abstractions;
using MonitoringDaemon.Models;

namespace MonitoringDaemon.Infrastructure;

/// <summary>
/// Emits process start/stop events using WMI trace classes.
/// </summary>
internal sealed class ProcessWmiEventSource : IMonitorEventSource
{
    private readonly ILogger<ProcessWmiEventSource> _logger;
    private readonly IEventFilterPolicy _eventFilterPolicy;
    private readonly IWmiEventWatcherFactory _wmiWatcherFactory;
    private readonly IProcessMetadataReader _processMetadataReader;
    private readonly ConcurrentDictionary<int, ProcessSnapshot> _snapshotByPid = new();
    private readonly int _currentSessionId = Process.GetCurrentProcess().SessionId;

    private IWmiEventWatcher? _processStartWatcher;
    private IWmiEventWatcher? _processStopWatcher;
    private Action<EventPayload>? _onEvent;

    public ProcessWmiEventSource(
        ILogger<ProcessWmiEventSource> logger,
        IEventFilterPolicy eventFilterPolicy,
        IWmiEventWatcherFactory wmiWatcherFactory,
        IProcessMetadataReader processMetadataReader)
    {
        _logger = logger;
        _eventFilterPolicy = eventFilterPolicy;
        _wmiWatcherFactory = wmiWatcherFactory;
        _processMetadataReader = processMetadataReader;
    }

    /// <inheritdoc />
    public void Start(Action<EventPayload> onEvent)
    {
        _onEvent = onEvent;

        _processStartWatcher = _wmiWatcherFactory.Create("SELECT * FROM Win32_ProcessStartTrace");
        _processStartWatcher.EventArrived += (_, e) => HandleProcessStart(e);

        _processStopWatcher = _wmiWatcherFactory.Create("SELECT * FROM Win32_ProcessStopTrace");
        _processStopWatcher.EventArrived += (_, e) => HandleProcessStop(e);

        _processStartWatcher.Start();
        _processStopWatcher.Start();

        _logger.LogInformation("WMI process event source started.");
    }

    /// <inheritdoc />
    public void Stop()
    {
        _processStartWatcher?.Stop();
        _processStartWatcher?.Dispose();
        _processStartWatcher = null;

        _processStopWatcher?.Stop();
        _processStopWatcher?.Dispose();
        _processStopWatcher = null;

        _snapshotByPid.Clear();
        _onEvent = null;
    }

    /// <inheritdoc />
    public void Dispose()
    {
        Stop();
    }

    private void HandleProcessStart(EventArrivedEventArgs e)
    {
        try
        {
            var processId = Convert.ToInt32(e.NewEvent?["ProcessID"] ?? 0);
            var sessionId = EventFormatting.TryGetNullableInt(e.NewEvent?["SessionID"]);
            if (sessionId.HasValue && sessionId.Value != _currentSessionId)
            {
                return;
            }

            var snapshotData = _processMetadataReader.Read(processId, Convert.ToString(e.NewEvent?["ProcessName"]));
            var snapshot = new ProcessSnapshot(
                snapshotData.ExeName,
                snapshotData.FriendlyName,
                snapshotData.WindowVisible,
                snapshotData.WindowTitle,
                snapshotData.MainWindowHandle);
            var isWhitelisted = _eventFilterPolicy.IsWhitelistedProcess(snapshot.ExeName, EventFilterScope.ProcessLifecycle);
            if (!isWhitelisted)
            {
                if (_eventFilterPolicy.IsBlacklistedProcess(snapshot.ExeName, EventFilterScope.ProcessLifecycle))
                {
                    return;
                }

                if (snapshot.MainWindowHandle == IntPtr.Zero)
                {
                    return;
                }
            }

            _snapshotByPid[processId] = snapshot;

            _onEvent?.Invoke(new EventPayload
            {
                event_type = "process_start",
                pid = processId,
                friendly_name = snapshot.FriendlyName,
                exe_name = snapshot.ExeName,
                window_visible = snapshot.WindowVisible,
                window_title = snapshot.WindowTitle,
                time = EventFormatting.ToIsoLocalSeconds(DateTimeOffset.Now)
            });
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Process start event handler failed; event skipped.");
        }
    }

    private void HandleProcessStop(EventArrivedEventArgs e)
    {
        try
        {
            var processId = Convert.ToInt32(e.NewEvent?["ProcessID"] ?? 0);
            var hasCachedSnapshot = _snapshotByPid.TryRemove(processId, out _);
            if (!hasCachedSnapshot)
            {
                var sessionId = EventFormatting.TryGetNullableInt(e.NewEvent?["SessionID"]);
                if (sessionId.HasValue && sessionId.Value != _currentSessionId)
                {
                    return;
                }

                return;
            }

            _onEvent?.Invoke(new EventPayload
            {
                event_type = "process_end",
                pid = processId,
                time = EventFormatting.ToIsoLocalSeconds(DateTimeOffset.Now)
            });
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Process stop event handler failed; event skipped.");
        }
    }

    private sealed record ProcessSnapshot(
        string ExeName,
        string? FriendlyName,
        bool WindowVisible,
        string? WindowTitle,
        IntPtr MainWindowHandle);
}
