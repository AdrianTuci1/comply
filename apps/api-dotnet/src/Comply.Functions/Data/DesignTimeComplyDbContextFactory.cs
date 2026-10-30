using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Comply.Functions.Data;

/// <summary>
/// Used by <c>dotnet ef</c>. The Functions entry point is a host bootstrap, not a console app the
/// tooling can run, so migrations need an explicit factory.
/// </summary>
public sealed class DesignTimeComplyDbContextFactory : IDesignTimeDbContextFactory<ComplyDbContext>
{
    public ComplyDbContext CreateDbContext(string[] args)
    {
        var connection = Environment.GetEnvironmentVariable("COMPLY_DB_CONNECTION");
        if (string.IsNullOrWhiteSpace(connection))
        {
            connection = Environment.GetEnvironmentVariable("ConnectionStrings:Comply");
        }

        var options = new DbContextOptionsBuilder<ComplyDbContext>()
            .UseNpgsql(string.IsNullOrWhiteSpace(connection) ? DatabaseSettings.LocalConnectionString : connection)
            .Options;

        return new ComplyDbContext(options);
    }
}
