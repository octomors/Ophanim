using System.Runtime.InteropServices;
using System.Text;
using MonitoringDaemon.Abstractions;

namespace MonitoringDaemon.Infrastructure;

internal sealed class WindowsNativeApi : IWindowNativeApi
{
    public uint GetCurrentThreadId() => NativeMethods.GetCurrentThreadId();

    public IntPtr SetWinEventHook(
        uint eventMin,
        uint eventMax,
        IntPtr hmodWinEventProc,
        WinEventCallback callback,
        uint idProcess,
        uint idThread,
        uint dwFlags)
        => NativeMethods.SetWinEventHook(eventMin, eventMax, hmodWinEventProc, callback, idProcess, idThread, dwFlags);

    public bool UnhookWinEvent(IntPtr hWinEventHook) => NativeMethods.UnhookWinEvent(hWinEventHook);

    public uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId) => NativeMethods.GetWindowThreadProcessId(hWnd, out processId);

    public sbyte GetMessage(out WindowMessage lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax)
        => NativeMethods.GetMessage(out lpMsg, hWnd, wMsgFilterMin, wMsgFilterMax);

    public bool TranslateMessage(ref WindowMessage lpMsg) => NativeMethods.TranslateMessage(ref lpMsg);

    public IntPtr DispatchMessage(ref WindowMessage lpmsg) => NativeMethods.DispatchMessage(ref lpmsg);

    public bool PostThreadMessage(uint idThread, uint msg, IntPtr wParam, IntPtr lParam)
        => NativeMethods.PostThreadMessage(idThread, msg, wParam, lParam);

    public int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount)
        => NativeMethods.GetClassName(hWnd, lpClassName, nMaxCount);

    public bool IsWindowVisible(IntPtr hWnd) => NativeMethods.IsWindowVisible(hWnd);

    private static class NativeMethods
    {
        [DllImport("user32.dll")]
        internal static extern IntPtr SetWinEventHook(
            uint eventMin,
            uint eventMax,
            IntPtr hmodWinEventProc,
            WinEventCallback lpfnWinEventProc,
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
        internal static extern sbyte GetMessage(out WindowMessage lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

        [DllImport("user32.dll")]
        internal static extern bool TranslateMessage([In] ref WindowMessage lpMsg);

        [DllImport("user32.dll")]
        internal static extern IntPtr DispatchMessage([In] ref WindowMessage lpmsg);

        [DllImport("user32.dll")]
        internal static extern bool PostThreadMessage(uint idThread, uint msg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        internal static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool IsWindowVisible(IntPtr hWnd);
    }
}
