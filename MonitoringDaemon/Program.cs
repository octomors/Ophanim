using MonitoringDaemon.Abstractions;
using MonitoringDaemon.Infrastructure;
using MonitoringDaemon;

var builder = Host.CreateApplicationBuilder(args);

builder.Services.AddSingleton<IMonitorEventSink, NdjsonEventSink>();
builder.Services.AddSingleton<IEventFilterPolicy, AppDataEventFilterPolicy>();
builder.Services.AddSingleton<IMonitorEventSource, ProcessWmiEventSource>();
builder.Services.AddSingleton<IMonitorEventSource, ForegroundWindowFocusEventSource>();
builder.Services.AddSingleton<SessionEndMonitor>();
builder.Services.AddHostedService<Worker>();

var host = builder.Build();
host.Run();
