using System.Globalization;

namespace MonitoringDaemon.Infrastructure;

/// <summary>
/// Formatting helpers for monitoring events.
/// </summary>
internal static class EventFormatting
{
    /// <summary>
    /// Converts timestamp to local ISO 8601 with second precision and timezone offset.
    /// </summary>
    public static string ToIsoLocalSeconds(DateTimeOffset timestamp)
        => timestamp.ToLocalTime().ToString("yyyy-MM-ddTHH:mm:sszzz", CultureInfo.InvariantCulture);

    /// <summary>
    /// Ensures process name has .exe suffix.
    /// </summary>
    public static string NormalizeProcessName(string? processName)
    {
        if (string.IsNullOrWhiteSpace(processName))
        {
            return "unknown.exe";
        }

        var trimmed = processName.Trim();
        return trimmed.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? trimmed : trimmed + ".exe";
    }

    /// <summary>
    /// Safely converts boxed numeric values to nullable int.
    /// </summary>
    public static int? TryGetNullableInt(object? value)
    {
        if (value is null)
        {
            return null;
        }

        try
        {
            return Convert.ToInt32(value, CultureInfo.InvariantCulture);
        }
        catch
        {
            return null;
        }
    }
}
