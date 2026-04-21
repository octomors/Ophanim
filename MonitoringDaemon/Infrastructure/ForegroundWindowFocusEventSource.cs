using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using MonitoringDaemon.Abstractions;
using MonitoringDaemon.Models;

namespace MonitoringDaemon.Infrastructure;

/// <summary>
/// Emits window focus events from WinEvent foreground notifications.
/// </summary>
internal sealed class ForegroundWindowFocusEventSource : IMonitorEventSource
{
    private readonly object _syncLock = new();
    private IntPtr _winEventHook = IntPtr.Zero;
    private NativeMethods.WinEventDelegate? _callback;
    private Action<EventPayload>? _onEvent;
    private IntPtr _lastFocusedHwnd = IntPtr.Zero;

    /// <inheritdoc />
    public void Start(Action<EventPayload> onEvent)
    {
        _onEvent = onEvent;
        _callback = OnWinEvent;

        _winEventHook = NativeMethods.SetWinEventHook(
            NativeMethods.EVENT_SYSTEM_FOREGROUND,
            NativeMethods.EVENT_SYSTEM_FOREGROUND,
            IntPtr.Zero,
            _callback,
            0,
            0,
            NativeMethods.WINEVENT_OUTOFCONTEXT | NativeMethods.WINEVENT_SKIPOWNPROCESS);

        if (_winEventHook == IntPtr.Zero)
        {
            throw new InvalidOperationException("Failed to install foreground event hook.");
        }
    }

    /// <inheritdoc />
    public void Stop()
    {
        if (_winEventHook != IntPtr.Zero)
        {
            NativeMethods.UnhookWinEvent(_winEventHook);
            _winEventHook = IntPtr.Zero;
        }

        _onEvent = null;
    }

    /// <inheritdoc />
    public void Dispose()
    {
        Stop();
    }

    private void OnWinEvent(
        IntPtr hWinEventHook,
        uint eventType,
        IntPtr hwnd,
        int idObject,
        int idChild,
        uint dwEventThread,
        uint dwmsEventTime)
    {
        if (eventType != NativeMethods.EVENT_SYSTEM_FOREGROUND || hwnd == IntPtr.Zero)
        {
            return;
        }

        if (NativeMethods.GetWindowThreadProcessId(hwnd, out var pid) == 0 || pid == 0)
        {
            return;
        }

        lock (_syncLock)
        {
            if (_lastFocusedHwnd == hwnd)
            {
                return;
            }

            _lastFocusedHwnd = hwnd;
        }

        string processName = "unknown.exe";
        try
        {
            processName = EventFormatting.NormalizeProcessName(Process.GetProcessById((int)pid).ProcessName);
        }
        catch
        {
            // Keep fallback value.
        }

        _onEvent?.Invoke(new EventPayload
        {
            t = "wf",
            a = EventFormatting.ToIsoUtcMs(DateTimeOffset.UtcNow),
            p = (int)pid,
            n = processName,
            w = GetWindowTitle(hwnd),
            k = GetWindowClassName(hwnd)
        });
    }

    private static string? GetWindowTitle(IntPtr hwnd)
    {
        var len = NativeMethods.GetWindowTextLength(hwnd);
        if (len <= 0)
        {
            return null;
        }

        var sb = new StringBuilder(len + 1);
        var copied = NativeMethods.GetWindowText(hwnd, sb, sb.Capacity);
        return copied > 0 ? sb.ToString() : null;
    }

    private static string? GetWindowClassName(IntPtr hwnd)
    {
        var sb = new StringBuilder(256);
        var copied = NativeMethods.GetClassName(hwnd, sb, sb.Capacity);
        return copied > 0 ? sb.ToString() : null;
    }
}

internal static class NativeMethods
{
    internal const uint EVENT_SYSTEM_FOREGROUND = 0x0003;
    internal const uint WINEVENT_OUTOFCONTEXT = 0x0000;
    internal const uint WINEVENT_SKIPOWNPROCESS = 0x0002;

    internal delegate void WinEventDelegate(
        IntPtr hWinEventHook,
        uint eventType,
        IntPtr hwnd,
        int idObject,
        int idChild,
        uint dwEventThread,
        uint dwmsEventTime);

    [DllImport("user32.dll")]
    internal static extern IntPtr SetWinEventHook(
        uint eventMin,
        uint eventMax,
        IntPtr hmodWinEventProc,
        WinEventDelegate lpfnWinEventProc,
        uint idProcess,
        uint idThread,
        uint dwFlags);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool UnhookWinEvent(IntPtr hWinEventHook);

    [DllImport("user32.dll")]
    internal static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    internal static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    internal static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    internal static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
}
