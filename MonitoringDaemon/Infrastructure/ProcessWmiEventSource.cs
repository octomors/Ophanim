using System.Management;
using MonitoringDaemon.Abstractions;
using MonitoringDaemon.Models;

namespace MonitoringDaemon.Infrastructure;

/// <summary>
/// Emits process start/stop events using WMI trace classes.
/// </summary>
internal sealed class ProcessWmiEventSource : IMonitorEventSource
{
    private readonly ILogger<ProcessWmiEventSource> _logger;

    private ManagementEventWatcher? _processStartWatcher;
    private ManagementEventWatcher? _processStopWatcher;
    private Action<EventPayload>? _onEvent;

    public ProcessWmiEventSource(ILogger<ProcessWmiEventSource> logger)
    {
        _logger = logger;
    }

    /// <inheritdoc />
    public void Start(Action<EventPayload> onEvent)
    {
        _onEvent = onEvent;

        _processStartWatcher = new ManagementEventWatcher(new WqlEventQuery("SELECT * FROM Win32_ProcessStartTrace"));
        _processStartWatcher.EventArrived += (_, e) =>
        {
            var processName = EventFormatting.NormalizeProcessName(Convert.ToString(e.NewEvent?["ProcessName"]));
            var processId = Convert.ToInt32(e.NewEvent?["ProcessID"] ?? 0);
            var parentPid = EventFormatting.TryGetNullableInt(e.NewEvent?["ParentProcessID"]);
            var details = TryGetProcessDetails(processId);

            _onEvent?.Invoke(new EventPayload
            {
                t = "ps",
                a = EventFormatting.ToIsoUtcMs(DateTimeOffset.UtcNow),
                p = processId,
                n = processName,
                c = details.CommandLine,
                r = details.ParentPid ?? parentPid
            });
        };

        _processStopWatcher = new ManagementEventWatcher(new WqlEventQuery("SELECT * FROM Win32_ProcessStopTrace"));
        _processStopWatcher.EventArrived += (_, e) =>
        {
            var processName = EventFormatting.NormalizeProcessName(Convert.ToString(e.NewEvent?["ProcessName"]));
            var processId = Convert.ToInt32(e.NewEvent?["ProcessID"] ?? 0);
            var exitCode = EventFormatting.TryGetNullableInt(e.NewEvent?["ExitStatus"]);

            _onEvent?.Invoke(new EventPayload
            {
                t = "pe",
                a = EventFormatting.ToIsoUtcMs(DateTimeOffset.UtcNow),
                p = processId,
                n = processName,
                x = exitCode
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

        _onEvent = null;
    }

    /// <inheritdoc />
    public void Dispose()
    {
        Stop();
    }

    private static (string? CommandLine, int? ParentPid) TryGetProcessDetails(int pid)
    {
        try
        {
            using var searcher = new ManagementObjectSearcher(
                "root\\CIMV2",
                $"SELECT CommandLine, ParentProcessId FROM Win32_Process WHERE ProcessId = {pid}");
            using var results = searcher.Get();
            var process = results.Cast<ManagementObject>().FirstOrDefault();
            if (process is null)
            {
                return (null, null);
            }

            var commandLine = Convert.ToString(process["CommandLine"]);
            var parentPid = EventFormatting.TryGetNullableInt(process["ParentProcessId"]);
            return (commandLine, parentPid);
        }
        catch
        {
            return (null, null);
        }
    }
}
