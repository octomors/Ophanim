namespace MonitoringDaemon.Infrastructure;

/// <summary>
/// Process and window metadata used by event sources.
/// </summary>
internal sealed record ProcessMetadataSnapshot(
    string ExeName,
    string? FriendlyName,
    int? SessionId,
    bool WindowVisible,
    string? WindowTitle,
    IntPtr MainWindowHandle);
