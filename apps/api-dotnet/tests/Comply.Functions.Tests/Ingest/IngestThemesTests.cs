using Comply.Functions.Ingest;

namespace Comply.Functions.Tests.Ingest;

public sealed class IngestThemesTests
{
    [Theory]
    [InlineData("Cybersecurity risk-management measures", "organizational")]
    [InlineData("Incident handling", "procedures")]
    [InlineData("business continuity and crisis management", "procedures")]
    [InlineData("network and information system security", "infrastructure")]
    [InlineData("vulnerability disclosure and patch management", "infrastructure")]
    [InlineData("acquisition and development of products", "product")]
    [InlineData("processing of personal data", "data_privacy")]
    [InlineData("something unrelated", "organizational")]
    public void Nis2_theme_follows_rule_order(string text, string expected)
    {
        Assert.Equal(expected, IngestThemes.Nis2(text));
    }

    [Fact]
    public void Nis2_theme_prefers_the_earlier_rule()
    {
        Assert.Equal("organizational", IngestThemes.Nis2("risk and incident reporting"));
    }

    [Theory]
    [InlineData("13", "product")]
    [InlineData("8", "product")]
    [InlineData("15", "product")]
    [InlineData("28", "procedures")]
    [InlineData("50", "data_privacy")]
    [InlineData("4", "organizational")]
    [InlineData("13a", "product")]
    [InlineData("111", "organizational")]
    [InlineData("not-a-number", "organizational")]
    public void Ai_act_theme_uses_article_ranges(string number, string expected)
    {
        Assert.Equal(expected, IngestThemes.AiAct(number));
    }
}

public sealed class Nis2DiscoveryTests
{
    private const string Index = """
        <html><body>
        <a href="NIS_2_Directive_Article_2.html">Article 2 &ndash; Scope</a>
        <a href="https://www.nis-2-directive.com/NIS_2_Directive_Article_1.html">Article 1</a>
        <a href="NIS_2_Directive_Article_2.html">Duplicate</a>
        <a href="/other.html">Other</a>
        </body></html>
        """;

    [Fact]
    public void Deduplicates_and_sorts_by_article_number()
    {
        var articles = Nis2Ingest.DiscoverArticles(Index);

        Assert.Equal(["1", "2"], articles.Select(article => article.Number));
        Assert.Equal(
            "https://www.nis-2-directive.com/NIS_2_Directive_Article_1.html",
            articles[0].Url);
        Assert.Equal("Article 1", articles[0].Title);
        Assert.Equal("Article 2 \u2013 Scope", articles[1].Title);
    }

    [Fact]
    public void Ignores_unrelated_links_and_empty_indexes()
    {
        Assert.Empty(Nis2Ingest.DiscoverArticles("<a href=\"/other.html\">Other</a>"));
    }
}

public sealed class AiActDiscoveryTests
{
    private const string Index = """
        <html><body>
        <a href="/article/13/">Article 13</a>
        <a href="https://artificialintelligenceact.eu/article/9">Article 9</a>
        <a href="/article/13">Duplicate 13</a>
        <a href="/article/13a/">Article 13a</a>
        <a href="/article/x">Not an article</a>
        </body></html>
        """;

    [Fact]
    public void Deduplicates_and_sorts_numerically_then_by_suffix()
    {
        var articles = AiActIngest.DiscoverArticles(Index);

        Assert.Equal(["9", "13", "13a"], articles.Select(article => article.Number));
        Assert.Equal("https://artificialintelligenceact.eu/article/13/", articles[1].Url);
        Assert.Equal("https://artificialintelligenceact.eu/article/13a/", articles[2].Url);
    }

    [Fact]
    public void Ignores_pages_without_article_links()
    {
        Assert.Empty(AiActIngest.DiscoverArticles("<a href=\"/article\">index</a>"));
    }
}
