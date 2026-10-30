using System.Text.RegularExpressions;
using Comply.Functions.Auth;
using Comply.Functions.Data;
using Comply.Functions.Services;
using Microsoft.AspNetCore.Http;

namespace Comply.Functions.Api;

/// <summary>A rejected tenant resolution, carrying the HTTP status the API returns.</summary>
public sealed class TenantException(string message, int status) : Exception(message)
{
    public int Status { get; } = status;
}

/// <summary>The organization a request is allowed to read and write.</summary>
public sealed record TenantScope(Organization Organization, McpKeyIdentity? Key = null, bool FromSession = false)
{
    public string OrganizationId => Organization.Id;

    public string Slug => Organization.Slug;
}

/// <summary>
/// Single tenant-resolution service for <c>/api/agent</c>, <c>/api/access/keys</c> and
/// <c>/mcp</c>. Order of precedence:
/// <list type="number">
/// <item>MCP bearer key: the key's organization, after rejecting a conflicting <c>x-comply-tenant</c>.</item>
/// <item>Session bearer or <c>comply_session</c> cookie: the user's organization. The header is ignored,
/// so an authenticated session can never be moved to another tenant.</item>
/// <item>Outside production (the <see cref="AuthSettings.DevLinks"/> semantics): the
/// <c>x-comply-tenant</c> slug, otherwise the first organization.</item>
/// </list>
/// In production a request with no session and no key gets <c>401 {"error":"Not signed in."}</c>.
/// </summary>
public sealed partial class TenantContext(
    AuthTokenService tokens,
    UserDirectory users,
    McpKeyService keys,
    AuthSettings settings,
    IComplyStore comply)
{
    private readonly AuthTokenService _tokens = tokens;
    private readonly UserDirectory _users = users;
    private readonly McpKeyService _keys = keys;
    private readonly AuthSettings _settings = settings;
    private readonly IComplyStore _comply = comply;

    public async Task<TenantScope> ResolveAsync(HttpRequest request, CancellationToken cancellationToken = default)
    {
        if (!_comply.IsConfigured)
        {
            throw new TenantException("The database is not configured for this deployment.", 503);
        }

        var token = SessionToken.From(request);
        if (!string.IsNullOrEmpty(token))
        {
            var identity = await _keys.AuthenticateAsync(token, cancellationToken);
            if (identity is not null)
            {
                var header = TenantHeader(request);
                if (header is not null && !string.Equals(header, identity.Organization.Slug, StringComparison.Ordinal))
                {
                    throw new TenantException(
                        "The tenant header does not match the tenant in the MCP key.",
                        403);
                }

                return new TenantScope(identity.Organization, identity);
            }

            var payload = _tokens.Verify(token);
            if (payload?.Kind == TokenKind.Session && payload.Email is not null)
            {
                var user = await _users.FindByEmailAsync(payload.Email, cancellationToken);
                if (user?.Organization is not null)
                {
                    return new TenantScope(user.Organization, FromSession: true);
                }
            }
        }

        if (_settings.DevLinks)
        {
            var header = TenantHeader(request);
            var organization = header is null
                ? null
                : await _users.FindOrganizationBySlugAsync(header, cancellationToken);
            organization ??= await _users.FirstOrganizationAsync(cancellationToken);
            if (organization is not null)
            {
                return new TenantScope(organization);
            }
        }

        throw new TenantException("Not signed in.", 401);
    }

    private static string? TenantHeader(HttpRequest request)
    {
        var value = request.Headers["x-comply-tenant"].ToString().Trim();
        return value.Length > 0 && TenantSlug().IsMatch(value) ? value : null;
    }

    [GeneratedRegex("^[a-z0-9][a-z0-9-]{1,39}$", RegexOptions.CultureInvariant)]
    private static partial Regex TenantSlug();
}
