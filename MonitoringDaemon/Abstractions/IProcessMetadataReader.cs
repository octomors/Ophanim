using MonitoringDaemon.Infrastructure;

namespace MonitoringDaemon.Abstractions;

/// <summary>
/// Reads process and window metadata for monitoring events.
/// </summary>
internal interface IProcessMetadataReader
{
    ProcessMetadataSnapshot Read(int pid, string? fallbackProcessName);
}
