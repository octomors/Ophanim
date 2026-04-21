using System.Text.Json;
using System.Text.Json.Serialization;
using MonitoringDaemon.Abstractions;
using MonitoringDaemon.Models;

namespace MonitoringDaemon.Infrastructure;

/// <summary>
/// Appends monitoring events to daily NDJSON files in AppData.
/// </summary>
internal sealed class NdjsonEventSink : IMonitorEventSink
{
    private readonly ILogger<NdjsonEventSink> _logger;
    private readonly object _syncLock = new();
    private readonly JsonSerializerOptions _jsonOptions = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private FileStream? _stream;
    private StreamWriter? _writer;
    private PeriodicTimer? _flushTimer;
    private Task? _flushTask;
    private CancellationTokenSource? _flushCts;
    private bool _disposed;

    public NdjsonEventSink(ILogger<NdjsonEventSink> logger)
    {
        _logger = logger;
    }

    /// <inheritdoc />
    public void Start()
    {
        InitializeWriter();
        RegisterProcessExitFlush();
        StartFlushLoop();
    }

    /// <inheritdoc />
    public void Append(EventPayload evt)
    {
        var payload = JsonSerializer.Serialize(evt, _jsonOptions);

        lock (_syncLock)
        {
            _writer?.WriteLine(payload);
        }
    }

    /// <inheritdoc />
    public void FlushToDisk()
    {
        lock (_syncLock)
        {
            if (_writer is null || _stream is null)
            {
                return;
            }

            _writer.Flush();
            _stream.Flush(flushToDisk: true);
        }
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        StopFlushLoop();

        lock (_syncLock)
        {
            _writer?.Flush();
            _stream?.Flush(flushToDisk: true);
            _writer?.Dispose();
            _stream?.Dispose();
            _writer = null;
            _stream = null;
        }

        _flushTimer?.Dispose();
        _flushCts?.Dispose();
    }

    private void InitializeWriter()
    {
        var appDataRoot = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var appFolder = Path.Combine(appDataRoot, "Ophanim");
        var dayLogsFolder = Path.Combine(appFolder, "DayLogs");
        Directory.CreateDirectory(dayLogsFolder);

        var fileName = $"{DateTimeOffset.Now:yyyy-MM-dd}.ndjson";
        var filePath = Path.Combine(dayLogsFolder, fileName);

        _stream = new FileStream(
            filePath,
            FileMode.Append,
            FileAccess.Write,
            FileShare.Read,
            bufferSize: 16 * 1024,
            FileOptions.WriteThrough);

        _writer = new StreamWriter(_stream)
        {
            AutoFlush = true
        };

        _logger.LogInformation("NDJSON logging initialized at {Path}", filePath);
    }

    private void RegisterProcessExitFlush()
    {
        AppDomain.CurrentDomain.ProcessExit += (_, _) => FlushToDisk();
    }

    private void StartFlushLoop()
    {
        _flushCts = new CancellationTokenSource();
        _flushTimer = new PeriodicTimer(TimeSpan.FromSeconds(30));

        _flushTask = Task.Run(async () =>
        {
            try
            {
                while (await _flushTimer.WaitForNextTickAsync(_flushCts.Token))
                {
                    FlushToDisk();
                }
            }
            catch (OperationCanceledException)
            {
                // Expected at shutdown.
            }
        }, _flushCts.Token);
    }

    private void StopFlushLoop()
    {
        if (_flushCts is null)
        {
            return;
        }

        _flushCts.Cancel();

        try
        {
            _flushTask?.GetAwaiter().GetResult();
        }
        catch (OperationCanceledException)
        {
            // Expected at shutdown.
        }
    }
}
