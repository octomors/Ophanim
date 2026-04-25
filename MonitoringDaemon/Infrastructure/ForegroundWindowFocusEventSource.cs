using System.Diagnostics;
using System.Text;
using MonitoringDaemon.Abstractions;
using MonitoringDaemon.Models;
using Microsoft.Extensions.Options;

namespace MonitoringDaemon.Infrastructure;

/// <summary>
/// Emits window focus events from WinEvent foreground notifications.
/// </summary>
internal sealed class ForegroundWindowFocusEventSource : IMonitorEventSource
{
    private readonly object _syncLock = new();
    private readonly ILogger<ForegroundWindowFocusEventSource> _logger;
    private readonly IEventFilterPolicy _eventFilterPolicy;
    private readonly MonitoringRuntimeOptions _runtimeOptions;
    private readonly IWindowNativeApi _windowNativeApi;
    private readonly IProcessMetadataReader _processMetadataReader;
    private readonly int _currentSessionId = Process.GetCurrentProcess().SessionId;
    private IntPtr _winEventHook = IntPtr.Zero;
    private WinEventCallback? _callback;
    private Action<EventPayload>? _onEvent;
    private IntPtr _lastFocusedHwnd = IntPtr.Zero;
    private EventPayload? _lastEmittedFocusEvent;
    private Thread? _hookThread;
    private uint _hookThreadId;
    private TaskCompletionSource<bool>? _hookReady;

    public ForegroundWindowFocusEventSource(
        ILogger<ForegroundWindowFocusEventSource> logger,
        IEventFilterPolicy eventFilterPolicy,
        IOptions<MonitoringRuntimeOptions> runtimeOptions,
        IWindowNativeApi windowNativeApi,
        IProcessMetadataReader processMetadataReader)
    {
        _logger = logger;
        _eventFilterPolicy = eventFilterPolicy;
        _runtimeOptions = runtimeOptions.Value;
        _windowNativeApi = windowNativeApi;
        _processMetadataReader = processMetadataReader;
    }

    /// <inheritdoc />
    public void Start(Action<EventPayload> onEvent)
    {
        _onEvent = onEvent;
        _hookReady = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        _hookThread = new Thread(() =>
        {
            _hookThreadId = _windowNativeApi.GetCurrentThreadId();
            _callback = OnWinEvent;

            _winEventHook = _windowNativeApi.SetWinEventHook(
                WinApiConstants.EVENT_SYSTEM_FOREGROUND,
                WinApiConstants.EVENT_SYSTEM_FOREGROUND,
                IntPtr.Zero,
                _callback,
                0,
                0,
                WinApiConstants.WINEVENT_OUTOFCONTEXT | WinApiConstants.WINEVENT_SKIPOWNPROCESS);

            if (_winEventHook == IntPtr.Zero)
            {
                _hookReady.TrySetException(new InvalidOperationException("Failed to install foreground event hook."));
                return;
            }

            _hookReady.TrySetResult(true);

            while (_windowNativeApi.GetMessage(out var msg, IntPtr.Zero, 0, 0) > 0)
            {
                _windowNativeApi.TranslateMessage(ref msg);
                _windowNativeApi.DispatchMessage(ref msg);
            }

            if (_winEventHook != IntPtr.Zero)
            {
                _windowNativeApi.UnhookWinEvent(_winEventHook);
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
            _windowNativeApi.PostThreadMessage(_hookThreadId, WinApiConstants.WM_QUIT, IntPtr.Zero, IntPtr.Zero);
        }

        if (_hookThread is not null && _hookThread.IsAlive)
        {
            _hookThread.Join(TimeSpan.FromSeconds(_runtimeOptions.HookStopTimeoutSeconds));
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
        if (eventType != WinApiConstants.EVENT_SYSTEM_FOREGROUND || hwnd == IntPtr.Zero)
        {
            return;
        }

        if (_windowNativeApi.GetWindowThreadProcessId(hwnd, out var pid) == 0 || pid == 0)
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

        var snapshot = _processMetadataReader.Read((int)pid, null);
        var exeName = snapshot.ExeName;

        var isWhitelisted = _eventFilterPolicy.IsWhitelistedProcess(exeName, EventFilterScope.FocusChanged);
        if (!isWhitelisted)
        {
            if (_eventFilterPolicy.IsBlacklistedProcess(exeName, EventFilterScope.FocusChanged))
            {
                return;
            }

            if (snapshot.SessionId.HasValue && snapshot.SessionId.Value != _currentSessionId)
            {
                return;
            }

            if (snapshot.MainWindowHandle == IntPtr.Zero)
            {
                return;
            }
        }

        var className = GetWindowClassName(hwnd);

        var payload = new EventPayload
        {
            event_type = "focus_changed",
            pid = (int)pid,
            exe_name = exeName,
            friendly_name = snapshot.FriendlyName,
            window_visible = snapshot.WindowVisible,
            window_title = snapshot.WindowTitle,
            class_name = className,
            time = EventFormatting.ToIsoLocalSeconds(DateTimeOffset.Now)
        };

        lock (_syncLock)
        {
            if (IsDuplicateFocusEvent(_lastEmittedFocusEvent, payload))
            {
                return;
            }

            _lastEmittedFocusEvent = payload;
        }

        _onEvent?.Invoke(payload);
    }

    private string? GetWindowClassName(IntPtr hwnd)
    {
        var sb = new StringBuilder(256);
        var copied = _windowNativeApi.GetClassName(hwnd, sb, sb.Capacity);
        return copied > 0 ? sb.ToString() : null;
    }

    private static bool IsDuplicateFocusEvent(EventPayload? previous, EventPayload current)
    {
        if (previous is null)
        {
            return false;
        }

        return string.Equals(previous.event_type, current.event_type, StringComparison.Ordinal) &&
               previous.pid == current.pid &&
               string.Equals(previous.exe_name, current.exe_name, StringComparison.Ordinal) &&
               string.Equals(previous.friendly_name, current.friendly_name, StringComparison.Ordinal) &&
               previous.window_visible == current.window_visible &&
               string.Equals(previous.window_title, current.window_title, StringComparison.Ordinal) &&
               string.Equals(previous.class_name, current.class_name, StringComparison.Ordinal);
    }
}

internal static class WinApiConstants
{
    internal const uint EVENT_SYSTEM_FOREGROUND = 0x0003;
    internal const uint WINEVENT_OUTOFCONTEXT = 0x0000;
    internal const uint WINEVENT_SKIPOWNPROCESS = 0x0002;
    internal const uint WM_QUIT = 0x0012;
}
