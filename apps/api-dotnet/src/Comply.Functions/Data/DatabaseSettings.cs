using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Npgsql;

namespace Comply.Functions.Data;

/// <summary>
/// Database configuration. <c>COMPLY_DB_CONNECTION</c> wins over <c>ConnectionStrings:Comply</c>
/// so container deployments can use a single variable.
/// </summary>
public sealed record DatabaseSettings(string? ConnectionString, bool Migrate)
{
    public const string LocalConnectionString =
        "Host=localhost;Database=comply;Username=comply;Password=comply";

    public bool IsConfigured => !string.IsNullOrWhiteSpace(ConnectionString);

    public static DatabaseSettings FromEnvironment() => Resolve(
        Environment.GetEnvironmentVariable("COMPLY_DB_CONNECTION"),
        Environment.GetEnvironmentVariable("ConnectionStrings:Comply"),
        Environment.GetEnvironmentVariable("COMPLY_DB_MIGRATE"));

    public static DatabaseSettings Resolve(string? complyConnection, string? connectionStringsComply, string? migrate)
    {
        var connection = FirstNonEmpty(complyConnection, connectionStringsComply);
        return new DatabaseSettings(connection, migrate?.Trim() != "0");
    }

    /// <summary>Host and database only, so logs never contain credentials.</summary>
    public string DescribeTarget()
    {
        if (!IsConfigured) return "not configured";
        try
        {
            var builder = new NpgsqlConnectionStringBuilder(ConnectionString);
            return $"{builder.Host}:{builder.Port}/{builder.Database}";
        }
        catch (Exception)
        {
            return "configured (unparsable connection string)";
        }
    }

    private static string? FirstNonEmpty(params string?[] values) =>
        values.Select(value => value?.Trim()).FirstOrDefault(value => !string.IsNullOrEmpty(value));
}

/// <summary>
/// Wraps the optional <see cref="IDbContextFactory{TContext}"/> so endpoints can report a clear
/// 503 instead of resolving a missing dependency when no database is configured.
/// </summary>
public sealed class ComplyDatabase(IDbContextFactory<ComplyDbContext>? factory)
{
    public bool IsConfigured => factory is not null;

    public IDbContextFactory<ComplyDbContext> Factory =>
        factory ?? throw new InvalidOperationException(
            "The Comply database is not configured. Set COMPLY_DB_CONNECTION or ConnectionStrings:Comply.");
}

public static class DatabaseStartup
{
    /// <summary>
    /// Applies pending migrations before the Functions host starts serving. A missing database
    /// is a hard failure: serving auth endpoints against a half-built schema is worse than failing.
    /// </summary>
    public static async Task InitializeAsync(
        IServiceProvider services,
        DatabaseSettings settings,
        ILogger logger,
        CancellationToken cancellationToken = default)
    {
        if (!settings.IsConfigured)
        {
            logger.LogWarning(
                "COMPLY_DB_CONNECTION is not set; persistence and /api/auth endpoints are disabled.");
            return;
        }

        if (!settings.Migrate)
        {
            logger.LogInformation("COMPLY_DB_MIGRATE=0; skipping database migrations.");
            return;
        }

        var database = services.GetService<ComplyDatabase>();
        if (database is null || !database.IsConfigured)
        {
            logger.LogWarning("No database context factory is registered; skipping migrations.");
            return;
        }

        logger.LogInformation("Applying Comply database migrations to {Target}.", settings.DescribeTarget());

        await using var context = await database.Factory.CreateDbContextAsync(cancellationToken);
        try
        {
            await context.Database.MigrateAsync(cancellationToken);
        }
        catch (Exception exception)
        {
            logger.LogCritical(
                exception,
                "The Comply database at {Target} is unreachable or the migration failed. "
                + "Check COMPLY_DB_CONNECTION and that PostgreSQL is running.",
                settings.DescribeTarget());
            throw new InvalidOperationException(
                $"Comply database migration failed for {settings.DescribeTarget()}. "
                + "Check COMPLY_DB_CONNECTION and that PostgreSQL is reachable.",
                exception);
        }
    }
}
