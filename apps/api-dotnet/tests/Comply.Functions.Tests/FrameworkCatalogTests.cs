using Comply.Functions.Services;

namespace Comply.Functions.Tests;

public sealed class FrameworkCatalogTests
{
    [Fact]
    public void Lists_registry_frameworks_in_order()
    {
        var summary = FrameworkCatalog.Summarize(Fixtures.Library());

        Assert.Equal(["ai-act", "nis2", "iso27001", "soc2"], summary.Select(item => item.FrameworkId));
    }

    [Fact]
    public void Counts_requirements_per_source()
    {
        var aiAct = FrameworkCatalog.Summarize(Fixtures.Library())[0];
        var nis2 = FrameworkCatalog.Summarize(Fixtures.Library())[1];

        Assert.Equal(Fixtures.AiActSourceId, aiAct.SourceId);
        Assert.Equal(2, aiAct.Requirements);
        Assert.Equal(1, aiAct.Published);
        Assert.Equal(1, aiAct.Documents);
        Assert.Equal(Fixtures.AiActFetchedAt, aiAct.LastFetchedAt);
        Assert.Equal("ai-act", aiAct.Connector);

        Assert.Equal(Fixtures.Nis2SourceId, nis2.SourceId);
        Assert.Equal(2, nis2.Requirements);
        Assert.Equal(1, nis2.Published);
        Assert.Equal(Fixtures.Nis2FetchedAt, nis2.LastFetchedAt);
    }

    [Fact]
    public void Reports_frameworks_without_content_as_empty()
    {
        var summary = FrameworkCatalog.Summarize(Fixtures.Library());

        foreach (var iso in summary.Where(item => item.FrameworkId is "iso27001" or "soc2"))
        {
            Assert.Null(iso.SourceId);
            Assert.Null(iso.IndexUrl);
            Assert.Null(iso.Connector);
            Assert.Null(iso.LastFetchedAt);
            Assert.Equal(0, iso.Requirements);
            Assert.Equal(0, iso.Published);
            Assert.Equal(0, iso.Documents);
        }
    }
}
