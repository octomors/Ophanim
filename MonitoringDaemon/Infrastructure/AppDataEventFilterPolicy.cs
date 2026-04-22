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

    private HashSet<string> _processLifecycleWhitelist = new(StringComparer.OrdinalIgnoreCase);
    private HashSet<string> _processLifecycleBlacklist = new(StringComparer.OrdinalIgnoreCase);
    private HashSet<string> _focusChangedWhitelist = new(StringComparer.OrdinalIgnoreCase);
    private HashSet<string> _focusChangedBlacklist = new(StringComparer.OrdinalIgnoreCase);

    public AppDataEventFilterPolicy(ILogger<AppDataEventFilterPolicy> logger)
    {
        _logger = logger;
    }

    /// <inheritdoc />
    public void Load()
    {
        var policyDirectory = GetFilterPolicyDirectory();
        Directory.CreateDirectory(policyDirectory);

        _processLifecycleWhitelist = LoadProcessSet(
            Path.Combine(policyDirectory, "processLifecycle.whitelist.json"),
            "process lifecycle whitelist");

        _processLifecycleBlacklist = LoadProcessSet(
            Path.Combine(policyDirectory, "processLifecycle.blacklist.json"),
            "process lifecycle blacklist");

        _focusChangedWhitelist = LoadProcessSet(
            Path.Combine(policyDirectory, "focusChanged.whitelist.json"),
            "focus_changed whitelist");

        _focusChangedBlacklist = LoadProcessSet(
            Path.Combine(policyDirectory, "focusChanged.blacklist.json"),
            "focus_changed blacklist");

        _logger.LogInformation(
            "Loaded filter policy: processWhitelist={ProcessWhitelist}, processBlacklist={ProcessBlacklist}, focusWhitelist={FocusWhitelist}, focusBlacklist={FocusBlacklist}",
            _processLifecycleWhitelist.Count,
            _processLifecycleBlacklist.Count,
            _focusChangedWhitelist.Count,
            _focusChangedBlacklist.Count);
    }

    /// <inheritdoc />
    public bool IsWhitelistedProcess(string? exeName, EventFilterScope scope)
    {
        var process = NormalizeOrNull(exeName);
        return process is not null && GetWhitelist(scope).Contains(process);
    }

    /// <inheritdoc />
    public bool IsBlacklistedProcess(string? exeName, EventFilterScope scope)
    {
        var process = NormalizeOrNull(exeName);
        return process is not null && GetBlacklist(scope).Contains(process);
    }

    /// <inheritdoc />
    public bool ShouldWrite(EventPayload evt)
    {
        if (TryResolveScope(evt.event_type, out var scope))
        {
            if (IsWhitelistedProcess(evt.exe_name, scope))
            {
                return true;
            }

            if (IsBlacklistedProcess(evt.exe_name, scope))
            {
                return false;
            }
        }

        return true;
    }

    private HashSet<string> LoadProcessSet(string path, string label)
    {
        if (!File.Exists(path))
        {
            var json = JsonSerializer.Serialize(new ProcessFilterListConfig { processes = [] }, _jsonOptions);
            File.WriteAllText(path, json);
            _logger.LogInformation("Created default {Label} at {Path}", label, path);
        }

        try
        {
            var raw = File.ReadAllText(path);
            var config = JsonSerializer.Deserialize<ProcessFilterListConfig>(raw) ?? new ProcessFilterListConfig();

            return (config.processes ?? [])
                .Where(p => !string.IsNullOrWhiteSpace(p))
                .Select(EventFormatting.NormalizeProcessName)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to parse {Label}. Fallback to empty list.", label);
            return new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        }
    }

    private HashSet<string> GetWhitelist(EventFilterScope scope)
    {
        return scope == EventFilterScope.FocusChanged
            ? _focusChangedWhitelist
            : _processLifecycleWhitelist;
    }

    private HashSet<string> GetBlacklist(EventFilterScope scope)
    {
        return scope == EventFilterScope.FocusChanged
            ? _focusChangedBlacklist
            : _processLifecycleBlacklist;
    }

    private static bool TryResolveScope(string eventType, out EventFilterScope scope)
    {
        if (string.Equals(eventType, "focus_changed", StringComparison.Ordinal))
        {
            scope = EventFilterScope.FocusChanged;
            return true;
        }

        if (string.Equals(eventType, "process_start", StringComparison.Ordinal) ||
            string.Equals(eventType, "process_end", StringComparison.Ordinal))
        {
            scope = EventFilterScope.ProcessLifecycle;
            return true;
        }

        scope = default;
        return false;
    }

    private static string? NormalizeOrNull(string? exeName)
    {
        if (string.IsNullOrWhiteSpace(exeName))
        {
            return null;
        }

        return EventFormatting.NormalizeProcessName(exeName);
    }

    private static string GetFilterPolicyDirectory()
    {
        var appDataRoot = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        return Path.Combine(appDataRoot, "Ophanim", "Settings", "FilterPolicy");
    }

    private sealed class ProcessFilterListConfig
    {
        public List<string>? processes { get; init; }
    }
}
