using System.Collections.Concurrent;
using System.Diagnostics;
using MonitoringDaemon.Abstractions;

namespace MonitoringDaemon.Infrastructure;

internal sealed class ProcessMetadataReader : IProcessMetadataReader
{
    private readonly IWindowNativeApi _windowNativeApi;
    private readonly TimeSpan _cacheTtl;
    private readonly int _cacheCapacity;
    private readonly ConcurrentDictionary<int, CachedMetadata> _metadataCache = new();

    public ProcessMetadataReader(IWindowNativeApi windowNativeApi, MonitoringRuntimeOptions runtimeOptions)
    {
        _windowNativeApi = windowNativeApi;
        _cacheTtl = TimeSpan.FromSeconds(runtimeOptions.ProcessMetadataCacheTtlSeconds);
        _cacheCapacity = runtimeOptions.ProcessMetadataCacheCapacity;
    }

    public ProcessMetadataSnapshot Read(int pid, string? fallbackProcessName)
    {
        var exeName = EventFormatting.NormalizeProcessName(fallbackProcessName);
        string? friendlyName = null;
        int? sessionId = null;
        var windowVisible = false;
        string? windowTitle = null;
        var mainWindowHandle = IntPtr.Zero;

        try
        {
            using var process = Process.GetProcessById(pid);
            process.Refresh();

            sessionId = process.SessionId;

            if (!string.IsNullOrWhiteSpace(process.ProcessName))
            {
                exeName = EventFormatting.NormalizeProcessName(process.ProcessName);
            }

            if (TryGetCachedMetadata(pid, out var cached))
            {
                exeName = cached.ExeName;
                friendlyName = cached.FriendlyName;
            }
            else
            {
                TryReadStaticMetadata(process, ref exeName, ref friendlyName);
                CacheMetadata(pid, exeName, friendlyName);
            }

            mainWindowHandle = process.MainWindowHandle;
            if (mainWindowHandle != IntPtr.Zero)
            {
                windowVisible = _windowNativeApi.IsWindowVisible(mainWindowHandle);
            }

            windowTitle = string.IsNullOrWhiteSpace(process.MainWindowTitle) ? null : process.MainWindowTitle;
        }
        catch
        {
            // Process can disappear between event and metadata read.
        }

        return new ProcessMetadataSnapshot(exeName, friendlyName, sessionId, windowVisible, windowTitle, mainWindowHandle);
    }

    private bool TryGetCachedMetadata(int pid, out CachedMetadata cached)
    {
        if (_metadataCache.TryGetValue(pid, out cached))
        {
            if (cached.ExpiresAtUtc >= DateTimeOffset.UtcNow)
            {
                return true;
            }

            _metadataCache.TryRemove(pid, out _);
        }

        cached = default;
        return false;
    }

    private void CacheMetadata(int pid, string exeName, string? friendlyName)
    {
        if (_metadataCache.Count >= _cacheCapacity)
        {
            var firstKey = _metadataCache.FirstOrDefault().Key;
            if (firstKey != 0)
            {
                _metadataCache.TryRemove(firstKey, out _);
            }
        }

        _metadataCache[pid] = new CachedMetadata(
            exeName,
            friendlyName,
            DateTimeOffset.UtcNow.Add(_cacheTtl));
    }

    private static void TryReadStaticMetadata(Process process, ref string exeName, ref string? friendlyName)
    {
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
    }

    private readonly record struct CachedMetadata(string ExeName, string? FriendlyName, DateTimeOffset ExpiresAtUtc);
}
