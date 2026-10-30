using Comply.Functions.Models;

namespace Comply.Functions.Services;

/// <summary>
/// Framework registry from <c>apps/api-node/lib/ingest/index.mjs</c> and the summary counts
/// returned by <c>GET /api/frameworks</c>.
/// </summary>
public static class FrameworkCatalog
{
    public static IReadOnlyList<FrameworkRegistration> Frameworks { get; } =
    [
        new FrameworkRegistration(
            FrameworkId: "ai-act",
            Title: "Regulation (EU) 2024/1689 (AI Act)",
            Publisher: "European Union",
            Version: "2026.1.0",
            License: "public",
            IndexUrl: "https://artificialintelligenceact.eu/ai-act-explorer/",
            OfficialUrl: "https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng",
            Connector: "ai-act"),
        new FrameworkRegistration(
            FrameworkId: "nis2",
            Title: "Directive (EU) 2022/2555 (NIS2)",
            Publisher: "European Union",
            Version: "2024.1.0",
            License: "public",
            IndexUrl: "https://www.nis-2-directive.com/NIS_2_Directive_Articles.html",
            OfficialUrl: "https://eur-lex.europa.eu/eli/dir/2022/2555/oj/eng",
            Connector: "nis2"),
        new FrameworkRegistration(
            FrameworkId: "iso27001",
            Title: "ISO/IEC 27001:2022",
            Publisher: "ISO/IEC",
            Version: "2022.1.0",
            License: "proprietary",
            IndexUrl: null,
            OfficialUrl: "https://www.iso.org/standard/27001",
            Connector: null),
        new FrameworkRegistration(
            FrameworkId: "soc2",
            Title: "SOC 2",
            Publisher: "AICPA",
            Version: "2022.1.0",
            License: "proprietary",
            IndexUrl: null,
            OfficialUrl: "https://www.aicpa-cima.com/topic/audit-assurance/audit-and-assurance-greater-than-soc-2",
            Connector: null),
    ];

    public static IReadOnlyList<FrameworkSummary> Summarize(ContentLibrary library) =>
        Frameworks.Select(registration => Summarize(registration, library)).ToList();

    private static FrameworkSummary Summarize(FrameworkRegistration registration, ContentLibrary library)
    {
        var source = library.Sources.FirstOrDefault(item => item.FrameworkId == registration.FrameworkId);

        List<Requirement> requirements = source?.Id is null
            ? []
            : library.Requirements.Where(item => item.SourceId == source.Id).ToList();

        var documents = library.Documents
            .Where(item => item.FrameworkId == registration.FrameworkId)
            .ToList();

        return new FrameworkSummary(
            registration.FrameworkId,
            registration.Title,
            registration.Publisher,
            registration.Version,
            registration.License,
            registration.IndexUrl,
            registration.OfficialUrl,
            registration.Connector,
            SourceId: source?.Id,
            Requirements: requirements.Count,
            Published: requirements.Count(item => item.Status == "published"),
            Documents: documents.Count,
            LastFetchedAt: documents.FirstOrDefault()?.FetchedAt);
    }
}
