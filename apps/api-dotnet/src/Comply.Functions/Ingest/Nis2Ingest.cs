using System.Text.RegularExpressions;
using Comply.Functions.Models;

namespace Comply.Functions.Ingest;

/// <summary>
/// Port of <c>apps/api-node/lib/ingest/nis2.mjs</c>: discover the article index on
/// nis-2-directive.com, extract numbered paragraphs and lettered measures, and emit one
/// requirement per item.
/// </summary>
public static partial class Nis2Ingest
{
    public const string FrameworkId = IngestSources.Nis2FrameworkId;
    public const string SourceId = IngestSources.Nis2SourceId;
    public const string DocumentId = IngestSources.Nis2DocumentId;
    public const string IndexUrl = IngestSources.Nis2IndexUrl;

    private static readonly string[] StopMarkers =
    [
        "Understanding Article",
        "Note:",
        "Articles, Directive (EU)",
    ];

    /// <summary>Article links from the index page, deduplicated by number and sorted ascending.</summary>
    public static IReadOnlyList<DiscoveredArticle> DiscoverArticles(string indexHtml, string baseUrl = IndexUrl)
    {
        var found = new Dictionary<string, DiscoveredArticle>(StringComparer.Ordinal);
        var baseUri = new Uri(baseUrl, UriKind.Absolute);

        foreach (Match match in IndexLinkPattern().Matches(indexHtml))
        {
            var number = match.Groups[2].Value;
            if (found.ContainsKey(number)) continue;

            var href = match.Groups[1].Value;
            var url = Uri.TryCreate(baseUri, href, out var resolved)
                ? resolved.ToString()
                : href;

            found[number] = new DiscoveredArticle(number, url, HtmlText.PlainText(match.Groups[3].Value));
        }

        return found.Values
            .OrderBy(article => int.TryParse(article.Number, out var value) ? value : int.MaxValue)
            .ToList();
    }

    /// <summary>Parses one article page. Throws <see cref="IngestException"/> when the page has no body.</summary>
    public static ParsedPage ParseArticle(string html, string number, string url)
    {
        var heading = HeadingPattern().Match(html);
        if (!heading.Success) throw new IngestException($"Article heading missing at {url}");

        var title = HtmlText.PlainText(heading.Groups[2].Value);
        var body = html[(heading.Index + heading.Length)..];

        var stopAt = StopMarkers
            .Select(marker => body.IndexOf(marker, StringComparison.Ordinal))
            .Where(index => index >= 0)
            .DefaultIfEmpty(-1)
            .Min();
        if (stopAt >= 0) body = body[..stopAt];

        var items = new List<Nis2Item>();
        string? lastNumber = null;
        Nis2Item? current = null;

        foreach (var paragraph in HtmlText.Paragraphs(body))
        {
            var numbered = NumberedItemPattern().Match(paragraph);
            var letter = LetterItemPattern().Match(paragraph);

            if (numbered.Success)
            {
                lastNumber = numbered.Groups[1].Value;
                current = new Nis2Item
                {
                    Kind = "number",
                    Number = numbered.Groups[1].Value,
                    Text = numbered.Groups[2].Value.Trim(),
                };
                items.Add(current);
                continue;
            }

            if (letter.Success)
            {
                current = new Nis2Item
                {
                    Kind = "letter",
                    Letter = letter.Groups[1].Value.ToLowerInvariant(),
                    Parent = lastNumber,
                    Text = letter.Groups[2].Value.Trim(),
                };
                items.Add(current);
                continue;
            }

            if (current is not null)
            {
                current.Text = $"{current.Text} {paragraph}".Trim();
            }
            else if (paragraph.Length >= 30)
            {
                items.Add(new Nis2Item { Kind = "intro", Text = paragraph });
            }
        }

        var pageText = string.Join("\n\n", items.Select(item => item.Text));
        if (pageText.Length < 20) throw new IngestException($"Article {number} has no readable text at {url}");

        var requirements = items
            .Where(item => item.Text.Length >= (item.Kind == "letter" ? 8 : 20))
            .Select(item => item.Kind switch
            {
                "number" => new ParsedRequirement(
                    $"Art. {number}({item.Number})",
                    HtmlText.ShortTitle(item.Text),
                    item.Text,
                    string.Empty),
                "letter" => new ParsedRequirement(
                    $"Art. {number}{(item.Parent is null ? string.Empty : $"({item.Parent})")}({item.Letter})",
                    HtmlText.ShortTitle(item.Text),
                    item.Text,
                    string.Empty),
                _ => new ParsedRequirement($"Art. {number}", title, item.Text, string.Empty),
            })
            .ToList();

        if (requirements.Count == 0)
        {
            requirements.Add(new ParsedRequirement($"Art. {number}", title, pageText, string.Empty));
        }

        return new ParsedPage(
            number,
            url,
            title,
            pageText,
            requirements
                .Select(requirement => requirement with { Theme = IngestThemes.Nis2($"{title} {requirement.Text}") })
                .ToList());
    }

    /// <summary>Fetches the index and every article, then builds the source, document and requirements.</summary>
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
        if (articles.Count == 0) throw new IngestException("NIS2 index did not expose any article links.");

        log?.Invoke($"NIS2: {articles.Count} articles discovered.");
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
                    log?.Invoke($"NIS2: extracted {done}/{articles.Count}.");
                }

                return parsed;
            },
            cancellationToken).ConfigureAwait(false);

        var text = string.Join(
            "\n\n",
            pages.Select(page => $"Article {page.Number}, {page.Title}\n\n{page.Text}"));

        var document = new IngestDocument
        {
            Id = DocumentId,
            SourceId = SourceId,
            FrameworkId = FrameworkId,
            Title = IngestSources.Nis2Title,
            Url = IndexUrl,
            OfficialUrl = IngestSources.Nis2OfficialUrl,
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

        var source = IngestSources.Nis2(fetchedAt);

        var requirements = pages
            .SelectMany(page => page.Requirements.Select(requirement => new Requirement
            {
                Id = $"req-nis2-{HtmlText.Slugify(requirement.Ref)}",
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
        "href=\"([^\"]*NIS_2_Directive_Article_(\\d+)\\.html)\"[^>]*>([\\s\\S]*?)</a>",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex IndexLinkPattern();

    [GeneratedRegex("<b>\\s*Article\\s+(\\d+)\\s*,\\s*([^<]+)</b>", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex HeadingPattern();

    [GeneratedRegex("^(\\d{1,2})\\.\\s+([\\s\\S]+)\\z")]
    private static partial Regex NumberedItemPattern();

    [GeneratedRegex("^\\(([a-z])\\)\\s+([\\s\\S]+)\\z", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex LetterItemPattern();

    private sealed class Nis2Item
    {
        public string Kind { get; init; } = "intro";

        public string? Number { get; init; }

        public string? Letter { get; init; }

        public string? Parent { get; init; }

        public string Text { get; set; } = string.Empty;
    }
}
