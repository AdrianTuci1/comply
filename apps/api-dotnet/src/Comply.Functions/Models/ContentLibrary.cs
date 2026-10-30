using System.Text.Json;
using System.Text.Json.Serialization;

namespace Comply.Functions.Models;

/// <summary>
/// Mirrors the shape of <c>data/library.json</c>. Unknown members round-trip through
/// <see cref="AdditionalProperties"/> so the API never silently drops content fields.
/// </summary>
public sealed class ContentLibrary
{
    public int Version { get; set; } = 1;

    public string? UpdatedAt { get; set; }

    public List<SourceRecord> Sources { get; set; } = [];

    public List<Requirement> Requirements { get; set; } = [];

    public List<DocumentMetadata> Documents { get; set; } = [];

    [JsonExtensionData]
    public Dictionary<string, JsonElement>? AdditionalProperties { get; set; }
}

public sealed class SourceRecord
{
    public string? Id { get; set; }

    public string? FrameworkId { get; set; }

    public string? Title { get; set; }

    public string? Publisher { get; set; }

    public string? Version { get; set; }

    public string? Kind { get; set; }

    public string? License { get; set; }

    public string? ImportedAt { get; set; }

    public string? LastReviewedAt { get; set; }

    [JsonExtensionData]
    public Dictionary<string, JsonElement>? AdditionalProperties { get; set; }
}

public sealed class Requirement
{
    public string? Id { get; set; }

    public string? SourceId { get; set; }

    public string? FrameworkId { get; set; }

    public string? Ref { get; set; }

    public string? Title { get; set; }

    public string? Text { get; set; }

    public string? Theme { get; set; }

    public string? Status { get; set; }

    public string? Reviewer { get; set; }

    public string? ReviewedAt { get; set; }

    public string? CreatedAt { get; set; }

    [JsonExtensionData]
    public Dictionary<string, JsonElement>? AdditionalProperties { get; set; }
}

/// <summary>
/// Document metadata as stored on the library. The full captured document lives in
/// <c>data/documents/&lt;id&gt;.json</c> and is served unmodeled.
/// </summary>
public sealed class DocumentMetadata
{
    public string? Id { get; set; }

    public string? SourceId { get; set; }

    public string? FrameworkId { get; set; }

    public string? Title { get; set; }

    public string? Url { get; set; }

    public string? OfficialUrl { get; set; }

    public string? Publisher { get; set; }

    public string? License { get; set; }

    public string? FetchedAt { get; set; }

    public string? Sha256 { get; set; }

    public long Bytes { get; set; }

    [JsonExtensionData]
    public Dictionary<string, JsonElement>? AdditionalProperties { get; set; }
}
