using Comply.Functions.Services;

namespace Comply.Functions.Tests;

/// <summary>
/// Exercises the repository seed, which is the fallback a fresh deployment relies on.
/// </summary>
public sealed class SeedContentTests
{
    [Fact]
    public async Task Loads_the_repository_seed_when_the_data_directory_is_absent()
    {
        var store = new LibraryStore(
            dataDirectory: Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N")),
            seedDirectory: ResolveSeedDirectory());

        var library = await store.GetAsync();

        Assert.Equal(1, library.Version);
        Assert.NotEmpty(library.Sources);
        Assert.NotEmpty(library.Requirements);
        Assert.All(library.Requirements, requirement =>
        {
            Assert.False(string.IsNullOrWhiteSpace(requirement.Id));
            Assert.Contains(library.Sources, source => source.Id == requirement.SourceId);
        });
    }

    [Fact]
    public async Task Summarizes_every_registry_framework_from_the_seed()
    {
        var store = new LibraryStore(
            dataDirectory: Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N")),
            seedDirectory: ResolveSeedDirectory());

        var summary = FrameworkCatalog.Summarize(await store.GetAsync());

        Assert.Equal(["ai-act", "nis2", "iso27001", "soc2"], summary.Select(framework => framework.FrameworkId));
        Assert.True(summary[0].Requirements > 0, "The AI Act seed should contain requirements.");
        Assert.True(summary[1].Requirements > 0, "The NIS2 seed should contain requirements.");
        Assert.Equal(1, summary[0].Documents);
        Assert.Equal(1, summary[1].Documents);
    }

    private static string ResolveSeedDirectory() => LibraryStore.CreateDefault().SeedDirectory;
}
