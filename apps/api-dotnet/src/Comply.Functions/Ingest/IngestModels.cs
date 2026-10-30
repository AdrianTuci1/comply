using System.Globalization;
using System.Text;
using System.Security.Cryptography;
using Comply.Functions.Models;

namespace Comply.Functions.Ingest;

/// <summary>One article as extracted from a source page, before document metadata is attached.</summary>
public sealed record ParsedPage(
    string Number,
    string Url,
    string Title,
    string Text,
    IReadOnlyList<ParsedRequirement> Requirements);

/// <summary>An extracted control with its display theme already resolved.</summary>
public sealed record ParsedRequirement(string Ref, string Title, string Text, string Theme);

/// <summary>Index entry discovered on a table-of-contents page.</summary>
public sealed record DiscoveredArticle(string Number, string Url, string Title);

/// <summary>Per-article snapshot stored in <c>documents/&lt;id&gt;.json</c>.</summary>
public sealed class IngestedPage
{
    public string? Ref { get; init; }

    public string? Title { get; init; }

    public string? Url { get; init; }

    public string? Text { get; init; }
}

/// <summary>
/// Full captured document. Property order mirrors the Node object so the written JSON stays
/// familiar: identifying fields, provenance, hash, then the per-article pages.
/// </summary>
public sealed class IngestDocument
{
    public string Id { get; init; } = string.Empty;

    public string SourceId { get; init; } = string.Empty;

    public string FrameworkId { get; init; } = string.Empty;

    public string Title { get; init; } = string.Empty;

    public string Url { get; init; } = string.Empty;

    public string OfficialUrl { get; init; } = string.Empty;

    public string Publisher { get; init; } = string.Empty;

    public string License { get; init; } = string.Empty;

    public string FetchedAt { get; init; } = string.Empty;

    public string Sha256 { get; init; } = string.Empty;

    public long Bytes { get; init; }

    public IReadOnlyList<IngestedPage> Pages { get; init; } = [];

    /// <summary>
    /// Library metadata for this document. The page snapshots stay out of
    /// <c>library.json</c>; <c>GET /api/documents/{id}</c> serves them from the document file.
    /// </summary>
    public DocumentMetadata ToMetadata() => new()
    {
        Id = Id,
        SourceId = SourceId,
        FrameworkId = FrameworkId,
        Title = Title,
        Url = Url,
        OfficialUrl = OfficialUrl,
        Publisher = Publisher,
        License = License,
        FetchedAt = FetchedAt,
        Sha256 = Sha256,
        Bytes = Bytes,
    };
}

/// <summary>Output of one ingestor: the source record, the captured document and its requirements.</summary>
public sealed class IngestResult
{
    public required SourceRecord Source { get; init; }

    public required IngestDocument Document { get; init; }

    public required IReadOnlyList<Requirement> Requirements { get; init; }
}

/// <summary>Summary written into the job log after a successful apply.</summary>
public sealed record IngestApplyResult(SourceRecord Source, int Added, DocumentMetadata Document);

/// <summary>Options shared by both ingestors; mirrors the Node destructured arguments.</summary>
public sealed class IngestOptions
{
    internal const int DefaultConcurrency = 4;

    public string? FetchedAt { get; init; }

    public int Concurrency { get; init; } = DefaultConcurrency;

    public Action<string>? Log { get; init; }

    public ITextFetcher? Fetcher { get; init; }

    public TimeProvider? Time { get; init; }

    public string ResolveFetchedAt() =>
        string.IsNullOrEmpty(FetchedAt) ? IngestTime.Timestamp((Time ?? TimeProvider.System).GetUtcNow()) : FetchedAt;

    public ITextFetcher ResolveFetcher() => Fetcher ?? HttpTextFetcher.Shared;

    public int ResolveConcurrency() => Concurrency < 1 ? DefaultConcurrency : Concurrency;
}

/// <summary>Content ingest failures carry the Node error strings so job errors stay comparable.</summary>
public sealed class IngestException(string message) : Exception(message);

public static class IngestTime
{
    /// <summary>Same shape as <c>new Date().toISOString()</c>: UTC, millisecond precision, trailing Z.</summary>
    public static string Timestamp(DateTimeOffset value) =>
        value.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
}

public static class IngestHash
{
    /// <summary>Lowercase hex SHA-256 of the UTF-8 text, like <c>createHash("sha256").update(text)</c>.</summary>
    public static string Sha256Hex(string text) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text))).ToLowerInvariant();

    public static long Utf8Bytes(string text) => Encoding.UTF8.GetByteCount(text);
}
