using System.Runtime.InteropServices;

namespace MonitoringDaemon.Infrastructure;

internal delegate void WinEventCallback(
    IntPtr hWinEventHook,
    uint eventType,
    IntPtr hwnd,
    int idObject,
    int idChild,
    uint dwEventThread,
    uint dwmsEventTime);

[StructLayout(LayoutKind.Sequential)]
internal struct WindowMessage
{
    public IntPtr hwnd;
    public uint message;
    public UIntPtr wParam;
    public IntPtr lParam;
    public uint time;
    public WindowPoint pt;
}

[StructLayout(LayoutKind.Sequential)]
internal struct WindowPoint
{
    public int X;
    public int Y;
}
