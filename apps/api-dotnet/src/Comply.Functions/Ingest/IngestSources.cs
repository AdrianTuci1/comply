using Comply.Functions.Models;

namespace Comply.Functions.Ingest;

/// <summary>
/// Source and document identities from the Node ingestors. Only the two public HTML sources have
/// connectors; ISO/IEC 27001 and SOC 2 stay client-supplied.
/// </summary>
public static class IngestSources
{
    public const string Nis2SourceId = "src-nis2-2022-2555";
    public const string Nis2DocumentId = "doc-nis2-2022-2555";
    public const string Nis2FrameworkId = "nis2";
    public const string Nis2Title = "Directive (EU) 2022/2555 (NIS2)";
    public const string Nis2Version = "2024.1.0";
    public const string Nis2IndexUrl = "https://www.nis-2-directive.com/NIS_2_Directive_Articles.html";
    public const string Nis2OfficialUrl = "https://eur-lex.europa.eu/eli/dir/2022/2555/oj/eng";

    public const string AiActSourceId = "src-ai-act-2024-1689";
    public const string AiActDocumentId = "doc-ai-act-2024-1689";
    public const string AiActFrameworkId = "ai-act";
    public const string AiActTitle = "Regulation (EU) 2024/1689 (AI Act)";
    public const string AiActVersion = "2026.1.0";
    public const string AiActIndexUrl = "https://artificialintelligenceact.eu/ai-act-explorer/";
    public const string AiActOfficialUrl = "https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng";

    /// <summary>Order matters: <c>POST /api/ingest {framework:"all"}</c> runs these in turn.</summary>
    public static IReadOnlyList<string> IngestableFrameworks { get; } = ["ai-act", "nis2"];

    public static bool IsIngestable(string? frameworkId) =>
        frameworkId is not null && IngestableFrameworks.Contains(frameworkId, StringComparer.Ordinal);

    public static SourceRecord AiAct(string fetchedAt) => new()
    {
        Id = AiActSourceId,
        FrameworkId = AiActFrameworkId,
        Title = AiActTitle,
        Publisher = "European Union",
        Version = AiActVersion,
        Kind = "html",
        License = "public",
        ImportedAt = fetchedAt,
        LastReviewedAt = null,
    };

    public static SourceRecord Nis2(string fetchedAt) => new()
    {
        Id = Nis2SourceId,
        FrameworkId = Nis2FrameworkId,
        Title = Nis2Title,
        Publisher = "European Union",
        Version = Nis2Version,
        Kind = "html",
        License = "public",
        ImportedAt = fetchedAt,
        LastReviewedAt = null,
    };
}
