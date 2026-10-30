using Comply.Functions.Agent;
using Comply.Functions.Api;
using Comply.Functions.Auth;
using Comply.Functions.Data;
using Comply.Functions.Ingest;
using Comply.Functions.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

using var startupLoggerFactory = LoggerFactory.Create(builder => builder.AddConsole());
var startupLogger = startupLoggerFactory.CreateLogger("Comply.Functions.Startup");

// A missing secret is fatal in production; elsewhere an ephemeral one is generated.
var authSettings = AuthSettings.FromEnvironment(startupLogger);
var databaseSettings = DatabaseSettings.FromEnvironment();
var corsSettings = CorsSettings.FromEnvironment();

var host = new HostBuilder()
    .ConfigureFunctionsWebApplication()
    .ConfigureServices(services =>
    {
        services.AddSingleton(TimeProvider.System);
        services.AddSingleton(DeploymentSettings.FromEnvironment());
        services.AddSingleton(authSettings);
        services.AddSingleton(corsSettings);
        services.AddSingleton(databaseSettings);
        services.AddSingleton(new HttpClient { Timeout = TimeSpan.FromSeconds(20) });
        services.AddSingleton(_ => LibraryStore.CreateDefault());

        if (databaseSettings.IsConfigured)
        {
            services.AddDbContextFactory<ComplyDbContext>(options =>
                options.UseNpgsql(
                    databaseSettings.ConnectionString,
                    npgsql => npgsql.MigrationsAssembly(typeof(ComplyDbContext).Assembly.FullName)));
        }

        services.AddSingleton(provider => new ComplyDatabase(
            provider.GetService<IDbContextFactory<ComplyDbContext>>()));
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

await DatabaseStartup.InitializeAsync(host.Services, databaseSettings, startupLogger);

await host.RunAsync();
