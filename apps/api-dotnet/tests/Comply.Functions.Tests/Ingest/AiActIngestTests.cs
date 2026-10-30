using Comply.Functions.Ingest;

namespace Comply.Functions.Tests.Ingest;

public sealed class AiActParserTests
{
    // Same fixture as apps/api-node/test/parsers.test.mjs.
    private const string Article = """
        <section id="article-13">
          <h2 class="item-heading">
            <span class="heading-label">Article 13</span>
            <span class="heading-title">: Transparency and Provision of Information to Deployers</span>
          </h2>
          <div class="para depth-0" id="p-article-13-1">
            <span class="para-label">1.</span>
            <span class="para-text">Systems shall be transparent to <span class="term-ref">deployers<span class="term-tip"><span class="term-tip-body">definition noise</span></span></span>.</span>
          </div>
          <div class="para depth-0 om-amended" id="p-article-13-2">
            <span class="para-label">2.</span>
            <span class="para-text">Systems shall be accompanied by instructions for use.</span>
          </div>
          <div class="para depth-1" id="p-article-13-2.a">
            <span class="para-label">(a)</span>
            <span class="para-text">the identity and contact details of the provider;</span>
          </div>
          <div class="para depth-1" id="p-article-13-2.b">
            <span class="para-label">(b)</span>
            <span class="para-text">the characteristics and limitations of performance.</span>
          </div>
        </section>
        """;

    private static ParsedPage Parse(string html, string number = "13") =>
        AiActIngest.ParseArticle(html, number, $"https://example.test/{number}");

    [Fact]
    public void Extracts_paragraphs_and_lettered_sub_items()
    {
        var page = Parse(Article);

        Assert.Equal(
            ["Art. 13(1)", "Art. 13(2)", "Art. 13(2)(a)", "Art. 13(2)(b)"],
            page.Requirements.Select(requirement => requirement.Ref));
    }

    [Fact]
    public void Reads_the_title_without_the_article_prefix()
    {
        Assert.Equal(
            "Transparency and Provision of Information to Deployers",
            Parse(Article).Title);
    }

    [Fact]
    public void Removes_term_tip_definition_noise()
    {
        var page = Parse(Article);

        Assert.DoesNotContain("definition noise", page.Text);
        Assert.Equal(
            "Systems shall be transparent to deployers.",
            page.Requirements[0].Text);
    }

    [Fact]
    public void Uses_the_article_range_theme()
    {
        Assert.All(Parse(Article).Requirements, requirement => Assert.Equal("product", requirement.Theme));
    }

    [Fact]
    public void Ignores_blocks_deeper_than_one_level_for_requirements()
    {
        const string html = """
            <h2 class="item-heading"><span class="heading-title">: Subject matter</span></h2>
            <div class="para depth-0" id="p1"><span class="para-label">1.</span><span class="para-text">First paragraph text that is long enough.</span></div>
            <div class="para depth-2" id="p2"><span class="para-label">(i)</span><span class="para-text">Deep block ignored for requirements but kept in the text.</span></div>
            """;

        var page = Parse(html, "1");

        Assert.Equal(["Art. 1(1)"], page.Requirements.Select(requirement => requirement.Ref));
        Assert.Contains("Deep block ignored", page.Text);
    }

    [Fact]
    public void Skips_blocks_without_a_depth_marker()
    {
        const string html = """
            <h2 class="item-heading"><span class="heading-title">: Subject matter</span></h2>
            <div class="para" id="p1"><span class="para-label">1.</span><span class="para-text">Skipped block that has no depth class.</span></div>
            <div class="para depth-0" id="p2"><span class="para-label">1.</span><span class="para-text">Kept paragraph text that is long enough.</span></div>
            """;

        var page = Parse(html, "1");

        Assert.DoesNotContain("Skipped block", page.Text);
        Assert.Equal(["Art. 1(1)"], page.Requirements.Select(requirement => requirement.Ref));
    }

    [Fact]
    public void Keeps_only_the_first_block_per_lettered_reference()
    {
        const string html = """
            <h2 class="item-heading"><span class="heading-title">: Duplicates</span></h2>
            <div class="para depth-0" id="a"><span class="para-label">1.</span><span class="para-text">Parent paragraph text for the article.</span></div>
            <div class="para depth-1" id="b"><span class="para-label">(a)</span><span class="para-text">First letter block text.</span></div>
            <div class="para depth-1" id="c"><span class="para-label">(A)</span><span class="para-text">Second letter block text.</span></div>
            """;

        var page = Parse(html, "1");

        Assert.Equal(2, page.Requirements.Count);
        Assert.Equal("First letter block text.", page.Requirements[1].Text);
    }

    [Fact]
    public void Accepts_roman_numeral_labels_and_skips_unrecognised_ones()
    {
        const string html = """
            <h2 class="item-heading"><span class="heading-title">: Labels</span></h2>
            <div class="para depth-0" id="a"><span class="para-label">1.</span><span class="para-text">Parent paragraph text for the article.</span></div>
            <div class="para depth-1" id="b"><span class="para-label">(ii)</span><span class="para-text">Roman numeral label becomes its own reference.</span></div>
            <div class="para depth-1" id="c"><span class="para-label">no-label</span><span class="para-text">Unlabelled block that must be skipped.</span></div>
            """;

        var page = Parse(html, "1");

        Assert.Equal(["Art. 1(1)", "Art. 1(1)(ii)"], page.Requirements.Select(requirement => requirement.Ref));
        Assert.Contains("Roman numeral label", page.Text);
        Assert.Contains("Unlabelled block", page.Text);
    }

    [Fact]
    public void Tracks_the_latest_numbered_parent_for_lettered_items()
    {
        const string html = """
            <h2 class="item-heading"><span class="heading-title">: Parents</span></h2>
            <div class="para depth-0" id="a"><span class="para-label">1.</span><span class="para-text">First parent paragraph text here.</span></div>
            <div class="para depth-1" id="b"><span class="para-label">(a)</span><span class="para-text">Under the first parent.</span></div>
            <div class="para depth-0" id="c"><span class="para-label">2.</span><span class="para-text">Second parent paragraph text here.</span></div>
            <div class="para depth-1" id="d"><span class="para-label">(b)</span><span class="para-text">Under the second parent.</span></div>
            """;

        var page = Parse(html, "1");

        Assert.Equal(
            ["Art. 1(1)", "Art. 1(1)(a)", "Art. 1(2)", "Art. 1(2)(b)"],
            page.Requirements.Select(requirement => requirement.Ref));
    }

    [Fact]
    public void Falls_back_to_the_whole_article_when_no_block_maps_to_a_reference()
    {
        const string html = """
            <h2 class="item-heading"><span class="heading-title">: Deep only</span></h2>
            <div class="para depth-3" id="p1"><span class="para-label">(i)</span><span class="para-text">Only a deep block with readable text.</span></div>
            """;

        var page = Parse(html, "4");

        var requirement = Assert.Single(page.Requirements);
        Assert.Equal("Art. 4", requirement.Ref);
        Assert.Equal("Deep only", requirement.Title);
        Assert.Equal(page.Text, requirement.Text);
    }

    [Fact]
    public void Falls_back_to_the_article_number_when_the_heading_has_no_title()
    {
        const string html = """
            <h2 class="item-heading"><span class="heading-label">Article 7</span><span class="heading-title">  </span></h2>
            <div class="para depth-0" id="p1"><span class="para-label">1.</span><span class="para-text">Readable paragraph text for the fallback title.</span></div>
            """;

        Assert.Equal("Article 7", Parse(html, "7").Title);
    }

    [Fact]
    public void Strips_an_article_prefix_inside_the_heading_title()
    {
        const string html = """
            <h2 class="item-heading"><span class="heading-title">Article 9: Risk management system</span></h2>
            <div class="para depth-0" id="p1"><span class="para-label">1.</span><span class="para-text">Readable paragraph text for the prefix test.</span></div>
            """;

        Assert.Equal("Risk management system", Parse(html, "9").Title);
    }

    [Fact]
    public void Throws_when_the_heading_is_missing()
    {
        var error = Assert.Throws<IngestException>(
            () => AiActIngest.ParseArticle("<p>no heading</p>", "13", "https://example.test/13"));

        Assert.Equal("Article 13 has no heading at https://example.test/13", error.Message);
    }

    [Fact]
    public void Throws_when_no_para_text_is_readable()
    {
        const string html = """
            <h2 class="item-heading"><span class="heading-title">: Empty</span></h2>
            <div class="para depth-0" id="p1"><span class="para-label">1.</span></div>
            """;

        var error = Assert.Throws<IngestException>(
            () => AiActIngest.ParseArticle(html, "13", "https://example.test/13"));

        Assert.Equal("Article 13 has no readable text at https://example.test/13", error.Message);
    }
}

public sealed class AiActIngestTests
{
    private const string Index = """
        <a href="/article/13/">Article 13</a>
        <a href="/article/9">Article 9</a>
        """;

    private const string Article9 = """
        <h2 class="item-heading"><span class="heading-title">: Scope</span></h2>
        <div class="para depth-0" id="p-9-1"><span class="para-label">1.</span><span class="para-text">Providers shall ensure that systems are safe.</span></div>
        """;

    private const string Article13 = """
        <h2 class="item-heading"><span class="heading-title">: Transparency</span></h2>
        <div class="para depth-0" id="p-13-1"><span class="para-label">1.</span><span class="para-text">Deployers shall receive clear instructions for use.</span></div>
        """;

    private static FakeTextFetcher Fetcher() => new(new Dictionary<string, string>
    {
        [AiActIngest.IndexUrl] = Index,
        ["https://artificialintelligenceact.eu/article/9/"] = Article9,
        ["https://artificialintelligenceact.eu/article/13/"] = Article13,
    });

    [Fact]
    public async Task Builds_the_document_from_every_discovered_article()
    {
        var result = await AiActIngest.IngestAsync(new IngestOptions
        {
            FetchedAt = IngestSamples.FetchedAt,
            Fetcher = Fetcher(),
        });

        Assert.Equal("doc-ai-act-2024-1689", result.Document.Id);
        Assert.Equal("src-ai-act-2024-1689", result.Document.SourceId);
        Assert.Equal("ai-act", result.Document.FrameworkId);
        Assert.Equal("Regulation (EU) 2024/1689 (AI Act)", result.Document.Title);
        Assert.Equal(AiActIngest.IndexUrl, result.Document.Url);
        Assert.Equal("https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng", result.Document.OfficialUrl);
        Assert.Equal(["Art. 9", "Art. 13"], result.Document.Pages.Select(page => page.Ref));
        Assert.Equal(["Scope", "Transparency"], result.Document.Pages.Select(page => page.Title));
    }

    [Fact]
    public async Task Hashes_the_joined_article_text()
    {
        var result = await AiActIngest.IngestAsync(new IngestOptions
        {
            FetchedAt = IngestSamples.FetchedAt,
            Fetcher = Fetcher(),
        });

        var expectedText =
            "Article 9: Scope\n\nProviders shall ensure that systems are safe."
            + "\n\nArticle 13: Transparency\n\nDeployers shall receive clear instructions for use.";

        Assert.Equal(IngestHash.Sha256Hex(expectedText), result.Document.Sha256);
        Assert.Equal(IngestHash.Utf8Bytes(expectedText), result.Document.Bytes);
    }

    [Fact]
    public async Task Builds_requirement_records_with_ids_and_draft_status()
    {
        var result = await AiActIngest.IngestAsync(new IngestOptions
        {
            FetchedAt = IngestSamples.FetchedAt,
            Fetcher = Fetcher(),
        });

        Assert.Equal(
            ["req-ai-act-art-9-1", "req-ai-act-art-13-1"],
            result.Requirements.Select(requirement => requirement.Id));
        Assert.All(result.Requirements, requirement =>
        {
            Assert.Equal("src-ai-act-2024-1689", requirement.SourceId);
            Assert.Equal("ai-act", requirement.FrameworkId);
            Assert.Equal("draft", requirement.Status);
            Assert.Equal(IngestSamples.FetchedAt, requirement.CreatedAt);
        });
        Assert.Equal("2026.1.0", result.Source.Version);
    }

    [Fact]
    public async Task Throws_when_the_index_has_no_articles()
    {
        var fetcher = new FakeTextFetcher(new Dictionary<string, string>
        {
            [AiActIngest.IndexUrl] = "<a href=\"/explorer\">Explorer</a>",
        });

        var error = await Assert.ThrowsAsync<IngestException>(
            () => AiActIngest.IngestAsync(new IngestOptions { Fetcher = fetcher }));

        Assert.Equal("AI Act explorer did not expose any article links.", error.Message);
    }

    [Fact]
    public async Task Logs_discovery_and_progress()
    {
        var logs = new List<string>();

        await AiActIngest.IngestAsync(new IngestOptions
        {
            FetchedAt = IngestSamples.FetchedAt,
            Fetcher = Fetcher(),
            Log = message =>
            {
                lock (logs) logs.Add(message);
            },
        });

        Assert.Contains("AI Act: 2 articles discovered.", logs);
        Assert.Contains("AI Act: extracted 2/2.", logs);
    }
}
