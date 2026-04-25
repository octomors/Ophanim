using MonitoringDaemon.Infrastructure;
using System.Text;

namespace MonitoringDaemon.Abstractions;

/// <summary>
/// Abstraction over user32/kernel32 calls used by foreground monitoring.
/// </summary>
internal interface IWindowNativeApi
{
    uint GetCurrentThreadId();

    IntPtr SetWinEventHook(
        uint eventMin,
        uint eventMax,
        IntPtr hmodWinEventProc,
        WinEventCallback callback,
        uint idProcess,
        uint idThread,
        uint dwFlags);

    bool UnhookWinEvent(IntPtr hWinEventHook);

    uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    sbyte GetMessage(out WindowMessage lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

    bool TranslateMessage(ref WindowMessage lpMsg);

    IntPtr DispatchMessage(ref WindowMessage lpmsg);

    bool PostThreadMessage(uint idThread, uint msg, IntPtr wParam, IntPtr lParam);

    int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    bool IsWindowVisible(IntPtr hWnd);
}
