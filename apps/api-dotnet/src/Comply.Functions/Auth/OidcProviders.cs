namespace Comply.Functions.Auth;

/// <summary>
/// One configured sign-in provider. Google, Microsoft and the generic OIDC provider use the
/// OpenID Connect code flow; GitHub uses OAuth2 and supplies the email through its REST API.
/// </summary>
public sealed record OidcProvider(
    string Id,
    string Label,
    string Kind,
    string Issuer,
    string AuthorizationEndpoint,
    string TokenEndpoint,
    string JwksUri,
    string? UserInfoEndpoint,
    string ClientId,
    string ClientSecret,
    IReadOnlyList<string> Scopes)
{
    public const string Oidc = "oidc";
    public const string OAuth2 = "oauth2";

    public bool IsOidc => Kind == Oidc;

    public ProviderView ToView() => new(Id, Label, Kind);
}

/// <summary>
/// Builds the provider list from environment variables. A provider is offered only when both
/// credentials and endpoints are present, so a half-configured provider never appears.
/// </summary>
public static class OidcProviderCatalog
{
    public const string GoogleId = "google";
    public const string MicrosoftId = "microsoft";
    public const string GitHubId = "github";

    private static readonly string[] OidcScopes = ["openid", "email", "profile"];

    public static IReadOnlyList<OidcProvider> FromEnvironment() =>
        FromLookup(Environment.GetEnvironmentVariable);

    public static IReadOnlyList<OidcProvider> FromLookup(Func<string, string?> get)
    {
        string? Value(string name)
        {
            var value = get(name)?.Trim();
            return string.IsNullOrEmpty(value) ? null : value;
        }

        var providers = new List<OidcProvider>();

        providers.Add(new OidcProvider(
            GoogleId,
            "Google",
            OidcProvider.Oidc,
            "https://accounts.google.com",
            "https://accounts.google.com/o/oauth2/v2/auth",
            "https://oauth2.googleapis.com/token",
            "https://www.googleapis.com/oauth2/v3/certs",
            "https://openidconnect.googleapis.com/v1/userinfo",
            Value("COMPLY_OIDC_GOOGLE_CLIENT_ID") ?? "",
            Value("COMPLY_OIDC_GOOGLE_CLIENT_SECRET") ?? "",
            OidcScopes));

        var tenant = Value("COMPLY_OIDC_MICROSOFT_TENANT") ?? "common";
        providers.Add(new OidcProvider(
            MicrosoftId,
            "Microsoft",
            OidcProvider.Oidc,
            $"https://login.microsoftonline.com/{tenant}/v2.0",
            $"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize",
            $"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
            $"https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys",
            null,
            Value("COMPLY_OIDC_MICROSOFT_CLIENT_ID") ?? "",
            Value("COMPLY_OIDC_MICROSOFT_CLIENT_SECRET") ?? "",
            OidcScopes));

        providers.Add(new OidcProvider(
            GitHubId,
            "GitHub",
            OidcProvider.OAuth2,
            "",
            "https://github.com/login/oauth/authorize",
            "https://github.com/login/oauth/access_token",
            "",
            null,
            Value("COMPLY_OIDC_GITHUB_CLIENT_ID") ?? "",
            Value("COMPLY_OIDC_GITHUB_CLIENT_SECRET") ?? "",
            ["read:user", "user:email"]));

        providers.Add(new OidcProvider(
            Value("COMPLY_OIDC_ID") ?? "sso",
            Value("COMPLY_OIDC_LABEL") ?? "Single sign-on",
            OidcProvider.Oidc,
            Value("COMPLY_OIDC_ISSUER") ?? "",
            Value("COMPLY_OIDC_AUTHORIZATION_ENDPOINT") ?? "",
            Value("COMPLY_OIDC_TOKEN_ENDPOINT") ?? "",
            Value("COMPLY_OIDC_JWKS_URI") ?? "",
            Value("COMPLY_OIDC_USERINFO_ENDPOINT"),
            Value("COMPLY_OIDC_CLIENT_ID") ?? "",
            Value("COMPLY_OIDC_CLIENT_SECRET") ?? "",
            OidcScopes));

        return providers
            .Where(provider =>
                provider.ClientId.Length > 0
                && provider.ClientSecret.Length > 0
                && provider.AuthorizationEndpoint.Length > 0
                && provider.TokenEndpoint.Length > 0
                && (provider.Kind == OidcProvider.OAuth2 || provider.JwksUri.Length > 0))
            .ToList();
    }
}

public sealed class OidcException(string message, int status = 400) : Exception(message)
{
    public int Status { get; } = status;
}
