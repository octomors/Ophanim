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
    private readonly ILogger<ForegroundWindowFocusEventSource> _logger;
    private readonly IEventFilterPolicy _eventFilterPolicy;
    private readonly int _currentSessionId = Process.GetCurrentProcess().SessionId;
    private IntPtr _winEventHook = IntPtr.Zero;
    private NativeMethods.WinEventDelegate? _callback;
    private Action<EventPayload>? _onEvent;
    private IntPtr _lastFocusedHwnd = IntPtr.Zero;
    private Thread? _hookThread;
    private uint _hookThreadId;
    private TaskCompletionSource<bool>? _hookReady;

    public ForegroundWindowFocusEventSource(
        ILogger<ForegroundWindowFocusEventSource> logger,
        IEventFilterPolicy eventFilterPolicy)
    {
        _logger = logger;
        _eventFilterPolicy = eventFilterPolicy;
    }

    /// <inheritdoc />
    public void Start(Action<EventPayload> onEvent)
    {
        _onEvent = onEvent;
        _hookReady = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        _hookThread = new Thread(() =>
        {
            _hookThreadId = NativeMethods.GetCurrentThreadId();
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
                _hookReady.TrySetException(new InvalidOperationException("Failed to install foreground event hook."));
                return;
            }

            _hookReady.TrySetResult(true);

            while (NativeMethods.GetMessage(out var msg, IntPtr.Zero, 0, 0) > 0)
            {
                NativeMethods.TranslateMessage(ref msg);
                NativeMethods.DispatchMessage(ref msg);
            }

            if (_winEventHook != IntPtr.Zero)
            {
                NativeMethods.UnhookWinEvent(_winEventHook);
                _winEventHook = IntPtr.Zero;
            }
        })
        {
            IsBackground = true,
            Name = "MonitoringDaemon.ForegroundHookLoop"
        };

        _hookThread.SetApartmentState(ApartmentState.STA);
        _hookThread.Start();
        _hookReady.Task.GetAwaiter().GetResult();
    }

    /// <inheritdoc />
    public void Stop()
    {
        if (_hookThreadId != 0)
        {
            NativeMethods.PostThreadMessage(_hookThreadId, NativeMethods.WM_QUIT, IntPtr.Zero, IntPtr.Zero);
        }

        if (_hookThread is not null && _hookThread.IsAlive)
        {
            _hookThread.Join(TimeSpan.FromSeconds(2));
        }

        _hookThread = null;
        _hookThreadId = 0;
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

        string exeName = "unknown.exe";
        string? friendlyName = null;
        bool windowVisible = false;
        string? windowTitle = null;

        lock (_syncLock)
        {
            if (_lastFocusedHwnd == hwnd)
            {
                return;
            }

            _lastFocusedHwnd = hwnd;
        }

        try
        {
            using var process = Process.GetProcessById((int)pid);
            process.Refresh();

            if (process.SessionId != _currentSessionId)
            {
                return;
            }

            var mainWindowHandle = process.MainWindowHandle;
            if (mainWindowHandle == IntPtr.Zero)
            {
                return;
            }

            windowVisible = ProcessNativeMethods.IsWindowVisible(mainWindowHandle);
            windowTitle = string.IsNullOrWhiteSpace(process.MainWindowTitle) ? null : process.MainWindowTitle;

            exeName = EventFormatting.NormalizeProcessName(process.ProcessName);
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
        catch
        {
            // Process can disappear between event and metadata read.
            return;
        }

        if (_eventFilterPolicy.IsBlacklistedProcess(exeName))
        {
            return;
        }

        var className = GetWindowClassName(hwnd);

        _onEvent?.Invoke(new EventPayload
        {
            event_type = "focus_changed",
            pid = (int)pid,
            exe_name = exeName,
            friendly_name = friendlyName,
            window_visible = windowVisible,
            window_title = windowTitle,
            class_name = className,
            time = EventFormatting.ToIsoUtcSeconds(DateTimeOffset.UtcNow)
        });
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
    internal const uint WM_QUIT = 0x0012;

    internal delegate void WinEventDelegate(
        IntPtr hWinEventHook,
        uint eventType,
        IntPtr hwnd,
        int idObject,
        int idChild,
        uint dwEventThread,
        uint dwmsEventTime);

    [StructLayout(LayoutKind.Sequential)]
    internal struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public UIntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public POINT pt;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct POINT
    {
        public int X;
        public int Y;
    }

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

    [DllImport("kernel32.dll")]
    internal static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    internal static extern sbyte GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

    [DllImport("user32.dll")]
    internal static extern bool TranslateMessage([In] ref MSG lpMsg);

    [DllImport("user32.dll")]
    internal static extern IntPtr DispatchMessage([In] ref MSG lpmsg);

    [DllImport("user32.dll")]
    internal static extern bool PostThreadMessage(uint idThread, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    internal static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    internal static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    internal static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
}
