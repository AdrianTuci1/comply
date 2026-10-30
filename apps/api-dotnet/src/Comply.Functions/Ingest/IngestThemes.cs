namespace Comply.Functions.Ingest;

/// <summary>
/// Display themes from <c>apps/api-node/lib/ingest/themes.mjs</c>. NIS2 picks by keyword in
/// declared rule order; the AI Act uses article ranges. Both fall back to "organizational".
/// </summary>
public static class IngestThemes
{
    private static readonly (string Theme, string[] Keywords)[] Nis2Rules =
    [
        ("organizational", ["risk", "governance", "management body", "policy", "supply chain", "supplier"]),
        ("procedures", ["incident", "continuity", "backup", "disaster", "crisis", "report", "audit"]),
        ("infrastructure",
        [
            "network", "system", "vulnerability", "patch", "access", "cryptograph", "authentication", "logging",
        ]),
        ("product", ["acquisition", "development", "maintenance", "testing", "certification"]),
        ("data_privacy", ["data", "privacy", "confidential", "personal"]),
    ];

    private static readonly (int From, int To, string Theme)[] AiActRanges =
    [
        (5, 5, "organizational"),
        (6, 7, "organizational"),
        (8, 15, "product"),
        (16, 27, "organizational"),
        (28, 39, "procedures"),
        (40, 49, "organizational"),
        (50, 50, "data_privacy"),
        (51, 56, "organizational"),
        (57, 63, "procedures"),
        (64, 68, "organizational"),
        (69, 70, "organizational"),
        (71, 72, "procedures"),
        (73, 79, "organizational"),
        (80, 84, "procedures"),
        (85, 95, "organizational"),
        (96, 101, "organizational"),
        (102, 110, "organizational"),
        (111, 113, "organizational"),
    ];

    public static string Nis2(string text)
    {
        var haystack = (text ?? string.Empty).ToLowerInvariant();

        foreach (var (theme, keywords) in Nis2Rules)
        {
            foreach (var keyword in keywords)
            {
                if (haystack.Contains(keyword, StringComparison.Ordinal)) return theme;
            }
        }

        return "organizational";
    }

    public static string AiAct(string articleNumber)
    {
        if (!LeadingNumber.TryParse(articleNumber, out var number)) return "organizational";

        foreach (var (from, to, theme) in AiActRanges)
        {
            if (number >= from && number <= to) return theme;
        }

        return "organizational";
    }
}
