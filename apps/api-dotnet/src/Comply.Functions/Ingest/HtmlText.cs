using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Comply.Functions.Ingest;

/// <summary>
/// Port of <c>apps/api-node/lib/html.mjs</c>. The helpers stay regex based on purpose: the
/// ingest sources are small article pages, and matching the Node behaviour byte for byte is
/// what keeps <c>data/library.json</c> interoperable between the two backends.
/// </summary>
public static partial class HtmlText
{
    private static readonly Dictionary<string, string> Entities = new(StringComparer.Ordinal)
    {
        ["amp"] = "&",
        ["lt"] = "<",
        ["gt"] = ">",
        ["quot"] = "\"",
        ["apos"] = "'",
        ["nbsp"] = " ",
        ["ndash"] = "\u2013",
        ["mdash"] = "\u2014",
        ["lsquo"] = "\u2018",
        ["rsquo"] = "\u2019",
        ["ldquo"] = "\u201c",
        ["rdquo"] = "\u201d",
        ["hellip"] = "\u2026",
        ["middot"] = "\u00b7",
        ["bull"] = "\u2022",
        ["copy"] = "\u00a9",
        ["reg"] = "\u00ae",
    };

    private static readonly bool NormalizationSupportsDecomposition = SupportsDecomposition();

    private static readonly Dictionary<char, char> LatinFold = BuildLatinFold();

    /// <summary>
    /// Decodes named and numeric entities. Unknown or malformed entities are left untouched,
    /// which is what a browser shows for typos and what the Node helper does.
    /// </summary>
    public static string DecodeEntities(string value) =>
        EntityPattern().Replace(value, match =>
        {
            var entity = match.Groups[1].Value;

            if (entity.Length > 0 && entity[0] == '#')
            {
                var hex = entity.Length > 1 && char.ToLowerInvariant(entity[1]) == 'x';
                var digits = entity[(hex ? 2 : 1)..];
                var style = hex ? NumberStyles.AllowHexSpecifier : NumberStyles.None;

                if (int.TryParse(digits, style, CultureInfo.InvariantCulture, out var code) && IsValidCodePoint(code))
                {
                    // Lone surrogates are representable in a JS string, so no expansion happens.
                    return code is >= 0xD800 and <= 0xDFFF
                        ? ((char)code).ToString()
                        : char.ConvertFromUtf32(code);
                }

                return match.Value;
            }

            return Entities.TryGetValue(entity.ToLowerInvariant(), out var decoded) ? decoded : match.Value;
        });

    /// <summary>Removes a tag and everything nested inside it, using span depth.</summary>
    public static string RemoveElementsByClass(string html, string className, string tag = "span")
    {
        var opener = ClassOpener(className, tag);
        var output = html;

        while (true)
        {
            var start = opener.Match(output);
            if (!start.Success) return output;

            var close = FindMatchingClose(output, start.Index, tag);
            if (close < 0) return output;

            output = string.Concat(output.AsSpan(0, start.Index), output.AsSpan(close));
        }
    }

    /// <summary>Index just past the matching closing tag, or -1.</summary>
    public static int FindMatchingClose(string html, int startIndex, string tag = "span")
    {
        if (startIndex < 0 || startIndex >= html.Length) return -1;

        var token = new Regex(
            $"<(/?){Regex.Escape(tag)}\\b[^>]*>",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

        var depth = 0;
        var index = startIndex;

        while (true)
        {
            var match = token.Match(html, index);
            if (!match.Success) return -1;

            if (match.Groups[1].Value == "/")
            {
                depth -= 1;
                if (depth == 0) return match.Index + match.Length;
            }
            else
            {
                depth += 1;
            }

            index = match.Index + match.Length;
        }
    }

    /// <summary>Inner HTML of the first element carrying the class.</summary>
    public static string? ElementByClass(string html, string className, string tag = "span")
    {
        var opener = ClassOpener(className, tag);
        var start = opener.Match(html);
        if (!start.Success) return null;

        var close = FindMatchingClose(html, start.Index, tag);
        if (close < 0) return null;

        // Node searches backwards from just past the closing tag with an exact-case needle.
        var innerEnd = close > 0
            ? html.LastIndexOf($"</{tag}>", close - 1, StringComparison.Ordinal)
            : -1;

        var innerStart = start.Index + start.Length;
        if (innerEnd < 0) return html[innerStart..close];
        return innerEnd < innerStart ? string.Empty : html[innerStart..innerEnd];
    }

    public static string StripTags(string html)
    {
        var value = BreakTagPattern().Replace(html, "\n");
        value = BlockClosePattern().Replace(value, "\n");
        value = TagPattern().Replace(value, string.Empty);
        return DecodeEntities(value);
    }

    public static string NormalizeText(string value)
    {
        var normalized = value.Replace('\u00a0', ' ');
        normalized = HorizontalWhitespacePattern().Replace(normalized, " ");
        normalized = NewlineWhitespacePattern().Replace(normalized, "\n");
        normalized = BlankLinesPattern().Replace(normalized, "\n\n");
        return normalized.Trim();
    }

    public static string PlainText(string html) => NormalizeText(StripTags(html));

    public static IReadOnlyList<string> Paragraphs(string html)
    {
        var paragraphs = new List<string>();

        foreach (Match match in ParagraphPattern().Matches(html))
        {
            var text = PlainText(match.Groups[1].Value);
            if (text.Length > 0) paragraphs.Add(text);
        }

        return paragraphs;
    }

    /// <summary>Short readable title from a legal sentence.</summary>
    public static string ShortTitle(string text, int maxLength = 96)
    {
        var clean = WhitespacePattern().Replace(text ?? string.Empty, " ").Trim();
        var clause = ClauseSplitPattern().Split(clean)[0];
        var words = clause.Split(' ');

        var title = string.Empty;
        foreach (var word in words)
        {
            if ($"{title} {word}".Trim().Length > maxLength) break;
            title = $"{title} {word}".Trim();
        }

        var basis = title.Length > 0 ? title : Slice(clean, maxLength);
        var trimmed = TrailingPunctuationPattern().Replace(basis, "");
        if (trimmed.Length == 0) return string.Empty;

        return string.Concat(trimmed[..1].ToUpperInvariant(), trimmed[1..]);
    }

    public static string Slugify(string value, int maxLength = 64)
    {
        var stripped = StripDiacritics(value ?? string.Empty);
        var dashed = NonAlphanumericPattern().Replace(stripped, "-").Trim('-');
        var lowered = dashed.ToLowerInvariant();
        return Slice(lowered, maxLength).TrimEnd('-');
    }

    /// <summary>
    /// NFD + combining-mark removal, with a fallback for hosts where ICU is unavailable.
    /// The Functions app sets <c>InvariantGlobalization</c>, which turns
    /// <see cref="string.Normalize(NormalizationForm)"/> into a no-op, so the precomposed
    /// Latin-1 and Latin Extended-A letters are folded through a table instead.
    /// </summary>
    private static string StripDiacritics(string value)
    {
        if (NormalizationSupportsDecomposition)
        {
            return CombiningMarkPattern().Replace(value.Normalize(NormalizationForm.FormD), "");
        }

        var builder = new StringBuilder(value.Length);
        foreach (var character in value)
        {
            if (LatinFold.TryGetValue(character, out var folded))
            {
                builder.Append(folded);
            }
            else if (character is not (>= '\u0300' and <= '\u036f'))
            {
                builder.Append(character);
            }
        }

        return builder.ToString();
    }

    private static bool SupportsDecomposition()
    {
        try
        {
            return "\u00e8".Normalize(NormalizationForm.FormD).Length == 2;
        }
        catch (PlatformNotSupportedException)
        {
            return false;
        }
    }

    private static Dictionary<char, char> BuildLatinFold()
    {
        // Canonical NFD bases for U+00C0..U+017F, generated from Unicode data.
        const string composed =
            "ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿĀāĂăĄąĆćĈĉĊċČčĎďĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĨĩĪīĬĭĮįİĴĵĶķĹĺĻļĽľŃńŅņŇňŌōŎŏŐőŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽž";
        const string bases =
            "AAAAAACEEEEIIIINOOOOOUUUUYaaaaaaceeeeiiiinooooouuuuyyAaAaAaCcCcCcCcDdEeEeEeEeEeGgGgGgGgHhIiIiIiIiIJjKkLlLlLlNnNnNnOoOoOoRrRrRrSsSsSsSsTtTtUuUuUuUuUuUuWwYyYZzZzZz";

        var map = new Dictionary<char, char>(composed.Length);
        for (var index = 0; index < composed.Length; index++) map[composed[index]] = bases[index];
        return map;
    }

    private static Regex ClassOpener(string className, string tag) =>
        new(
            $"<{Regex.Escape(tag)}\\b[^>]*class=\"[^\"]*\\b{Regex.Escape(className)}\\b[^\"]*\"[^>]*>",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    /// <summary>JS <c>String.prototype.slice(0, max)</c> clamps instead of throwing.</summary>
    private static string Slice(string value, int maxLength) =>
        maxLength <= 0 ? string.Empty : value[..Math.Min(value.Length, maxLength)];

    private static bool IsValidCodePoint(int code) => code is >= 0 and <= 0x10FFFF;

    [GeneratedRegex("&(#x?[0-9a-f]+|[a-z]+);", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex EntityPattern();

    [GeneratedRegex("<br\\s*/?>", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex BreakTagPattern();

    [GeneratedRegex("</(p|div|li|tr|h[1-6])>", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex BlockClosePattern();

    [GeneratedRegex("<[^>]+>")]
    private static partial Regex TagPattern();

    [GeneratedRegex("[ \\t\\f\\u000b]+")]
    private static partial Regex HorizontalWhitespacePattern();

    [GeneratedRegex(" *\\n+ *")]
    private static partial Regex NewlineWhitespacePattern();

    [GeneratedRegex("\\n{3,}")]
    private static partial Regex BlankLinesPattern();

    [GeneratedRegex("<p\\b[^>]*>([\\s\\S]*?)</p>", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex ParagraphPattern();

    [GeneratedRegex("\\s+")]
    private static partial Regex WhitespacePattern();

    [GeneratedRegex("(?:;|\\.\\s|:\\s)")]
    private static partial Regex ClauseSplitPattern();

    [GeneratedRegex("[\\s,;:.]+\\z")]
    private static partial Regex TrailingPunctuationPattern();

    [GeneratedRegex("[\\u0300-\\u036f]")]
    private static partial Regex CombiningMarkPattern();

    [GeneratedRegex("[^a-zA-Z0-9]+")]
    private static partial Regex NonAlphanumericPattern();
}
