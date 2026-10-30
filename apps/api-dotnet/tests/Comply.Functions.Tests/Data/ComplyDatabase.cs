using Microsoft.EntityFrameworkCore;

namespace Comply.Functions.Data;

/// <summary>
/// Wraps the optional <see cref="IDbContextFactory{TContext}"/> used by the test adapter so a
/// missing store reports a clear 503 instead of resolving a missing dependency.
/// </summary>
public sealed class ComplyDatabase(IDbContextFactory<ComplyDbContext>? factory)
{
    public bool IsConfigured => factory is not null;

    public IDbContextFactory<ComplyDbContext> Factory =>
        factory ?? throw new InvalidOperationException(
            "The test store is not configured. Set COMPLY_COSMOS_CONNECTION for the Functions host.");
}
