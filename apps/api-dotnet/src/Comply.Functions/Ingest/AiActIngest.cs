using System.Text.RegularExpressions;
using Comply.Functions.Models;

namespace Comply.Functions.Ingest;

/// <summary>
/// Port of <c>apps/api-node/lib/ingest/ai-act.mjs</c>: discover article pages on the AI Act
/// explorer, read the <c>para depth-N</c> blocks and strip inline <c>term-tip</c> definitions.
/// </summary>
public static partial class AiActIngest
{
    public const string FrameworkId = IngestSources.AiActFrameworkId;
    public const string SourceId = IngestSources.AiActSourceId;
    public const string DocumentId = IngestSources.AiActDocumentId;
    public const string IndexUrl = IngestSources.AiActIndexUrl;

    private const string ArticleBaseUrl = "https://artificialintelligenceact.eu/article/";

    /// <summary>Article links from the explorer page, deduplicated by number and sorted ascending.</summary>
    public static IReadOnlyList<DiscoveredArticle> DiscoverArticles(string indexHtml)
    {
        var found = new Dictionary<string, DiscoveredArticle>(StringComparer.Ordinal);

        foreach (Match match in IndexLinkPattern().Matches(indexHtml))
        {
            var number = match.Groups[1].Value.ToLowerInvariant();
            if (found.ContainsKey(number)) continue;

            found[number] = new DiscoveredArticle(number, $"{ArticleBaseUrl}{number}/", string.Empty);
        }

        return found.Values
            .OrderBy(article => LeadingNumber.TryParse(article.Number, out var value) ? value : int.MaxValue)
            .ThenBy(article => article.Number, StringComparer.Ordinal)
            .ToList();
    }

    /// <summary>Parses one article page. Throws <see cref="IngestException"/> when the page has no body.</summary>
    public static ParsedPage ParseArticle(string html, string number, string url)
    {
        var heading = HeadingPattern().Match(html);
        if (!heading.Success) throw new IngestException($"Article {number} has no heading at {url}");

        // The Node parser also reads the heading label; it is never used because the article
        // number from the index is authoritative.
        var rawTitle = HtmlText.PlainText(HtmlText.ElementByClass(heading.Groups[1].Value, "heading-title") ?? string.Empty);
        var title = LeadingColonPattern()
            .Replace(ArticlePrefixPattern().Replace(rawTitle, string.Empty), string.Empty)
            .Trim();
        if (title.Length == 0) title = $"Article {number}";

        var body = HtmlText.RemoveElementsByClass(
            html[(heading.Index + heading.Length)..],
            "term-tip");

        var blocks = new List<ParaBlock>();

        foreach (var chunk in ParagraphSplitPattern().Split(body).Skip(1))
        {
            var open = ParagraphOpenPattern().Match(chunk);
            var depth = DepthPattern().Match(open.Success ? open.Groups[1].Value : string.Empty);
            if (!depth.Success) continue;

            // A depth that overflows int behaves like a very deep block: text only, no requirement.
            var depthValue = int.TryParse(depth.Groups[1].Value, out var parsedDepth) ? parsedDepth : int.MaxValue;

            var labelMatch = ParagraphLabelPattern().Match(chunk);
            var label = labelMatch.Success ? HtmlText.PlainText(labelMatch.Groups[1].Value) : string.Empty;
            var text = HtmlText.NormalizeText(
                HtmlText.PlainText(HtmlText.ElementByClass(chunk, "para-text") ?? string.Empty));
            if (text.Length == 0) continue;

            var anchor = AnchorPattern().Match(chunk);

            blocks.Add(new ParaBlock(
                depthValue,
                label,
                text,
                anchor.Success ? anchor.Groups[1].Value : null));
        }

        var pageText = string.Join("\n\n", blocks.Select(block => block.Text));
        if (pageText.Length < 20) throw new IngestException($"Article {number} has no readable text at {url}");

        var order = new List<string>();
        var byRef = new Dictionary<string, ParsedRequirement>(StringComparer.Ordinal);

        void Set(string reference, ParsedRequirement requirement)
        {
            if (!byRef.ContainsKey(reference)) order.Add(reference);
            byRef[reference] = requirement;
        }

        string? parentNumber = null;

        foreach (var block in blocks)
        {
            if (block.Depth > 1) continue;

            var numberMatch = NumberLabelPattern().Match(block.Label.Trim());
            if (block.Depth == 0 && numberMatch.Success) parentNumber = numberMatch.Groups[1].Value;

            if (block.Depth == 0)
            {
                var suffix = parentNumber is null ? string.Empty : $"({parentNumber})";
                var reference = $"Art. {number}{suffix}";
                Set(reference, new ParsedRequirement(reference, title, block.Text, string.Empty));
                continue;
            }

            var letterMatch = LetterLabelPattern().Match(block.Label.Trim());
            if (block.Depth == 1 && letterMatch.Success)
            {
                var parent = parentNumber is null ? string.Empty : $"({parentNumber})";
                var reference = $"Art. {number}{parent}({letterMatch.Groups[1].Value.ToLowerInvariant()})";
                if (!byRef.ContainsKey(reference))
                {
                    Set(reference, new ParsedRequirement(reference, HtmlText.ShortTitle(block.Text), block.Text, string.Empty));
                }
            }
        }

        if (byRef.Count == 0)
        {
            Set($"Art. {number}", new ParsedRequirement($"Art. {number}", title, pageText, string.Empty));
        }

        return new ParsedPage(
            number,
            url,
            title,
            pageText,
            order
                .Select(reference => byRef[reference] with { Theme = IngestThemes.AiAct(number) })
                .ToList());
    }

    /// <summary>Fetches the explorer index and every article, then builds the source, document and requirements.</summary>
    public static async Task<IngestResult> IngestAsync(
        IngestOptions? options = null,
        CancellationToken cancellationToken = default)
    {
        options ??= new IngestOptions();

        var fetchedAt = options.ResolveFetchedAt();
        var fetcher = options.ResolveFetcher();
        var log = options.Log;

        var index = await fetcher.FetchAsync(IndexUrl, cancellationToken).ConfigureAwait(false);
        var articles = DiscoverArticles(index);
        if (articles.Count == 0)
            throw new IngestException("AI Act explorer did not expose any article links.");

        log?.Invoke($"AI Act: {articles.Count} articles discovered.");
        var completed = 0;

        var pages = await IngestFetch.MapLimitAsync(
            articles,
            options.ResolveConcurrency(),
            async (article, _, token) =>
            {
                var html = await fetcher.FetchAsync(article.Url, token).ConfigureAwait(false);
                var parsed = ParseArticle(html, article.Number, article.Url);

                var done = Interlocked.Increment(ref completed);
                if (done % 10 == 0 || done == articles.Count)
                {
                    log?.Invoke($"AI Act: extracted {done}/{articles.Count}.");
                }

                return parsed;
            },
            cancellationToken).ConfigureAwait(false);

        var text = string.Join(
            "\n\n",
            pages.Select(page => $"Article {page.Number}: {page.Title}\n\n{page.Text}"));

        var document = new IngestDocument
        {
            Id = DocumentId,
            SourceId = SourceId,
            FrameworkId = FrameworkId,
            Title = IngestSources.AiActTitle,
            Url = IndexUrl,
            OfficialUrl = IngestSources.AiActOfficialUrl,
            Publisher = "European Union",
            License = "public",
            FetchedAt = fetchedAt,
            Sha256 = IngestHash.Sha256Hex(text),
            Bytes = IngestHash.Utf8Bytes(text),
            Pages = pages.Select(page => new IngestedPage
            {
                Ref = $"Art. {page.Number}",
                Title = page.Title,
                Url = page.Url,
                Text = page.Text,
            }).ToList(),
        };

        var source = IngestSources.AiAct(fetchedAt);

        var requirements = pages
            .SelectMany(page => page.Requirements.Select(requirement => new Requirement
            {
                Id = $"req-ai-act-{HtmlText.Slugify(requirement.Ref)}",
                SourceId = source.Id,
                FrameworkId = source.FrameworkId,
                Ref = requirement.Ref,
                Title = requirement.Title,
                Text = requirement.Text,
                Theme = requirement.Theme,
                Status = "draft",
                Reviewer = null,
                ReviewedAt = null,
                CreatedAt = fetchedAt,
            }))
            .ToList();

        return new IngestResult { Source = source, Document = document, Requirements = requirements };
    }

    [GeneratedRegex(
        "href=\"(?:https://artificialintelligenceact\\.eu)?/article/(\\d+[a-z]?)/?\"",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex IndexLinkPattern();

    [GeneratedRegex(
        "<h[12][^>]*class=\"[^\"]*item-heading[^\"]*\"[^>]*>([\\s\\S]*?)</h[12]>",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex HeadingPattern();

    [GeneratedRegex("^Article\\s+\\d+[a-z]?:\\s*", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex ArticlePrefixPattern();

    [GeneratedRegex("^:\\s*")]
    private static partial Regex LeadingColonPattern();

    [GeneratedRegex("(?=<div class=\"para\\b)", RegexOptions.CultureInvariant)]
    private static partial Regex ParagraphSplitPattern();

    [GeneratedRegex("^<div class=\"([^\"]*)\"[^>]*>", RegexOptions.CultureInvariant)]
    private static partial Regex ParagraphOpenPattern();

    [GeneratedRegex("(?:^|\\s)depth-(\\d+)(?:\\s|\\z)", RegexOptions.CultureInvariant)]
    private static partial Regex DepthPattern();

    [GeneratedRegex("<span class=\"para-label\">([\\s\\S]*?)</span>", RegexOptions.CultureInvariant)]
    private static partial Regex ParagraphLabelPattern();

    [GeneratedRegex("id=\"([^\"]+)\"", RegexOptions.CultureInvariant)]
    private static partial Regex AnchorPattern();

    [GeneratedRegex("^(\\d{1,2})\\.\\z", RegexOptions.CultureInvariant)]
    private static partial Regex NumberLabelPattern();

    [GeneratedRegex("^\\(([a-z0-9ivx]+)\\)\\z", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex LetterLabelPattern();

    private sealed record ParaBlock(int Depth, string Label, string Text, string? Anchor);
}
