using Comply.Functions.Models;

namespace Comply.Functions.Tests;

internal static class Fixtures
{
    public const string AiActSourceId = "src-ai-act-2024-1689";
    public const string Nis2SourceId = "src-nis2-2022-2555";
    public const string AiActDocumentId = "doc-ai-act-2024-1689";
    public const string Nis2DocumentId = "doc-nis2-2022-2555";
    public const string AiActFetchedAt = "2026-10-29T19:00:56.711Z";
    public const string Nis2FetchedAt = "2026-10-29T19:00:57.977Z";

    public static ContentLibrary Library() => new()
    {
        Version = 1,
        UpdatedAt = "2026-10-30T00:00:00.000Z",
        Sources =
        [
            new SourceRecord
            {
                Id = AiActSourceId,
                FrameworkId = "ai-act",
                Title = "Regulation (EU) 2024/1689 (AI Act)",
                Publisher = "European Union",
                Version = "2026.1.0",
                Kind = "html",
                License = "public",
                ImportedAt = AiActFetchedAt,
                LastReviewedAt = null,
            },
            new SourceRecord
            {
                Id = Nis2SourceId,
                FrameworkId = "nis2",
                Title = "Directive (EU) 2022/2555 (NIS2)",
                Publisher = "European Union",
                Version = "2024.1.0",
                Kind = "html",
                License = "public",
                ImportedAt = Nis2FetchedAt,
                LastReviewedAt = null,
            },
        ],
        Requirements =
        [
            Requirement("req-ai-1", AiActSourceId, "ai-act", "Art. 1", "Subject matter",
                "This Regulation lays down harmonised rules for AI systems.", "organizational", "draft"),
            Requirement("req-ai-2", AiActSourceId, "ai-act", "Art. 2", "Transparency",
                "Providers must disclose transparency information to deployers.", "transparency", "published"),
            Requirement("req-nis-1", Nis2SourceId, "nis2", "Art. 1", "Scope",
                "This Directive applies to essential and important entities.", "organizational", "draft"),
            Requirement("req-nis-2", Nis2SourceId, "nis2", "Art. 21", "Governance",
                "Member States shall ensure governance requirements are met.", "governance", "published"),
        ],
        Documents =
        [
            new DocumentMetadata
            {
                Id = AiActDocumentId,
                SourceId = AiActSourceId,
                FrameworkId = "ai-act",
                Title = "Regulation (EU) 2024/1689 (AI Act)",
                Url = "https://artificialintelligenceact.eu/ai-act-explorer/",
                OfficialUrl = "https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng",
                Publisher = "European Union",
                License = "public",
                FetchedAt = AiActFetchedAt,
                Sha256 = "896697b2308f51a718182d0cbb185ceaa929233f51fb29eccc67dbf05853e24f",
                Bytes = 338305,
            },
            new DocumentMetadata
            {
                Id = Nis2DocumentId,
                SourceId = Nis2SourceId,
                FrameworkId = "nis2",
                Title = "Directive (EU) 2022/2555 (NIS2)",
                Url = "https://www.nis-2-directive.com/NIS_2_Directive_Articles.html",
                OfficialUrl = "https://eur-lex.europa.eu/eli/dir/2022/2555/oj/eng",
                Publisher = "European Union",
                License = "public",
                FetchedAt = Nis2FetchedAt,
                Sha256 = "d0fb2f890d7ad4fe3c40fd16206b5dfc1e71c0b00abbf022ca8eb3b7d5775f90",
                Bytes = 118621,
            },
        ],
    };

    private static Requirement Requirement(
        string id,
        string sourceId,
        string frameworkId,
        string reference,
        string title,
        string text,
        string theme,
        string status) => new()
    {
        Id = id,
        SourceId = sourceId,
        FrameworkId = frameworkId,
        Ref = reference,
        Title = title,
        Text = text,
        Theme = theme,
        Status = status,
        Reviewer = null,
        ReviewedAt = null,
        CreatedAt = AiActFetchedAt,
    };
}
