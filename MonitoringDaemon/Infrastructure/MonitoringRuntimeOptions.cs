namespace MonitoringDaemon.Infrastructure;

/// <summary>
/// Runtime knobs for daemon reliability and shutdown behavior.
/// </summary>
internal sealed class MonitoringRuntimeOptions
{
    public const string SectionName = "Monitoring";

    public int FlushIntervalSeconds { get; init; } = 30;

    public int HookStopTimeoutSeconds { get; init; } = 2;

    public int SessionMonitorStopTimeoutSeconds { get; init; } = 2;

    public bool FailFastOnSourceStartFailure { get; init; } = true;

    public int ProcessMetadataCacheTtlSeconds { get; init; } = 15;

    public int ProcessMetadataCacheCapacity { get; init; } = 1024;

    public bool EnableSingleWriterQueue { get; init; } = true;

    public int WriteQueueCapacity { get; init; } = 4096;

    public int QueueDrainTimeoutMilliseconds { get; init; } = 2000;
}
