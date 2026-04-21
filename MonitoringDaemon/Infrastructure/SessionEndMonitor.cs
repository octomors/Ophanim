using System.Runtime.InteropServices;

namespace MonitoringDaemon.Infrastructure;

/// <summary>
/// Listens for WM_ENDSESSION and invokes a callback for graceful flush.
/// </summary>
internal sealed class SessionEndMonitor : IDisposable
{
    private Thread? _thread;
    private uint _threadId;
    private TaskCompletionSource<bool>? _ready;
    private SessionNativeMethods.WndProcDelegate? _wndProc;
    private Action? _onEndSession;

    /// <summary>
    /// Starts session-end monitoring.
    /// </summary>
    public void Start(Action onEndSession)
    {
        _onEndSession = onEndSession;
        _ready = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);

        _thread = new Thread(() =>
        {
            _threadId = SessionNativeMethods.GetCurrentThreadId();
            var className = $"MonitoringDaemonSessionWindow_{Guid.NewGuid():N}";

            _wndProc = WindowProc;
            var wc = new SessionNativeMethods.WNDCLASS
            {
                lpfnWndProc = _wndProc,
                lpszClassName = className
            };

            var classAtom = SessionNativeMethods.RegisterClass(ref wc);
            if (classAtom == 0)
            {
                _ready?.TrySetException(new InvalidOperationException("RegisterClass failed for session window."));
                return;
            }

            var handle = SessionNativeMethods.CreateWindowEx(
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

            if (handle == IntPtr.Zero)
            {
                _ready?.TrySetException(new InvalidOperationException("CreateWindowEx failed for session window."));
                return;
            }

            _ready?.TrySetResult(true);

            while (SessionNativeMethods.GetMessage(out var msg, IntPtr.Zero, 0, 0) > 0)
            {
                SessionNativeMethods.TranslateMessage(ref msg);
                SessionNativeMethods.DispatchMessage(ref msg);
            }

            SessionNativeMethods.DestroyWindow(handle);
            SessionNativeMethods.UnregisterClass(className, IntPtr.Zero);
        })
        {
            IsBackground = true,
            Name = "MonitoringDaemon.SessionMessageLoop"
        };

        _thread.SetApartmentState(ApartmentState.STA);
        _thread.Start();
        _ready.Task.GetAwaiter().GetResult();
    }

    /// <summary>
    /// Stops session-end monitoring.
    /// </summary>
    public void Stop()
    {
        if (_threadId != 0)
        {
            SessionNativeMethods.PostThreadMessage(_threadId, SessionNativeMethods.WM_QUIT, IntPtr.Zero, IntPtr.Zero);
        }

        if (_thread is not null && _thread.IsAlive)
        {
            _thread.Join(TimeSpan.FromSeconds(2));
        }

        _thread = null;
        _threadId = 0;
        _onEndSession = null;
    }

    public void Dispose()
    {
        Stop();
    }

    private IntPtr WindowProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam)
    {
        if (msg == SessionNativeMethods.WM_ENDSESSION && wParam != IntPtr.Zero)
        {
            _onEndSession?.Invoke();
        }

        return SessionNativeMethods.DefWindowProc(hWnd, msg, wParam, lParam);
    }
}

internal static class SessionNativeMethods
{
    internal const uint WM_ENDSESSION = 0x0016;
    internal const uint WM_QUIT = 0x0012;

    internal delegate IntPtr WndProcDelegate(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

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
