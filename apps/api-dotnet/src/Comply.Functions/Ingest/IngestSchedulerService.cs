using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Comply.Functions.Ingest;

/// <summary>
/// Optional host wiring: resolves the coordinator at startup so the refresh timer is planned even
/// before the first API request. Register with
/// <c>services.AddHostedService&lt;IngestSchedulerService&gt;()</c>; calling
/// <see cref="IngestCoordinator.Start"/> from Program.cs instead is equivalent.
/// </summary>
public sealed class IngestSchedulerService : IHostedService
{
    private readonly IngestCoordinator _coordinator;
    private readonly ILogger<IngestSchedulerService>? _logger;

    public IngestSchedulerService(IngestCoordinator coordinator, ILogger<IngestSchedulerService>? logger = null)
    {
        _coordinator = coordinator;
        _logger = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        _coordinator.Start();

        if (!_coordinator.Enabled)
        {
            _logger?.LogInformation("Content refresh schedule is disabled.");
        }

        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
