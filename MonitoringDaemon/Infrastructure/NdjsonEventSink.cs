using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Channels;
using MonitoringDaemon.Abstractions;
using MonitoringDaemon.Models;
using Microsoft.Extensions.Options;

namespace MonitoringDaemon.Infrastructure;

/// <summary>
/// Appends monitoring events to daily NDJSON files in AppData.
/// </summary>
internal sealed class NdjsonEventSink : IMonitorEventSink
{
    private readonly ILogger<NdjsonEventSink> _logger;
    private readonly TimeSpan _flushInterval;
    private readonly bool _enableSingleWriterQueue;
    private readonly int _writeQueueCapacity;
    private readonly int _queueDrainTimeoutMilliseconds;
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
    private Channel<string>? _writeQueue;
    private Task? _writeTask;
    private CancellationTokenSource? _writeCts;
    private long _enqueuedLines;
    private long _writtenLines;
    private bool _disposed;

    public NdjsonEventSink(ILogger<NdjsonEventSink> logger, IOptions<MonitoringRuntimeOptions> runtimeOptions)
    {
        _logger = logger;
        _flushInterval = TimeSpan.FromSeconds(runtimeOptions.Value.FlushIntervalSeconds);
        _enableSingleWriterQueue = runtimeOptions.Value.EnableSingleWriterQueue;
        _writeQueueCapacity = runtimeOptions.Value.WriteQueueCapacity;
        _queueDrainTimeoutMilliseconds = runtimeOptions.Value.QueueDrainTimeoutMilliseconds;
    }

    /// <inheritdoc />
    public void Start()
    {
        InitializeWriter();
        StartWriteLoop();
        RegisterProcessExitFlush();
        StartFlushLoop();
    }

    /// <inheritdoc />
    public void Append(EventPayload evt)
    {
        var payload = JsonSerializer.Serialize(evt, _jsonOptions);

        if (_enableSingleWriterQueue && _writeQueue is not null)
        {
            if (_writeQueue.Writer.TryWrite(payload))
            {
                Interlocked.Increment(ref _enqueuedLines);
                return;
            }

            try
            {
                _writeQueue.Writer.WriteAsync(payload).AsTask().GetAwaiter().GetResult();
                Interlocked.Increment(ref _enqueuedLines);
                return;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to enqueue payload for writer queue; falling back to direct write.");
            }
        }

        lock (_syncLock)
        {
            _writer?.WriteLine(payload);
            Interlocked.Increment(ref _writtenLines);
        }
    }

    /// <inheritdoc />
    public void FlushToDisk()
    {
        WaitForQueueDrain();

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
        StopWriteLoop();

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
        _writeCts?.Dispose();
    }

    private void InitializeWriter()
    {
        var appDataRoot = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var appFolder = Path.Combine(appDataRoot, "Ophanim");
        var dayLogsFolder = Path.Combine(appFolder, "DayLogs");
        Directory.CreateDirectory(dayLogsFolder);

        var fileName = $"{DateTimeOffset.Now:yyyy-MM-dd}.ndjson";
        var primaryPath = Path.Combine(dayLogsFolder, fileName);
        var filePath = primaryPath;

        try
        {
            _stream = OpenWriteStream(primaryPath);
        }
        catch (IOException ex)
        {
            // Another process can keep today's file open. Fall back to a per-process file.
            filePath = Path.Combine(dayLogsFolder, $"{DateTimeOffset.Now:yyyy-MM-dd}.{Environment.ProcessId}.ndjson");
            _stream = OpenWriteStream(filePath);
            _logger.LogWarning(ex, "Primary log file is locked, using fallback file {Path}", filePath);
        }

        _writer = new StreamWriter(_stream)
        {
            AutoFlush = true
        };

        _logger.LogInformation("NDJSON logging initialized at {Path}", filePath);
    }

    private static FileStream OpenWriteStream(string filePath)
    {
        return new FileStream(
            filePath,
            FileMode.Append,
            FileAccess.Write,
            FileShare.Read,
            bufferSize: 16 * 1024,
            FileOptions.WriteThrough);
    }

    private void RegisterProcessExitFlush()
    {
        AppDomain.CurrentDomain.ProcessExit += (_, _) =>
        {
            try
            {
                FlushToDisk();
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to flush NDJSON sink on ProcessExit.");
            }
        };
    }

    private void StartWriteLoop()
    {
        if (!_enableSingleWriterQueue)
        {
            return;
        }

        _writeQueue = Channel.CreateBounded<string>(new BoundedChannelOptions(_writeQueueCapacity)
        {
            SingleReader = true,
            SingleWriter = false,
            FullMode = BoundedChannelFullMode.Wait
        });

        _writeCts = new CancellationTokenSource();
        _writeTask = Task.Run(async () =>
        {
            try
            {
                while (await _writeQueue.Reader.WaitToReadAsync(_writeCts.Token))
                {
                    while (_writeQueue.Reader.TryRead(out var payload))
                    {
                        lock (_syncLock)
                        {
                            _writer?.WriteLine(payload);
                        }

                        Interlocked.Increment(ref _writtenLines);
                    }
                }
            }
            catch (OperationCanceledException)
            {
                // Expected at shutdown.
            }
            catch (ObjectDisposedException)
            {
                // Expected when channel/token sources are being torn down.
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Single-writer queue loop failed.");
            }
        }, _writeCts.Token);
    }

    private void StartFlushLoop()
    {
        _flushCts = new CancellationTokenSource();
        _flushTimer = new PeriodicTimer(_flushInterval);

        _flushTask = Task.Run(async () =>
        {
            try
            {
                while (await _flushTimer.WaitForNextTickAsync(_flushCts.Token))
                {
                    try
                    {
                        FlushToDisk();
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "Periodic flush failed; keeping flush loop alive.");
                    }
                }
            }
            catch (OperationCanceledException)
            {
                // Expected at shutdown.
            }
            catch (ObjectDisposedException)
            {
                // Expected when timer is disposed during shutdown.
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

    private void StopWriteLoop()
    {
        if (!_enableSingleWriterQueue)
        {
            return;
        }

        if (_writeQueue is not null)
        {
            _writeQueue.Writer.TryComplete();
        }

        _writeCts?.Cancel();

        try
        {
            _writeTask?.GetAwaiter().GetResult();
        }
        catch (OperationCanceledException)
        {
            // Expected at shutdown.
        }
    }

    private void WaitForQueueDrain()
    {
        if (!_enableSingleWriterQueue)
        {
            return;
        }

        var start = Environment.TickCount64;
        while (Interlocked.Read(ref _writtenLines) < Interlocked.Read(ref _enqueuedLines))
        {
            if (_queueDrainTimeoutMilliseconds == 0)
            {
                break;
            }

            var elapsed = Environment.TickCount64 - start;
            if (elapsed >= _queueDrainTimeoutMilliseconds)
            {
                _logger.LogWarning(
                    "Queue drain timed out before flush. Pending={Pending}",
                    Interlocked.Read(ref _enqueuedLines) - Interlocked.Read(ref _writtenLines));
                break;
            }

            Thread.Sleep(1);
        }
    }
}
