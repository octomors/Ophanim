using System.Management;
using System.Runtime.InteropServices;
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
    private readonly ConcurrentDictionary<int, ProcessSnapshot> _snapshotByPid = new();
    private readonly int _currentSessionId = Process.GetCurrentProcess().SessionId;

    private ManagementEventWatcher? _processStartWatcher;
    private ManagementEventWatcher? _processStopWatcher;
    private Action<EventPayload>? _onEvent;

    public ProcessWmiEventSource(ILogger<ProcessWmiEventSource> logger, IEventFilterPolicy eventFilterPolicy)
    {
        _logger = logger;
        _eventFilterPolicy = eventFilterPolicy;
    }

    /// <inheritdoc />
    public void Start(Action<EventPayload> onEvent)
    {
        _onEvent = onEvent;

        _processStartWatcher = new ManagementEventWatcher(new WqlEventQuery("SELECT * FROM Win32_ProcessStartTrace"));
        _processStartWatcher.EventArrived += (_, e) =>
        {
            var processId = Convert.ToInt32(e.NewEvent?["ProcessID"] ?? 0);
            var sessionId = EventFormatting.TryGetNullableInt(e.NewEvent?["SessionID"]);
            if (sessionId.HasValue && sessionId.Value != _currentSessionId)
            {
                return;
            }

            var snapshot = BuildSnapshot(processId, Convert.ToString(e.NewEvent?["ProcessName"]));
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
        };

        _processStopWatcher = new ManagementEventWatcher(new WqlEventQuery("SELECT * FROM Win32_ProcessStopTrace"));
        _processStopWatcher.EventArrived += (_, e) =>
        {
            var processId = Convert.ToInt32(e.NewEvent?["ProcessID"] ?? 0);
            var hasCachedSnapshot = _snapshotByPid.TryRemove(processId, out var cached);
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
        };

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

    private static ProcessSnapshot BuildSnapshot(int pid, string? fallbackProcessName)
    {
        var exeName = EventFormatting.NormalizeProcessName(fallbackProcessName);
        string? friendlyName = null;
        var windowVisible = false;
        string? windowTitle = null;
        var mainWindowHandle = IntPtr.Zero;

        try
        {
            using var process = Process.GetProcessById(pid);
            process.Refresh();

            if (!string.IsNullOrWhiteSpace(process.ProcessName))
            {
                exeName = EventFormatting.NormalizeProcessName(process.ProcessName);
            }

            try
            {
                var moduleFileName = process.MainModule?.FileName;
                if (!string.IsNullOrWhiteSpace(moduleFileName))
                {
                    exeName = EventFormatting.NormalizeProcessName(Path.GetFileName(moduleFileName));
                }

                var description = process.MainModule?.FileVersionInfo?.FileDescription;
                if (!string.IsNullOrWhiteSpace(description))
                {
                    friendlyName = description;
                }
            }
            catch
            {
                // Access to MainModule can be denied for some processes.
            }

            mainWindowHandle = process.MainWindowHandle;
            if (mainWindowHandle != IntPtr.Zero)
            {
                windowVisible = ProcessNativeMethods.IsWindowVisible(mainWindowHandle);
            }

            windowTitle = string.IsNullOrWhiteSpace(process.MainWindowTitle) ? null : process.MainWindowTitle;
        }
        catch
        {
            // Process can disappear between WMI event and metadata read.
        }

        return new ProcessSnapshot(exeName, friendlyName, windowVisible, windowTitle, mainWindowHandle);
    }

    private sealed record ProcessSnapshot(
        string ExeName,
        string? FriendlyName,
        bool WindowVisible,
        string? WindowTitle,
        IntPtr MainWindowHandle);
}

internal static class ProcessNativeMethods
{
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool IsWindowVisible(IntPtr hWnd);
}
