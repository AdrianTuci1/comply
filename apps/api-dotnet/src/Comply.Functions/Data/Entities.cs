using Newtonsoft.Json;

namespace Comply.Functions.Data;

/// <summary>
/// Tenant root. The first registration creates it; every later user joins it.
/// </summary>
public sealed class Organization
{
    [JsonProperty("id")]
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Slug { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }

    [JsonIgnore]
    [System.Text.Json.Serialization.JsonIgnore]
    public List<User> Users { get; set; } = [];

    [JsonIgnore]
    [System.Text.Json.Serialization.JsonIgnore]
    public List<Assessment> Assessments { get; set; } = [];

    [JsonIgnore]
    [System.Text.Json.Serialization.JsonIgnore]
    public List<McpKey> McpKeys { get; set; } = [];
}

public sealed class User
{
    [JsonProperty("id")]
    public string Id { get; set; } = "";
    public string OrganizationId { get; set; } = "";
    public string Email { get; set; } = "";
    public string Name { get; set; } = "";
    public string Role { get; set; } = Roles.Member;

    /// <summary>PBKDF2 hash; null when the account only signs in through an external provider.</summary>
    public string? PasswordHash { get; set; }

    /// <summary>Sign-in methods linked to the account, for example <c>password</c> or <c>google</c>.</summary>
    public List<string> Providers { get; set; } = [];

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? LastLoginAt { get; set; }

    [JsonIgnore]
    [System.Text.Json.Serialization.JsonIgnore]
    public Organization? Organization { get; set; }

    [JsonIgnore]
    [System.Text.Json.Serialization.JsonIgnore]
    public List<ExternalLogin> ExternalLogins { get; set; } = [];
}

public sealed class ExternalLogin
{
    [JsonProperty("id")]
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string Provider { get; set; } = "";
    public string Subject { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }

    [JsonIgnore]
    [System.Text.Json.Serialization.JsonIgnore]
    public User? User { get; set; }
}

public sealed class Assessment
{
    [JsonProperty("id")]
    public string Id { get; set; } = "";
    public string OrganizationId { get; set; } = "";
    public string Framework { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Scope { get; set; }
    public DateOnly? PeriodFrom { get; set; }
    public DateOnly? PeriodTo { get; set; }
    public string Phase { get; set; } = AssessmentPhases.Draft;
    public int Revision { get; set; } = 1;
    public string ContentStatus { get; set; } = ContentStatuses.Draft;
    public string Language { get; set; } = "en";
    public string? CreatedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public DateTimeOffset? ReviewedAt { get; set; }
    public DateTimeOffset? ExportedAt { get; set; }

    [JsonIgnore]
    [System.Text.Json.Serialization.JsonIgnore]
    public Organization? Organization { get; set; }

    public List<AssessmentRequirement> Requirements { get; set; } = [];
    public List<AssessmentEvent> Events { get; set; } = [];
}

public sealed class AssessmentRequirement
{
    [JsonProperty("id")]
    public string Id { get; set; } = "";
    public string AssessmentId { get; set; } = "";
    public string LibraryRequirementId { get; set; } = "";
    public string Ref { get; set; } = "";
    public string Title { get; set; } = "";
    public string? Description { get; set; }
    public string? SourceId { get; set; }
    public string? Theme { get; set; }
    public string Status { get; set; } = RequirementStatuses.Open;
    public string? Conclusion { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
    public int Position { get; set; }

    [JsonIgnore]
    [System.Text.Json.Serialization.JsonIgnore]
    public Assessment? Assessment { get; set; }

    public List<Evidence> Evidence { get; set; } = [];
}

public sealed class Evidence
{
    [JsonProperty("id")]
    public string Id { get; set; } = "";
    public string AssessmentRequirementId { get; set; } = "";
    public string Type { get; set; } = "";
    public string Title { get; set; } = "";
    public string? Source { get; set; }
    public string? Summary { get; set; }

    /// <summary>Where the auditor can verify the artifact: URL, ticket id, or document location.</summary>
    public string? Citation { get; set; }

    /// <summary><c>sha256:&lt;hex&gt;</c> over the evidence identity, composed like the Node agent.</summary>
    public string? Hash { get; set; }

    public string? Url { get; set; }
    public string? CreatedBy { get; set; }

    /// <summary>The Node <c>collectedAt</c> timestamp.</summary>
    public DateTimeOffset CreatedAt { get; set; }

    [JsonIgnore]
    [System.Text.Json.Serialization.JsonIgnore]
    public AssessmentRequirement? AssessmentRequirement { get; set; }
}

public sealed class AssessmentEvent
{
    [JsonProperty("id")]
    public string Id { get; set; } = "";
    public string AssessmentId { get; set; } = "";
    public int Revision { get; set; }
    public string Type { get; set; } = "";
    public string Message { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }

    [JsonIgnore]
    [System.Text.Json.Serialization.JsonIgnore]
    public Assessment? Assessment { get; set; }
}

public sealed class McpKey
{
    [JsonProperty("id")]
    public string Id { get; set; } = "";
    public string OrganizationId { get; set; } = "";
    public string Name { get; set; } = "";
    public string KeyPrefix { get; set; } = "";
    public string KeyHash { get; set; } = "";
    public List<string> Scopes { get; set; } = [];
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? LastUsedAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }

    [JsonIgnore]
    [System.Text.Json.Serialization.JsonIgnore]
    public Organization? Organization { get; set; }
}

public static class Roles
{
    public const string Admin = "admin";
    public const string Member = "member";
}

public static class AssessmentPhases
{
    public const string Draft = "draft";
    public const string Scope = "scope";
    public const string Collect = "collect";
    public const string Review = "review";
    public const string Export = "export";
    public const string Complete = "complete";
}

public static class ContentStatuses
{
    public const string Draft = "draft";

    /// <summary>Every library requirement in the framework is reviewed and published.</summary>
    public const string Published = "published";

    /// <summary>At least one library requirement is still machine-extracted.</summary>
    public const string Extracted = "extracted";
}

public static class RequirementStatuses
{
    public const string Open = "open";
    public const string EvidenceCollected = "evidence_collected";
    public const string Completed = "completed";
    public const string NotApplicable = "not_applicable";
}
