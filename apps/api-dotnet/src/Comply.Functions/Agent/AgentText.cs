using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace Comply.Functions.Agent;

/// <summary>
/// Text and number helpers ported from <c>apps/api-node/lib/agent.mjs</c>. The search uses the
/// same tokenizer, plural folding, IDF weights and cosine similarity as the Node agent so the
/// ranking contract stays stable across backends.
/// </summary>
public static partial class AgentText
{
    private static readonly HashSet<string> Stopwords = new(StringComparer.Ordinal)
    {
        "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have", "in",
        "is", "it", "of", "on", "or", "that", "the", "their", "this", "to", "was", "were", "with",
    };

    public static List<string> Tokenize(string? value)
    {
        var terms = new List<string>();
        if (string.IsNullOrEmpty(value)) return terms;

        foreach (var token in WordSeparator().Split(Fold(value.ToLowerInvariant())))
        {
            if (token.Length < 2 || Stopwords.Contains(token)) continue;
            terms.Add(Stem(token));
        }

        return terms;
    }

    /// <summary>
    /// Folds accents like <c>value.normalize("NFKD").replace(/\p{M}/gu, "")</c>. The Functions
    /// host runs with invariant globalization, where NFKD is a no-op, so the Latin-1 and common
    /// Latin Extended-A letters are folded explicitly as well.
    /// </summary>
    public static string Fold(string value)
    {
        string decomposed;
        try
        {
            decomposed = value.Normalize(NormalizationForm.FormKD);
        }
        catch (PlatformNotSupportedException)
        {
            decomposed = value;
        }

        var builder = new StringBuilder(decomposed.Length);
        foreach (var character in decomposed)
        {
            if (character is >= '\u0300' and <= '\u036f') continue;

            var index = AccentedChars.IndexOf(character);
            if (index >= 0)
            {
                builder.Append(PlainChars[index]);
            }
            else if (Expansions.TryGetValue(character, out var expansion))
            {
                builder.Append(expansion);
            }
            else
            {
                builder.Append(character);
            }
        }

        return builder.ToString();
    }

    private const string AccentedChars =
        "ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖØÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöøùúûüýÿ";

    private const string PlainChars =
        "AAAAAACEEEEIIIINOOOOOUUUUYaaaaaaceeeeiiiinooooouuuuyy";

    private static readonly Dictionary<char, string> Expansions = new()
    {
        ['Æ'] = "AE",
        ['æ'] = "ae",
        ['Œ'] = "OE",
        ['œ'] = "oe",
        ['ß'] = "ss",
        ['Þ'] = "TH",
        ['þ'] = "th",
        ['Ð'] = "D",
        ['ð'] = "d",
        ['Š'] = "S",
        ['š'] = "s",
        ['Ž'] = "Z",
        ['ž'] = "z",
        ['Ł'] = "L",
        ['ł'] = "l",
    };

    /// <summary>Folds common English plural forms so "policy" matches "policies".</summary>
    public static string Stem(string term)
    {
        if (term.Length > 4 && term.EndsWith("ies", StringComparison.Ordinal))
        {
            return $"{term[..^3]}y";
        }

        if (term.Length > 4 && EsPlural().IsMatch(term))
        {
            return term[..^2];
        }

        if (term.Length > 3 && term.EndsWith("s", StringComparison.Ordinal) && !SsPlural().IsMatch(term))
        {
            return term[..^1];
        }

        return term;
    }

    /// <summary>The text the Node agent indexes for one requirement; the title counts twice.</summary>
    public static string SearchText(
        string? reference,
        string? title,
        string? description,
        string? conclusion) =>
        string.Join(
            " ",
            new[] { reference, title, title, description, conclusion }
                .Where(part => !string.IsNullOrEmpty(part)));

    public static Dictionary<string, double> WeightedVector(
        IReadOnlyList<string> terms,
        Func<string, double> idf)
    {
        var counts = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var term in terms)
        {
            counts[term] = counts.GetValueOrDefault(term) + 1;
        }

        var vector = new Dictionary<string, double>(StringComparer.Ordinal);
        var norm = 0d;
        foreach (var (term, count) in counts)
        {
            var weight = ((double)count / terms.Count) * idf(term);
            vector[term] = weight;
            norm += weight * weight;
        }

        var length = Math.Sqrt(norm);
        if (length == 0) return vector;

        foreach (var term in vector.Keys.ToList())
        {
            vector[term] /= length;
        }

        return vector;
    }

    public static double Cosine(Dictionary<string, double> left, Dictionary<string, double> right)
    {
        var (small, large) = left.Count <= right.Count ? (left, right) : (right, left);
        var score = 0d;
        foreach (var (term, weight) in small)
        {
            score += weight * large.GetValueOrDefault(term);
        }

        return score;
    }

    /// <summary><c>Math.round</c> semantics: halves round up, not to even.</summary>
    public static int JsRound(double value) => (int)Math.Floor(value + 0.5);

    /// <summary><c>clamp()</c> from the Node agent; a non-finite value falls back to the minimum.</summary>
    public static int Clamp(double? value, int minimum, int maximum)
    {
        if (value is null || double.IsNaN(value.Value) || double.IsInfinity(value.Value))
        {
            return minimum;
        }

        return Math.Min(maximum, Math.Max(minimum, JsRound(value.Value)));
    }

    /// <summary><c>Number.parseInt(value, 10)</c>: numbers truncate, strings keep their digit prefix.</summary>
    public static double? ParseInt(double? number, string? text)
    {
        if (number is { } value)
        {
            return double.IsNaN(value) || double.IsInfinity(value) ? null : Math.Truncate(value);
        }

        if (text is null) return null;

        var span = text.AsSpan().TrimStart();
        var index = 0;
        var negative = false;
        if (index < span.Length && (span[index] == '+' || span[index] == '-'))
        {
            negative = span[index] == '-';
            index++;
        }

        var digits = 0;
        double parsed = 0;
        while (index + digits < span.Length && char.IsAsciiDigit(span[index + digits]))
        {
            parsed = (parsed * 10) + (span[index + digits] - '0');
            digits++;
        }

        if (digits == 0) return null;
        return negative ? -parsed : parsed;
    }

    /// <summary><c>Number(value)</c>: strings must parse in full, everything else is NaN.</summary>
    public static double? ParseNumber(double? number, string? text)
    {
        if (number is { } value)
        {
            return double.IsNaN(value) || double.IsInfinity(value) ? null : value;
        }

        if (text is null) return null;
        var trimmed = text.Trim();
        if (trimmed.Length == 0) return 0;

        return double.TryParse(
            trimmed,
            NumberStyles.Float,
            CultureInfo.InvariantCulture,
            out var parsed) && !double.IsNaN(parsed) && !double.IsInfinity(parsed)
            ? parsed
            : null;
    }

    public static string Sha256Hex(string value) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();

    [GeneratedRegex("[^a-z0-9]+", RegexOptions.CultureInvariant)]
    private static partial Regex WordSeparator();

    [GeneratedRegex("(?:ses|xes|zes|ches|shes)$", RegexOptions.CultureInvariant)]
    private static partial Regex EsPlural();

    [GeneratedRegex("(?:ss|us|sis)$", RegexOptions.CultureInvariant)]
    private static partial Regex SsPlural();
}
