namespace Comply.Functions.Auth;

/// <summary>Public account shape returned to the Angular client (Node <c>publicUser</c>).</summary>
public sealed record UserView(string Email, string Name, string OrganizationName, string Role);

/// <summary>Response body of login/register/verify/exchange.</summary>
public sealed record SessionResult(string Session, string ExpiresAt, UserView User);

public sealed record ProvidersResult(
    bool Password,
    IReadOnlyList<ProviderView> Providers,
    bool Demo,
    bool SetupRequired);

public sealed record MagicLinkResult(string Email, string ExpiresAt, string Token);

public sealed record RegisterRequest(
    string? Email,
    string? Name,
    string? Password,
    string? OrganizationName);

public sealed record ProviderView(string Id, string Label, string Kind);

/// <summary>Auth fields reported by <c>GET /api/runtime</c> and <c>GET /api/auth/providers</c>.</summary>
public sealed record RuntimeAuthInfo(
    bool PasswordLogin,
    IReadOnlyList<ProviderView> Providers,
    bool SetupRequired);

/// <summary>Identity resolved from an external provider before the account is linked.</summary>
public sealed record OidcIdentity(string Provider, string Subject, string Email, string? Name);
