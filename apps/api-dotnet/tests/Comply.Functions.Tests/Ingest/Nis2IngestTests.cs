using Comply.Functions.Ingest;
using Comply.Functions.Models;

namespace Comply.Functions.Tests.Ingest;

public sealed class Nis2ParserTests
{
    // Same fixture as apps/api-node/test/parsers.test.mjs.
    private const string Article = """
        <h1>The NIS 2 Directive | Article 21</h1>
        <p class="text-left"><b>Article 21, Cybersecurity risk-management measures</b></p>
        <p class="text-left">1. Entities shall take appropriate measures to manage risks.</p>
        <p class="text-left">2. The measures shall include at least the following:</p>
        <p class="text-left">(a) policies on risk analysis and information system security;</p>
        <p class="text-left">(b) incident handling;</p>
        <p class="text-left">(c) business continuity and crisis management.</p>
        <p class="text-left">3. Entities shall take corrective measures without undue delay.</p>
        <p class="text-left"><b>Understanding Article 21 of the NIS 2 Directive | Analysis</b></p>
        <p class="text-left">This analysis is not part of the directive.</p>
        """;

    private static ParsedPage Parse(string html, string number = "21") =>
        Nis2Ingest.ParseArticle(html, number, $"https://example.test/{number}");

    [Fact]
    public void Extracts_numbered_and_lettered_items()
    {
        var page = Parse(Article);

        Assert.Equal(
            ["Art. 21(1)", "Art. 21(2)", "Art. 21(2)(a)", "Art. 21(2)(b)", "Art. 21(2)(c)", "Art. 21(3)"],
            page.Requirements.Select(requirement => requirement.Ref));
    }

    [Fact]
    public void Reads_the_article_title_from_the_bold_heading()
    {
        Assert.Equal("Cybersecurity risk-management measures", Parse(Article).Title);
    }

    [Fact]
    public void Keeps_the_letter_body_without_the_letter_marker()
    {
        var page = Parse(Article);

        Assert.Equal(
            "business continuity and crisis management.",
            page.Requirements[4].Text);
    }

    [Fact]
    public void Stops_at_the_understanding_article_marker()
    {
        var page = Parse(Article);

        Assert.DoesNotContain("not part of the directive", page.Text);
        Assert.DoesNotContain(
            page.Requirements,
            requirement => requirement.Text.Contains("not part of the directive", StringComparison.Ordinal));
    }

    [Fact]
    public void Captures_a_long_intro_paragraph_before_the_first_number()
    {
        const string html = """
            <p><b>Article 5, Intro test</b></p>
            <p>This introductory sentence explains the purpose of the article at length.</p>
            <p>1. First numbered measure that is long enough to count.</p>
            <p>(a) a short letter item</p>
            """;

        var page = Parse(html, "5");

        Assert.Equal(["Art. 5", "Art. 5(1)", "Art. 5(1)(a)"], page.Requirements.Select(item => item.Ref));
        Assert.Equal("Intro test", page.Requirements[0].Title);
        Assert.Equal("This introductory sentence explains the purpose of the article at length.",
            page.Requirements[0].Text);
    }

    [Fact]
    public void Ignores_short_intro_paragraphs()
    {
        const string html = """
            <p><b>Article 5, Intro test</b></p>
            <p>Too short.</p>
            <p>1. First numbered measure that is long enough to count.</p>
            """;

        var page = Parse(html, "5");

        Assert.Equal(["Art. 5(1)"], page.Requirements.Select(item => item.Ref));
    }

    [Fact]
    public void Appends_continuation_paragraphs_to_the_current_item()
    {
        const string html = """
            <p><b>Article 5, Continued</b></p>
            <p>1. First sentence of the measure.</p>
            <p>A continuation sentence added to the same measure.</p>
            """;

        var page = Parse(html, "5");

        var requirement = Assert.Single(page.Requirements);
        Assert.Equal("Art. 5(1)", requirement.Ref);
        Assert.Equal(
            "First sentence of the measure. A continuation sentence added to the same measure.",
            requirement.Text);
        Assert.Equal(
            "First sentence of the measure. A continuation sentence added to the same measure.",
            page.Text);
    }

    [Fact]
    public void Stops_at_a_note_marker()
    {
        const string html = """
            <p><b>Article 7, Notes</b></p>
            <p>1. The actual requirement body text is here.</p>
            <p>Note: editorial note that must not be parsed.</p>
            <p>2. Another requirement after the note.</p>
            """;

        var page = Parse(html, "7");

        Assert.Equal(["Art. 7(1)"], page.Requirements.Select(item => item.Ref));
        Assert.DoesNotContain("editorial note", page.Text);
    }

    [Fact]
    public void Drops_items_below_the_length_thresholds()
    {
        const string html = """
            <p><b>Article 8, Short items</b></p>
            <p>1. This numbered item is long enough to keep.</p>
            <p>(a) tiny</p>
            <p>2. short</p>
            """;

        var page = Parse(html, "8");

        Assert.Equal(["Art. 8(1)"], page.Requirements.Select(item => item.Ref));
    }

    [Fact]
    public void Falls_back_to_one_requirement_when_no_item_qualifies()
    {
        const string html = """
            <p><b>Article 5, Fallback</b></p>
            <p>1. abcdefgh</p>
            <p>2. ijklmnop</p>
            <p>3. qrstuvwx</p>
            """;

        var page = Parse(html, "5");

        var requirement = Assert.Single(page.Requirements);
        Assert.Equal("Art. 5", requirement.Ref);
        Assert.Equal(page.Text, requirement.Text);
    }

    [Fact]
    public void Assigns_themes_from_the_article_title_and_text()
    {
        var page = Parse(Article);

        // The title carries "risk", which is the first NIS2 rule, so every item inherits it.
        Assert.All(page.Requirements, requirement => Assert.Equal("organizational", requirement.Theme));
    }

    [Fact]
    public void Themes_can_come_from_the_item_text_alone()
    {
        const string html = """
            <p><b>Article 9, Measures</b></p>
            <p>1. Entities shall handle incidents without delay and report them.</p>
            <p>(a) network security measures are applied to every system.</p>
            """;

        var page = Parse(html, "9");

        Assert.Equal("procedures", page.Requirements[0].Theme);
        Assert.Equal("infrastructure", page.Requirements[1].Theme);
    }

    [Fact]
    public void Throws_when_the_heading_is_missing()
    {
        var error = Assert.Throws<IngestException>(
            () => Nis2Ingest.ParseArticle("<p>no heading</p>", "21", "https://example.test/21"));

        Assert.Equal("Article heading missing at https://example.test/21", error.Message);
    }

    [Fact]
    public void Throws_when_the_page_has_no_readable_text()
    {
        var error = Assert.Throws<IngestException>(
            () => Nis2Ingest.ParseArticle("<p><b>Article 1, Title</b></p><p>tiny</p>", "1", "https://example.test/1"));

        Assert.Equal("Article 1 has no readable text at https://example.test/1", error.Message);
    }
}

public sealed class Nis2IngestTests
{
    private const string Index = """
        <a href="NIS_2_Directive_Article_2.html">Article 2</a>
        <a href="NIS_2_Directive_Article_1.html">Article 1</a>
        """;

    private const string Article1 = """
        <p><b>Article 1, Scope</b></p>
        <p>1. Member States shall adopt measures for a high level of cybersecurity.</p>
        """;

    private const string Article2 = """
        <p><b>Article 2, Governance</b></p>
        <p>1. Member States shall ensure governance arrangements are in place.</p>
        <p>(a) the management body approves the risk policy;</p>
        """;

    private static readonly string Url1 = "https://www.nis-2-directive.com/NIS_2_Directive_Article_1.html";
    private static readonly string Url2 = "https://www.nis-2-directive.com/NIS_2_Directive_Article_2.html";

    private static FakeTextFetcher Fetcher() => new(new Dictionary<string, string>
    {
        [Nis2Ingest.IndexUrl] = Index,
        [Url1] = Article1,
        [Url2] = Article2,
    });

    [Fact]
    public async Task Builds_the_document_from_every_discovered_article()
    {
        var result = await Nis2Ingest.IngestAsync(new IngestOptions
        {
            FetchedAt = IngestSamples.FetchedAt,
            Fetcher = Fetcher(),
        });

        var document = result.Document;
        Assert.Equal("doc-nis2-2022-2555", document.Id);
        Assert.Equal("src-nis2-2022-2555", document.SourceId);
        Assert.Equal("nis2", document.FrameworkId);
        Assert.Equal("Directive (EU) 2022/2555 (NIS2)", document.Title);
        Assert.Equal(Nis2Ingest.IndexUrl, document.Url);
        Assert.Equal("https://eur-lex.europa.eu/eli/dir/2022/2555/oj/eng", document.OfficialUrl);
        Assert.Equal("European Union", document.Publisher);
        Assert.Equal("public", document.License);
        Assert.Equal(IngestSamples.FetchedAt, document.FetchedAt);
        Assert.Equal(["Art. 1", "Art. 2"], document.Pages.Select(page => page.Ref));
        Assert.Equal([Url1, Url2], document.Pages.Select(page => page.Url));
    }

    [Fact]
    public async Task Hashes_the_joined_article_text()
    {
        var result = await Nis2Ingest.IngestAsync(new IngestOptions
        {
            FetchedAt = IngestSamples.FetchedAt,
            Fetcher = Fetcher(),
        });

        var expectedText =
            "Article 1, Scope\n\nMember States shall adopt measures for a high level of cybersecurity."
            + "\n\nArticle 2, Governance\n\nMember States shall ensure governance arrangements are in place."
            + "\n\nthe management body approves the risk policy;";

        Assert.Equal(IngestHash.Sha256Hex(expectedText), result.Document.Sha256);
        Assert.Equal(IngestHash.Utf8Bytes(expectedText), result.Document.Bytes);
        Assert.Equal(64, result.Document.Sha256.Length);
    }

    [Fact]
    public async Task Builds_requirement_records_with_ids_and_draft_status()
    {
        var result = await Nis2Ingest.IngestAsync(new IngestOptions
        {
            FetchedAt = IngestSamples.FetchedAt,
            Fetcher = Fetcher(),
        });

        Assert.Equal(
            ["req-nis2-art-1-1", "req-nis2-art-2-1", "req-nis2-art-2-1-a"],
            result.Requirements.Select(requirement => requirement.Id));
        Assert.All(result.Requirements, requirement =>
        {
            Assert.Equal("src-nis2-2022-2555", requirement.SourceId);
            Assert.Equal("nis2", requirement.FrameworkId);
            Assert.Equal("draft", requirement.Status);
            Assert.Null(requirement.Reviewer);
            Assert.Null(requirement.ReviewedAt);
            Assert.Equal(IngestSamples.FetchedAt, requirement.CreatedAt);
        });
    }

    [Fact]
    public async Task Builds_the_source_record_with_the_fetch_timestamp()
    {
        var result = await Nis2Ingest.IngestAsync(new IngestOptions
        {
            FetchedAt = IngestSamples.FetchedAt,
            Fetcher = Fetcher(),
        });

        Assert.Equal("src-nis2-2022-2555", result.Source.Id);
        Assert.Equal("2024.1.0", result.Source.Version);
        Assert.Equal("html", result.Source.Kind);
        Assert.Equal(IngestSamples.FetchedAt, result.Source.ImportedAt);
        Assert.Null(result.Source.LastReviewedAt);
    }

    [Fact]
    public async Task Preserves_article_order_when_pages_finish_out_of_order()
    {
        var fetcher = Fetcher();
        fetcher.OnFetch = url => url == Url1 ? Task.Delay(60) : Task.Delay(5);

        var result = await Nis2Ingest.IngestAsync(new IngestOptions
        {
            FetchedAt = IngestSamples.FetchedAt,
            Fetcher = fetcher,
            Concurrency = 4,
        });

        Assert.Equal(["1", "2"], result.Document.Pages.Select(page => page.Ref!.Replace("Art. ", "")));
        Assert.Equal(2, fetcher.PeakConcurrency);
    }

    [Fact]
    public async Task Throws_when_the_index_has_no_articles()
    {
        var fetcher = new FakeTextFetcher(new Dictionary<string, string>
        {
            [Nis2Ingest.IndexUrl] = "<a href=\"/nothing\">Nothing</a>",
        });

        var error = await Assert.ThrowsAsync<IngestException>(
            () => Nis2Ingest.IngestAsync(new IngestOptions { Fetcher = fetcher }));

        Assert.Equal("NIS2 index did not expose any article links.", error.Message);
    }

    [Fact]
    public async Task Logs_discovery_and_progress()
    {
        var logs = new List<string>();

        await Nis2Ingest.IngestAsync(new IngestOptions
        {
            FetchedAt = IngestSamples.FetchedAt,
            Fetcher = Fetcher(),
            Log = message =>
            {
                lock (logs) logs.Add(message);
            },
        });

        Assert.Contains("NIS2: 2 articles discovered.", logs);
        Assert.Contains("NIS2: extracted 2/2.", logs);
    }
}
