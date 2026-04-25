using MonitoringDaemon.Abstractions;
using MonitoringDaemon.Infrastructure;
using MonitoringDaemon;

var builder = Host.CreateApplicationBuilder(args);

builder.Services
	.AddOptions<MonitoringRuntimeOptions>()
	.Bind(builder.Configuration.GetSection(MonitoringRuntimeOptions.SectionName))
	.Validate(o => o.FlushIntervalSeconds > 0, "Monitoring:FlushIntervalSeconds must be greater than 0.")
	.Validate(o => o.HookStopTimeoutSeconds > 0, "Monitoring:HookStopTimeoutSeconds must be greater than 0.")
	.Validate(o => o.SessionMonitorStopTimeoutSeconds > 0, "Monitoring:SessionMonitorStopTimeoutSeconds must be greater than 0.")
	.Validate(o => o.ProcessMetadataCacheTtlSeconds > 0, "Monitoring:ProcessMetadataCacheTtlSeconds must be greater than 0.")
	.Validate(o => o.ProcessMetadataCacheCapacity > 0, "Monitoring:ProcessMetadataCacheCapacity must be greater than 0.")
	.Validate(o => o.WriteQueueCapacity > 0, "Monitoring:WriteQueueCapacity must be greater than 0.")
	.Validate(o => o.QueueDrainTimeoutMilliseconds >= 0, "Monitoring:QueueDrainTimeoutMilliseconds must be greater than or equal to 0.")
	.ValidateOnStart();

builder.Services.AddSingleton<IWindowNativeApi, WindowsNativeApi>();
builder.Services.AddSingleton<IWmiEventWatcherFactory, ManagementWmiEventWatcherFactory>();
builder.Services.AddSingleton<IProcessMetadataReader>(sp =>
{
	var api = sp.GetRequiredService<IWindowNativeApi>();
	var options = sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<MonitoringRuntimeOptions>>();
	return new ProcessMetadataReader(api, options.Value);
});

builder.Services.AddSingleton<IMonitorEventSink, NdjsonEventSink>();
builder.Services.AddSingleton<IEventFilterPolicy, AppDataEventFilterPolicy>();
builder.Services.AddSingleton<IMonitorEventSource, ProcessWmiEventSource>();
builder.Services.AddSingleton<IMonitorEventSource, ForegroundWindowFocusEventSource>();
builder.Services.AddSingleton<SessionEndMonitor>();
builder.Services.AddHostedService<Worker>();

var host = builder.Build();
host.Run();
