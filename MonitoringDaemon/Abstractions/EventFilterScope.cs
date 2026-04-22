namespace MonitoringDaemon.Abstractions;

/// <summary>
/// Identifies which event handler pipeline applies a process filter policy.
/// </summary>
internal enum EventFilterScope
{
    ProcessLifecycle,
    FocusChanged
}
