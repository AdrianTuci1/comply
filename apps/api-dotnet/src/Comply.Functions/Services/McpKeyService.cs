using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Comply.Functions.Agent;
using Comply.Functions.Data;
using Microsoft.Extensions.Logging;

namespace Comply.Functions.Services;

/// <summary>A rejected key request. Status and message mirror <c>McpKeyError</c> in keys.mjs.</summary>
public sealed class McpKeyException(string message, int status = 401, string code = "invalid_key")
    : Exception(message)
{
    public int Status { get; } = status;

    public string Code { get; } = code;
}

/// <summary>The public key shape returned by keys.mjs <c>publicKey()</c>; the hash never leaves the database.</summary>
public sealed record McpKeyView(
    string Id,
    string TenantId,
    string Name,
    string Prefix,
    IReadOnlyList<string> Scopes,
    DateTimeOffset CreatedAt,
    DateTimeOffset? LastUsedAt,
    DateTimeOffset? RevokedAt)
{
    public JsonObject ToJson()
    {
        var scopes = new JsonArray();
        foreach (var scope in Scopes) scopes.Add(scope);

        return new JsonObject
        {
            ["id"] = Id,
            ["tenantId"] = TenantId,
            ["name"] = Name,
            ["prefix"] = Prefix,
            ["scopes"] = scopes,
            ["createdAt"] = AgentJson.Timestamp(CreatedAt),
            ["lastUsedAt"] = LastUsedAt is { } lastUsedAt ? AgentJson.Timestamp(lastUsedAt) : null,
            ["revokedAt"] = RevokedAt is { } revokedAt ? AgentJson.Timestamp(revokedAt) : null,
        };
    }
}

public sealed record CreatedMcpKey(McpKeyView Key, string Secret);

/// <summary>An authenticated MCP key together with the organization that owns it.</summary>
public sealed record McpKeyIdentity(McpKey Key, Organization Organization);

/// <summary>
/// MCP credentials, ported from <c>apps/api-node/lib/keys.mjs</c>: the token embeds the tenant
/// slug, but it is only accepted when the SHA-256 hash of the full token is on record and the
/// key is not revoked. Like the Node server, scopes are recorded and returned but not enforced
/// per tool.
/// </summary>
public sealed partial class McpKeyService(
    IComplyStore comply,
    TimeProvider time,
    Func<byte[]>? secretFactory = null,
    ILogger<McpKeyService>? logger = null)
{
    public static readonly IReadOnlyList<string> Scopes = ["read", "evidence:write", "admin"];

    private static readonly TimeSpan LastUsedWriteInterval = TimeSpan.FromMinutes(1);

    private readonly IComplyStore _comply = comply;
    private readonly TimeProvider _time = time;
    private readonly Func<byte[]> _secretFactory =
        secretFactory ?? (() => System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));
    private readonly ILogger<McpKeyService>? _logger = logger;

    public async Task<IReadOnlyList<McpKeyView>> ListAsync(Organization organization, CancellationToken cancellationToken = default)
    {
        var keys = await _comply.ListMcpKeysAsync(organization.Id, cancellationToken);
        return keys
            .OrderByDescending(key => key.CreatedAt)
            .Select(key => View(key, organization))
            .ToList();
    }

    public async Task<CreatedMcpKey> CreateAsync(
        Organization organization,
        string? name,
        JsonNode? scopes,
        CancellationToken cancellationToken = default)
    {
        var label = (name ?? "").Trim();
        if (label.Length == 0)
        {
            throw new McpKeyException("The key needs a name.", 400, "invalid_name");
        }

        var permissions = NormalizeScopes(scopes);
        var secret = $"sk_mcp_{organization.Slug}_{Convert.ToHexString(_secretFactory()).ToLowerInvariant()}";
        var now = _time.GetUtcNow();

        var key = new McpKey
        {
            Id = $"key-{Guid.NewGuid()}",
            OrganizationId = organization.Id,
            Name = label,
            KeyPrefix = secret[..^(64 - 6)],
            KeyHash = AgentText.Sha256Hex(secret),
            Scopes = permissions,
            CreatedAt = now,
        };

        await _comply.AddMcpKeyAsync(key, cancellationToken);
        _logger?.LogInformation("Created an MCP key for {Slug}.", organization.Slug);

        return new CreatedMcpKey(View(key, organization), secret);
    }

    /// <summary>Revocation is idempotent; a key from another tenant is reported as not found.</summary>
    public async Task<McpKeyView> RevokeAsync(
        Organization organization,
        string keyId,
        CancellationToken cancellationToken = default)
    {
        var key = await _comply.FindMcpKeyByIdAsync(organization.Id, keyId, cancellationToken);

        if (key is null)
        {
            throw new McpKeyException("The key was not found.", 404, "not_found");
        }

        if (key.RevokedAt is null)
        {
            key.RevokedAt = _time.GetUtcNow();
            await _comply.SaveMcpKeyAsync(key, cancellationToken);
        }

        return View(key, organization);
    }

    /// <summary>
    /// Resolves a bearer token to its key and organization. The lookup is a single equality match
    /// on the indexed hash, so a forged token never compares prefixes or scans tenants.
    /// </summary>
    public async Task<McpKeyIdentity?> AuthenticateAsync(string? token, CancellationToken cancellationToken = default)
    {
        var match = TokenPattern().Match(token ?? "");
        if (!match.Success) return null;

        var tenant = match.Groups["tenant"].Value;
        var hash = AgentText.Sha256Hex(token!);

        var key = await _comply.FindMcpKeyByHashAsync(hash, cancellationToken);
        if (key is null || key.RevokedAt is not null) return null;

        var organization = await _comply.FindOrganizationByIdAsync(key.OrganizationId, cancellationToken);
        if (organization is null || !string.Equals(organization.Slug, tenant, StringComparison.Ordinal))
        {
            return null;
        }

        var now = _time.GetUtcNow();
        if (key.LastUsedAt is null || now - key.LastUsedAt.Value > LastUsedWriteInterval)
        {
            key.LastUsedAt = now;
            await _comply.SaveMcpKeyAsync(key, cancellationToken);
        }

        return new McpKeyIdentity(key, organization);
    }

    private static McpKeyView View(McpKey key, Organization organization) => new(
        key.Id,
        organization.Slug,
        key.Name,
        key.KeyPrefix,
        key.Scopes,
        key.CreatedAt,
        key.LastUsedAt,
        key.RevokedAt);

    private static List<string> NormalizeScopes(JsonNode? node)
    {
        var scopes = new List<string>();
        if (node is JsonArray array)
        {
            foreach (var entry in array)
            {
                var value = entry switch
                {
                    JsonValue scalar when scalar.TryGetValue<string>(out var text) => text,
                    null => "null",
                    _ => entry.ToJsonString(),
                };
                if (!scopes.Contains(value, StringComparer.Ordinal)) scopes.Add(value);
            }
        }

        if (scopes.Count == 0)
        {
            throw new McpKeyException("Choose at least one permission for the key.", 400, "invalid_scopes");
        }

        var invalid = scopes.FirstOrDefault(scope => !Scopes.Contains(scope, StringComparer.Ordinal));
        if (invalid is not null)
        {
            throw new McpKeyException($"Unknown access scope: {invalid}.", 400, "invalid_scopes");
        }

        return scopes;
    }

    [GeneratedRegex(@"^sk_mcp_(?<tenant>[a-z0-9][a-z0-9-]{1,39})_[a-f0-9]{64}$", RegexOptions.CultureInvariant)]
    private static partial Regex TokenPattern();
}
