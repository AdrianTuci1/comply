using Comply.Functions.Agent;
using Comply.Functions.Api;
using Comply.Functions.Auth;
using Comply.Functions.Data;
using Comply.Functions.Ingest;
using Comply.Functions.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

using var startupLoggerFactory = LoggerFactory.Create(builder => builder.AddConsole());
var startupLogger = startupLoggerFactory.CreateLogger("Comply.Functions.Startup");

// A missing secret is fatal in production; elsewhere an ephemeral one is generated.
var authSettings = AuthSettings.FromEnvironment(startupLogger);
var cosmosSettings = CosmosSettings.FromEnvironment();
var corsSettings = CorsSettings.FromEnvironment();

// Containers are created before the host serves requests so the first login cannot race setup.
IComplyStore complyStore = cosmosSettings.IsConfigured
    ? await CosmosComplyStore.CreateAsync(cosmosSettings, startupLogger)
    : new UnconfiguredComplyStore();
if (!cosmosSettings.IsConfigured)
{
    startupLogger.LogWarning(
        "{Variable} is not set; persistence and /api/auth endpoints are disabled.",
        CosmosSettings.ConnectionVariable);
}

var host = new HostBuilder()
    .ConfigureFunctionsWebApplication()
    .ConfigureServices(services =>
    {
        services.AddSingleton(TimeProvider.System);
        services.AddSingleton(DeploymentSettings.FromEnvironment());
        services.AddSingleton(authSettings);
        services.AddSingleton(cosmosSettings);
        services.AddSingleton(corsSettings);
        services.AddSingleton(complyStore);
        services.AddSingleton(new HttpClient { Timeout = TimeSpan.FromSeconds(20) });
        services.AddSingleton(_ => LibraryStore.CreateDefault());

        services.AddSingleton<PasswordHasher>();
        services.AddSingleton(provider => new AuthTokenService(
            authSettings.Secret,
            provider.GetRequiredService<TimeProvider>()));
        services.AddSingleton<UserDirectory>();
        services.AddSingleton<AuthService>();
        services.AddSingleton<IReadOnlyList<OidcProvider>>(OidcProviderCatalog.FromEnvironment());
        services.AddSingleton<OidcService>();
        services.AddSingleton<AuthApi>();
        services.AddSingleton<McpKeyService>();
        services.AddSingleton<TenantContext>();
        services.AddSingleton<AgentService>();
        services.AddSingleton<AgentApi>();
        services.AddSingleton(provider => new IngestStore(
            provider.GetRequiredService<LibraryStore>(),
            provider.GetRequiredService<TimeProvider>()));
        services.AddSingleton<IIngestRunner>(_ => new IngestPipeline());
        services.AddSingleton(provider => new IngestCoordinator(
            provider.GetRequiredService<IIngestRunner>(),
            provider.GetRequiredService<IngestStore>(),
            provider.GetRequiredService<TimeProvider>(),
            IngestScheduleOptions.FromEnvironment(),
            provider.GetRequiredService<ILogger<IngestCoordinator>>()));
        services.AddHostedService<IngestSchedulerService>();
        services.AddSingleton<ContentApi>();
    })
    .Build();

await host.RunAsync();
