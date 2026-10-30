using System.Text.Json.Nodes;
using Comply.Functions.Auth;

namespace Comply.Functions.Models;

/// <summary>
/// Response body of <c>GET /api/library</c>: the library plus the paging envelope the
/// Node API adds. Property order matches the Node response.
/// </summary>
public sealed record LibraryResponse(
    int Version,
    string? UpdatedAt,
    IReadOnlyList<SourceRecord> Sources,
    IReadOnlyList<Requirement> Requirements,
    IReadOnlyList<DocumentMetadata> Documents,
    int Total,
    int Page,
    int PageSize);

public sealed record FrameworkList(IReadOnlyList<FrameworkSummary> Frameworks);

public sealed record DocumentList(IReadOnlyList<DocumentMetadata> Documents);

public sealed record DocumentEnvelope(JsonNode Document);

public sealed record HealthStatus(string Status, string Time);

public sealed record RuntimeInfo(
    string Deployment,
    string PublicUrl,
    RuntimeTrust Trust,
    bool PasswordLogin,
    IReadOnlyList<ProviderView> Providers,
    bool SetupRequired);

public sealed record RuntimeTrust(string? Host, string? Slug, string ManagedHost);

/// <summary>Source registry entry from the Node ingest module.</summary>
public sealed record FrameworkRegistration(
    string FrameworkId,
    string Title,
    string Publisher,
    string Version,
    string License,
    string? IndexUrl,
    string OfficialUrl,
    string? Connector);

/// <summary>Registry entry plus the counts returned by <c>GET /api/frameworks</c>.</summary>
public sealed record FrameworkSummary(
    string FrameworkId,
    string Title,
    string Publisher,
    string Version,
    string License,
    string? IndexUrl,
    string OfficialUrl,
    string? Connector,
    string? SourceId,
    int Requirements,
    int Published,
    int Documents,
    string? LastFetchedAt);

public sealed record ErrorBody(
    string Error,
    [property: System.Text.Json.Serialization.JsonIgnore(
        Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]
    string? Code = null);
