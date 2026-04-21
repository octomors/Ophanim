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

    private EventFilterMode _mode = EventFilterMode.Denylist;
    private HashSet<string> _processes = new(StringComparer.OrdinalIgnoreCase);

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
                type = "denylist",
                processes = []
            };

            var json = JsonSerializer.Serialize(defaultConfig, _jsonOptions);
            File.WriteAllText(path, json);
            _logger.LogInformation("Created default event filter at {Path}", path);
        }

        try
        {
            var raw = File.ReadAllText(path);
            var config = JsonSerializer.Deserialize<EventFilterConfig>(raw) ?? new EventFilterConfig();

            _mode = ParseMode(config.type);
            _processes = (config.processes ?? [])
                .Where(p => !string.IsNullOrWhiteSpace(p))
                .Select(EventFormatting.NormalizeProcessName)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            _logger.LogInformation(
                "Loaded event filter: mode={Mode}, processes={Count}",
                _mode,
                _processes.Count);
        }
        catch (Exception ex)
        {
            _mode = EventFilterMode.Denylist;
            _processes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            _logger.LogWarning(ex, "Failed to parse event filter. Fallback to denylist with empty process list.");
        }
    }

    /// <inheritdoc />
    public bool ShouldWrite(EventPayload evt)
    {
        var process = EventFormatting.NormalizeProcessName(evt.n);
        var inList = _processes.Contains(process);

        return _mode switch
        {
            EventFilterMode.Allowlist => inList,
            EventFilterMode.Denylist => !inList,
            _ => true
        };
    }

    private static string GetFilterPath()
    {
        var appDataRoot = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        return Path.Combine(appDataRoot, "Ophanim", "eventFilter.json");
    }

    private static EventFilterMode ParseMode(string? raw)
    {
        return raw?.Trim().ToLowerInvariant() switch
        {
            "allowlist" => EventFilterMode.Allowlist,
            "denylist" => EventFilterMode.Denylist,
            _ => EventFilterMode.Denylist
        };
    }

    private enum EventFilterMode
    {
        Allowlist,
        Denylist
    }

    private sealed class EventFilterConfig
    {
        public string? type { get; init; }
        public List<string>? processes { get; init; }
    }
}
