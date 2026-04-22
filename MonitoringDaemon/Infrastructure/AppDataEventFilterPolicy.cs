using System.Text.Json;
using MonitoringDaemon.Abstractions;
using MonitoringDaemon.Models;

namespace MonitoringDaemon.Infrastructure;

/// <summary>
/// Reads process allow/deny list from AppData and evaluates event write decisions.
/// </summary>
internal sealed class AppDataEventFilterPolicy : IEventFilterPolicy
{
    private readonly ILogger<AppDataEventFilterPolicy> _logger;
    private readonly JsonSerializerOptions _jsonOptions = new() { WriteIndented = true };

    private HashSet<string> _blacklist = new(StringComparer.OrdinalIgnoreCase);

    public AppDataEventFilterPolicy(ILogger<AppDataEventFilterPolicy> logger)
    {
        _logger = logger;
    }

    /// <inheritdoc />
    public void Load()
    {
        var path = GetFilterPath();
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);

        if (!File.Exists(path))
        {
            var defaultConfig = new EventFilterConfig
            {
                blacklist = []
            };

            var json = JsonSerializer.Serialize(defaultConfig, _jsonOptions);
            File.WriteAllText(path, json);
            _logger.LogInformation("Created default event filter at {Path}", path);
        }

        try
        {
            var raw = File.ReadAllText(path);
            var config = JsonSerializer.Deserialize<EventFilterConfig>(raw) ?? new EventFilterConfig();

            // Backward compatibility: if old schema is present and denylist was used,
            // reuse processes as blacklist values.
            var sourceList = config.blacklist;
            if (sourceList is null && string.Equals(config.type, "denylist", StringComparison.OrdinalIgnoreCase))
            {
                sourceList = config.processes;
            }

            _blacklist = (sourceList ?? [])
                .Where(p => !string.IsNullOrWhiteSpace(p))
                .Select(EventFormatting.NormalizeProcessName)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            _logger.LogInformation(
                "Loaded event blacklist: processes={Count}",
                _blacklist.Count);
        }
        catch (Exception ex)
        {
            _blacklist = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            _logger.LogWarning(ex, "Failed to parse event filter. Fallback to empty blacklist.");
        }
    }

    /// <inheritdoc />
    public bool IsBlacklistedProcess(string? exeName)
    {
        if (string.IsNullOrWhiteSpace(exeName))
        {
            return false;
        }

        var process = EventFormatting.NormalizeProcessName(exeName);
        return _blacklist.Contains(process);
    }

    /// <inheritdoc />
    public bool ShouldWrite(EventPayload evt)
    {
        return !IsBlacklistedProcess(evt.exe_name);
    }

    private static string GetFilterPath()
    {
        var appDataRoot = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        return Path.Combine(appDataRoot, "Ophanim", "eventFilter.json");
    }

    private sealed class EventFilterConfig
    {
        public string? type { get; init; }
        public List<string>? processes { get; init; }
        public List<string>? blacklist { get; init; }
    }
}
