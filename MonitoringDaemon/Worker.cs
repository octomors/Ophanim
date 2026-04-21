using System.Diagnostics;
using System.Management;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace MonitoringDaemon;

public sealed class Worker : BackgroundService, IDisposable
{
    private readonly ILogger<Worker> _logger;
    private readonly object _stateLock = new();
    private readonly JsonSerializerOptions _jsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private FileStream? _logFileStream;
    private StreamWriter? _logWriter;
    private PeriodicTimer? _flushTimer;
    private Task? _flushTask;

    private ManagementEventWatcher? _processStartWatcher;
    private ManagementEventWatcher? _processStopWatcher;

    private IntPtr _winEventHook = IntPtr.Zero;
    private NativeMethods.WinEventDelegate? _winEventCallback;

    private Thread? _sessionThread;
    private uint _sessionThreadId;
    private IntPtr _sessionWindowHandle = IntPtr.Zero;
    private TaskCompletionSource<bool>? _sessionWindowReady;
    private NativeMethods.WndProcDelegate? _sessionWndProc;

    private string? _focusedProcessName;
    private DateTimeOffset? _focusedStartedAt;

    private bool _disposed;

    public Worker(ILogger<Worker> logger)
    {
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        InitializeLogging();
        RegisterProcessExitHandler();
        StartSessionMessageWindow();
        StartProcessWatchers();
        StartFocusHook();
        StartFlushLoop(stoppingToken);

        _logger.LogInformation("Monitoring daemon started.");

        try
        {
            await Task.Delay(Timeout.Infinite, stoppingToken);
        }
        catch (OperationCanceledException)
        {
            // Expected on graceful shutdown.
        }
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation("Monitoring daemon stopping.");
        FlushActiveFocusInterval();
        StopNativeHooksAndWatchers();
        await StopFlushLoopAsync();
        FlushAndCloseWriter(forceToDisk: true);

        await base.StopAsync(cancellationToken);
    }

    private void InitializeLogging()
    {
        var appDataRoot = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var appFolder = Path.Combine(appDataRoot, "Ophanim");
        var dayLogsFolder = Path.Combine(appFolder, "DayLogs");
        Directory.CreateDirectory(dayLogsFolder);

        var fileName = $"{DateTimeOffset.Now:yyyy-MM-dd}.ndjson";
        var filePath = Path.Combine(dayLogsFolder, fileName);

        _logFileStream = new FileStream(
            filePath,
            FileMode.Append,
            FileAccess.Write,
            FileShare.Read,
            bufferSize: 16 * 1024,
            FileOptions.WriteThrough);

        _logWriter = new StreamWriter(_logFileStream) { AutoFlush = true };

        _logger.LogInformation("NDJSON logging initialized at {Path}", filePath);
    }

    private void RegisterProcessExitHandler()
    {
        AppDomain.CurrentDomain.ProcessExit += (_, _) =>
        {
            FlushActiveFocusInterval();
            FlushAndCloseWriter(forceToDisk: true);
        };
    }

    private void StartFlushLoop(CancellationToken stoppingToken)
    {
        _flushTimer = new PeriodicTimer(TimeSpan.FromSeconds(30));
        _flushTask = Task.Run(async () =>
        {
            try
            {
                while (await _flushTimer.WaitForNextTickAsync(stoppingToken))
                {
                    FlushAndCloseWriter(forceToDisk: true, keepOpen: true);
                }
            }
            catch (OperationCanceledException)
            {
                // Expected on shutdown.
            }
        }, stoppingToken);
    }

    private async Task StopFlushLoopAsync()
    {
        if (_flushTimer is not null)
        {
            _flushTimer.Dispose();
            _flushTimer = null;
        }

        if (_flushTask is not null)
        {
            try
            {
                await _flushTask;
            }
            catch (OperationCanceledException)
            {
                // Expected on shutdown.
            }
            finally
            {
                _flushTask = null;
            }
        }
    }

    private void StartProcessWatchers()
    {
        _processStartWatcher = new ManagementEventWatcher(new WqlEventQuery("SELECT * FROM Win32_ProcessStartTrace"));
        _processStartWatcher.EventArrived += (_, e) =>
        {
            var processName = Convert.ToString(e.NewEvent?["ProcessName"]) ?? "unknown";
            var processId = Convert.ToInt32(e.NewEvent?["ProcessID"] ?? 0);
            AppendEvent(new
            {
                type = "process_start",
                process = processName,
                pid = processId,
                at = DateTimeOffset.UtcNow
            });
        };

        _processStopWatcher = new ManagementEventWatcher(new WqlEventQuery("SELECT * FROM Win32_ProcessStopTrace"));
        _processStopWatcher.EventArrived += (_, e) =>
        {
            var processName = Convert.ToString(e.NewEvent?["ProcessName"]) ?? "unknown";
            var processId = Convert.ToInt32(e.NewEvent?["ProcessID"] ?? 0);
            AppendEvent(new
            {
                type = "process_stop",
                process = processName,
                pid = processId,
                at = DateTimeOffset.UtcNow
            });
        };

        _processStartWatcher.Start();
        _processStopWatcher.Start();

        _logger.LogInformation("WMI process start/stop watchers are active.");
    }

    private void StartFocusHook()
    {
        _winEventCallback = OnWinEvent;
        _winEventHook = NativeMethods.SetWinEventHook(
            NativeMethods.EVENT_SYSTEM_FOREGROUND,
            NativeMethods.EVENT_SYSTEM_FOREGROUND,
            IntPtr.Zero,
            _winEventCallback,
            0,
            0,
            NativeMethods.WINEVENT_OUTOFCONTEXT | NativeMethods.WINEVENT_SKIPOWNPROCESS);

        if (_winEventHook == IntPtr.Zero)
        {
            throw new InvalidOperationException("Failed to install foreground window event hook.");
        }

        _logger.LogInformation("Foreground focus hook is active.");
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

        string processName;
        try
        {
            processName = Process.GetProcessById((int)pid).ProcessName + ".exe";
        }
        catch
        {
            processName = "unknown";
        }

        var now = DateTimeOffset.UtcNow;
        string? previousProcess;
        DateTimeOffset? previousStart;

        lock (_stateLock)
        {
            if (string.Equals(_focusedProcessName, processName, StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            previousProcess = _focusedProcessName;
            previousStart = _focusedStartedAt;
            _focusedProcessName = processName;
            _focusedStartedAt = now;
        }

        if (!string.IsNullOrWhiteSpace(previousProcess) && previousStart.HasValue)
        {
            AppendEvent(new
            {
                type = "focus",
                process = previousProcess,
                start = previousStart.Value,
                end = now
            });
        }
    }

    private void FlushActiveFocusInterval()
    {
        string? process;
        DateTimeOffset? started;
        var ended = DateTimeOffset.UtcNow;

        lock (_stateLock)
        {
            process = _focusedProcessName;
            started = _focusedStartedAt;
            _focusedProcessName = null;
            _focusedStartedAt = null;
        }

        if (!string.IsNullOrWhiteSpace(process) && started.HasValue)
        {
            AppendEvent(new
            {
                type = "focus",
                process,
                start = started.Value,
                end = ended
            });
        }
    }

    private void AppendEvent<T>(T evt)
    {
        var payload = JsonSerializer.Serialize(evt, _jsonOptions);

        lock (_stateLock)
        {
            if (_logWriter is null)
            {
                return;
            }

            _logWriter.WriteLine(payload);
        }
    }

    private void FlushAndCloseWriter(bool forceToDisk, bool keepOpen = false)
    {
        lock (_stateLock)
        {
            if (_logWriter is null || _logFileStream is null)
            {
                return;
            }

            _logWriter.Flush();
            if (forceToDisk)
            {
                _logFileStream.Flush(flushToDisk: true);
            }

            if (!keepOpen)
            {
                _logWriter.Dispose();
                _logFileStream.Dispose();
                _logWriter = null;
                _logFileStream = null;
            }
        }
    }

    private void StopNativeHooksAndWatchers()
    {
        if (_winEventHook != IntPtr.Zero)
        {
            NativeMethods.UnhookWinEvent(_winEventHook);
            _winEventHook = IntPtr.Zero;
        }

        if (_processStartWatcher is not null)
        {
            _processStartWatcher.Stop();
            _processStartWatcher.Dispose();
            _processStartWatcher = null;
        }

        if (_processStopWatcher is not null)
        {
            _processStopWatcher.Stop();
            _processStopWatcher.Dispose();
            _processStopWatcher = null;
        }

        StopSessionMessageWindow();
    }

    private void StartSessionMessageWindow()
    {
        _sessionWindowReady = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);

        _sessionThread = new Thread(() =>
        {
            _sessionThreadId = NativeMethods.GetCurrentThreadId();
            var className = $"MonitoringDaemonSessionWindow_{Guid.NewGuid():N}";

            _sessionWndProc = SessionWindowProc;
            var wc = new NativeMethods.WNDCLASS
            {
                lpfnWndProc = _sessionWndProc,
                lpszClassName = className
            };

            var classAtom = NativeMethods.RegisterClass(ref wc);
            if (classAtom == 0)
            {
                _sessionWindowReady.TrySetException(new InvalidOperationException("RegisterClass failed for session window."));
                return;
            }

            _sessionWindowHandle = NativeMethods.CreateWindowEx(
                0,
                className,
                "MonitoringDaemonSessionWindow",
                0,
                0,
                0,
                0,
                0,
                IntPtr.Zero,
                IntPtr.Zero,
                IntPtr.Zero,
                IntPtr.Zero);

            if (_sessionWindowHandle == IntPtr.Zero)
            {
                _sessionWindowReady.TrySetException(new InvalidOperationException("CreateWindowEx failed for session window."));
                return;
            }

            _sessionWindowReady.TrySetResult(true);

            while (NativeMethods.GetMessage(out var msg, IntPtr.Zero, 0, 0) > 0)
            {
                NativeMethods.TranslateMessage(ref msg);
                NativeMethods.DispatchMessage(ref msg);
            }

            NativeMethods.DestroyWindow(_sessionWindowHandle);
            _sessionWindowHandle = IntPtr.Zero;
            NativeMethods.UnregisterClass(className, IntPtr.Zero);
        })
        {
            IsBackground = true,
            Name = "MonitoringDaemon.SessionMessageLoop"
        };

        _sessionThread.SetApartmentState(ApartmentState.STA);
        _sessionThread.Start();

        _sessionWindowReady.Task.GetAwaiter().GetResult();
    }

    private void StopSessionMessageWindow()
    {
        if (_sessionThreadId != 0)
        {
            NativeMethods.PostThreadMessage(_sessionThreadId, NativeMethods.WM_QUIT, IntPtr.Zero, IntPtr.Zero);
        }

        if (_sessionThread is not null && _sessionThread.IsAlive)
        {
            _sessionThread.Join(TimeSpan.FromSeconds(2));
        }

        _sessionThread = null;
        _sessionThreadId = 0;
    }

    private IntPtr SessionWindowProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam)
    {
        if (msg == NativeMethods.WM_ENDSESSION && wParam != IntPtr.Zero)
        {
            FlushActiveFocusInterval();
            FlushAndCloseWriter(forceToDisk: true, keepOpen: true);
        }

        return NativeMethods.DefWindowProc(hWnd, msg, wParam, lParam);
    }

    public override void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        StopNativeHooksAndWatchers();
        FlushActiveFocusInterval();
        FlushAndCloseWriter(forceToDisk: true);
        _flushTimer?.Dispose();

        base.Dispose();
    }
}

internal static class NativeMethods
{
    internal const uint EVENT_SYSTEM_FOREGROUND = 0x0003;
    internal const uint WINEVENT_OUTOFCONTEXT = 0x0000;
    internal const uint WINEVENT_SKIPOWNPROCESS = 0x0002;
    internal const uint WM_ENDSESSION = 0x0016;
    internal const uint WM_QUIT = 0x0012;

    internal delegate IntPtr WndProcDelegate(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    internal delegate void WinEventDelegate(
        IntPtr hWinEventHook,
        uint eventType,
        IntPtr hwnd,
        int idObject,
        int idChild,
        uint dwEventThread,
        uint dwmsEventTime);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    internal struct WNDCLASS
    {
        public uint style;
        public WndProcDelegate lpfnWndProc;
        public int cbClsExtra;
        public int cbWndExtra;
        public IntPtr hInstance;
        public IntPtr hIcon;
        public IntPtr hCursor;
        public IntPtr hbrBackground;
        public string? lpszMenuName;
        public string lpszClassName;
    }

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

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    internal static extern ushort RegisterClass([In] ref WNDCLASS lpWndClass);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    internal static extern IntPtr CreateWindowEx(
        uint dwExStyle,
        string lpClassName,
        string lpWindowName,
        uint dwStyle,
        int x,
        int y,
        int nWidth,
        int nHeight,
        IntPtr hWndParent,
        IntPtr hMenu,
        IntPtr hInstance,
        IntPtr lpParam);

    [DllImport("user32.dll")]
    internal static extern sbyte GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

    [DllImport("user32.dll")]
    internal static extern bool TranslateMessage([In] ref MSG lpMsg);

    [DllImport("user32.dll")]
    internal static extern IntPtr DispatchMessage([In] ref MSG lpmsg);

    [DllImport("user32.dll")]
    internal static extern bool PostThreadMessage(uint idThread, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    internal static extern IntPtr DefWindowProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    internal static extern bool DestroyWindow(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    internal static extern bool UnregisterClass(string lpClassName, IntPtr hInstance);
}
