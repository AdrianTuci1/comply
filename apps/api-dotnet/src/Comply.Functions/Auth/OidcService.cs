using System.Collections.Concurrent;
using System.IdentityModel.Tokens.Jwt;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;

namespace Comply.Functions.Auth;

public sealed record OidcCallback(string? Code, string? State, string? Error);

/// <summary>
/// Authorization-code sign-in for the configured providers. OIDC providers get state, nonce,
/// PKCE S256 and an ID token validated against the provider JWKS; GitHub uses OAuth2 plus its
/// user/email REST endpoints.
/// </summary>
public sealed partial class OidcService
{
    private const string GitHubUserEndpoint = "https://api.github.com/user";
    private const string GitHubEmailsEndpoint = "https://api.github.com/user/emails";

    private static readonly TimeSpan JwksTtl = TimeSpan.FromHours(1);

    private readonly IReadOnlyList<OidcProvider> _providers;
    private readonly AuthTokenService _tokens;
    private readonly HttpClient _http;
    private readonly TimeProvider _time;
    private readonly ILogger<OidcService>? _logger;
    private readonly ConcurrentDictionary<string, ConfigurationManager<OpenIdConnectConfiguration>> _managers = new();
    private readonly ConcurrentDictionary<string, (IReadOnlyCollection<SecurityKey> Keys, DateTimeOffset ExpiresAt)> _jwks = new();

    public OidcService(
        IReadOnlyList<OidcProvider> providers,
        AuthTokenService tokens,
        HttpClient http,
        TimeProvider time,
        ILogger<OidcService>? logger = null)
    {
        _providers = providers;
        _tokens = tokens;
        _http = http;
        _time = time;
        _logger = logger;
    }

    public IReadOnlyList<ProviderView> PublicList =>
        _providers.Select(provider => provider.ToView()).ToList();

    public bool IsConfigured => _providers.Count > 0;

    public OidcProvider? Find(string providerId) =>
        _providers.FirstOrDefault(provider => provider.Id == providerId);

    /// <summary>Builds the provider authorization URL and embeds PKCE/nonce in the signed state.</summary>
    public string Begin(string providerId, string origin)
    {
        var provider = Require(providerId);

        var verifier = Base64Url(RandomNumberGenerator.GetBytes(32));
        var challenge = Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));
        var nonce = Base64Url(RandomNumberGenerator.GetBytes(16));
        var state = _tokens.SignState(provider.Id, verifier, nonce);

        var parameters = new List<KeyValuePair<string, string>>
        {
            new("client_id", provider.ClientId),
            new("redirect_uri", CallbackUrl(provider, origin)),
            new("response_type", "code"),
            new("scope", string.Join(' ', provider.Scopes)),
            new("state", state),
        };

        if (provider.IsOidc)
        {
            parameters.Add(new("nonce", nonce));
            parameters.Add(new("code_challenge", challenge));
            parameters.Add(new("code_challenge_method", "S256"));
        }

        var separator = provider.AuthorizationEndpoint.Contains('?') ? "&" : "?";
        var query = string.Join(
            '&',
            parameters.Select(parameter =>
                $"{Uri.EscapeDataString(parameter.Key)}={Uri.EscapeDataString(parameter.Value)}"));
        return $"{provider.AuthorizationEndpoint}{separator}{query}";
    }

    public async Task<OidcIdentity> CompleteAsync(
        string providerId,
        OidcCallback callback,
        string origin,
        CancellationToken cancellationToken)
    {
        var provider = Require(providerId);

        if (!string.IsNullOrEmpty(callback.Error))
        {
            throw new OidcException(ProviderErrorMessage(callback.Error));
        }

        if (string.IsNullOrEmpty(callback.Code))
        {
            throw new OidcException("The provider did not return an authorization code.");
        }

        var state = _tokens.Verify(callback.State);
        if (state is null || state.Kind != TokenKind.OidcState || state.Provider != provider.Id)
        {
            throw new OidcException("The sign-in request expired. Start again.");
        }

        var tokens = await ExchangeCodeAsync(
            provider,
            callback.Code,
            state.Verifier!,
            CallbackUrl(provider, origin),
            cancellationToken);

        return provider.IsOidc
            ? await OidcIdentityAsync(provider, tokens, state.Nonce!, cancellationToken)
            : await GitHubIdentityAsync(provider, tokens.AccessToken, cancellationToken);
    }

    public static string ProviderErrorMessage(string error) => error switch
    {
        "access_denied" => "Sign-in was cancelled.",
        _ => "The provider could not complete the sign-in.",
    };

    private OidcProvider Require(string providerId)
    {
        var provider = Find(providerId);
        if (provider is null)
        {
            throw new OidcException("This sign-in provider is not configured.", 404);
        }

        return provider;
    }

    private static string CallbackUrl(OidcProvider provider, string origin) =>
        $"{origin.TrimEnd('/')}/api/auth/oidc/{provider.Id}/callback";

    private async Task<OidcTokens> ExchangeCodeAsync(
        OidcProvider provider,
        string code,
        string verifier,
        string redirectUri,
        CancellationToken cancellationToken)
    {
        var form = new Dictionary<string, string>
        {
            ["grant_type"] = "authorization_code",
            ["code"] = code,
            ["redirect_uri"] = redirectUri,
            ["client_id"] = provider.ClientId,
            ["client_secret"] = provider.ClientSecret,
        };

        if (provider.IsOidc) form["code_verifier"] = verifier;

        using var request = new HttpRequestMessage(HttpMethod.Post, provider.TokenEndpoint)
        {
            Content = new FormUrlEncodedContent(form),
        };
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        using var response = await _http.SendAsync(request, cancellationToken);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));

        var root = document.RootElement;
        var accessToken = JsonValue.String(root, "access_token");
        var idToken = JsonValue.String(root, "id_token");

        if (!response.IsSuccessStatusCode || string.IsNullOrEmpty(accessToken))
        {
            var description = JsonValue.String(root, "error_description") ?? JsonValue.String(root, "error");
            _logger?.LogWarning(
                "Token exchange with {Provider} failed with status {Status}.",
                provider.Id,
                (int)response.StatusCode);
            throw new OidcException(description ?? "The provider rejected the sign-in.");
        }

        return new OidcTokens(accessToken, idToken);
    }

    private async Task<OidcIdentity> OidcIdentityAsync(
        OidcProvider provider,
        OidcTokens tokens,
        string expectedNonce,
        CancellationToken cancellationToken)
    {
        if (!string.IsNullOrEmpty(tokens.IdToken))
        {
            var jwt = await ValidateIdTokenAsync(provider, tokens.IdToken, expectedNonce, cancellationToken);
            var email = ClaimValue(jwt, "email")
                ?? ClaimValue(jwt, "preferred_username")
                ?? ClaimValue(jwt, "upn");

            if (string.IsNullOrEmpty(email))
            {
                throw new OidcException("The provider did not return a verified email address.");
            }

            if (ClaimValue(jwt, "email_verified") is { } verified
                && string.Equals(verified, "false", StringComparison.OrdinalIgnoreCase))
            {
                throw new OidcException("The provider did not return a verified email address.");
            }

            var subject = ClaimValue(jwt, "sub")
                ?? throw new OidcException("The provider did not return a subject identifier.");

            return new OidcIdentity(
                provider.Id,
                subject,
                EmailAddress.Normalize(email),
                ClaimValue(jwt, "name"));
        }

        if (!string.IsNullOrEmpty(provider.UserInfoEndpoint) && !string.IsNullOrEmpty(tokens.AccessToken))
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, provider.UserInfoEndpoint);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", tokens.AccessToken);
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

            using var response = await _http.SendAsync(request, cancellationToken);
            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
            var profile = document.RootElement;

            if (response.IsSuccessStatusCode)
            {
                var email = JsonValue.String(profile, "email")
                    ?? JsonValue.String(profile, "preferred_username");
                var subject = JsonValue.String(profile, "sub");

                if (!string.IsNullOrEmpty(email) && !string.IsNullOrEmpty(subject))
                {
                    return new OidcIdentity(
                        provider.Id,
                        subject,
                        EmailAddress.Normalize(email),
                        JsonValue.String(profile, "name"));
                }
            }
        }

        throw new OidcException("The provider did not return a profile.");
    }

    private async Task<JwtSecurityToken> ValidateIdTokenAsync(
        OidcProvider provider,
        string idToken,
        string expectedNonce,
        CancellationToken cancellationToken)
    {
        var keys = await GetSigningKeysAsync(provider, cancellationToken);

        var parameters = new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKeys = keys,
            TryAllIssuerSigningKeys = true,
            ValidateIssuer = true,
            ValidIssuer = provider.Issuer,
            IssuerValidator = (issuer, _, _) => ValidateIssuer(provider, issuer),
            ValidateAudience = true,
            ValidAudience = provider.ClientId,
            ValidateLifetime = true,
            RequireExpirationTime = true,
            RequireSignedTokens = true,
            ValidAlgorithms = ["RS256"],
            ClockSkew = TimeSpan.FromMinutes(2),
        };

        var handler = new JwtSecurityTokenHandler { MapInboundClaims = false };
        JwtSecurityToken jwt;
        try
        {
            handler.ValidateToken(idToken, parameters, out var validated);
            jwt = (JwtSecurityToken)validated;
        }
        catch (Exception exception) when (exception is SecurityTokenException or ArgumentException)
        {
            _logger?.LogWarning("ID token from {Provider} failed validation: {Reason}.", provider.Id, exception.GetType().Name);
            throw new OidcException("The provider returned an invalid identity token.", 401);
        }

        var nonce = ClaimValue(jwt, "nonce");
        if (string.IsNullOrEmpty(nonce) || !CryptographicOperations.FixedTimeEquals(
                Encoding.UTF8.GetBytes(nonce),
                Encoding.UTF8.GetBytes(expectedNonce)))
        {
            throw new OidcException("The identity token nonce does not match.", 401);
        }

        return jwt;
    }

    private string ValidateIssuer(OidcProvider provider, string issuer)
    {
        if (string.Equals(issuer, provider.Issuer, StringComparison.Ordinal))
        {
            return issuer;
        }

        // Entra ID tokens carry the tenant in iss; "common" is only used for discovery.
        if (provider.Id == OidcProviderCatalog.MicrosoftId
            && (provider.Issuer.Contains("/common/", StringComparison.Ordinal)
                || provider.Issuer.Contains("/organizations/", StringComparison.Ordinal)
                || provider.Issuer.Contains("/consumers/", StringComparison.Ordinal))
            && TenantIssuer().IsMatch(issuer))
        {
            return issuer;
        }

        throw new SecurityTokenInvalidIssuerException("The identity token issuer does not match.");
    }

    [GeneratedRegex(
        @"^https://login\.microsoftonline\.com/[0-9a-fA-F-]{36}/v2\.0$|^https://sts\.windows\.net/[0-9a-fA-F-]{36}/?$",
        RegexOptions.CultureInvariant)]
    private static partial Regex TenantIssuer();

    private async Task<IReadOnlyCollection<SecurityKey>> GetSigningKeysAsync(
        OidcProvider provider,
        CancellationToken cancellationToken)
    {
        if (_jwks.TryGetValue(provider.Id, out var cached) && cached.ExpiresAt > _time.GetUtcNow())
        {
            return cached.Keys;
        }

        try
        {
            if (Uri.TryCreate(provider.Issuer, UriKind.Absolute, out var issuerUri))
            {
                var metadataAddress = $"{issuerUri.AbsoluteUri.TrimEnd('/')}/.well-known/openid-configuration";
                var manager = _managers.GetOrAdd(
                    provider.Id,
                    _ => new ConfigurationManager<OpenIdConnectConfiguration>(
                        metadataAddress,
                        new OpenIdConnectConfigurationRetriever(),
                        new HttpDocumentRetriever(_http) { RequireHttps = issuerUri.Scheme == Uri.UriSchemeHttps }));
                var configuration = await manager.GetConfigurationAsync(cancellationToken);
                IReadOnlyCollection<SecurityKey> discovered = configuration.SigningKeys.ToList();
                _jwks[provider.Id] = (discovered, _time.GetUtcNow().Add(JwksTtl));
                return discovered;
            }
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            _logger?.LogWarning(
                "OIDC discovery failed for {Provider}; falling back to the configured JWKS endpoint.",
                provider.Id);
        }

        if (string.IsNullOrEmpty(provider.JwksUri))
        {
            throw new OidcException("The provider signing keys could not be loaded.", 502);
        }

        using var response = await _http.GetAsync(provider.JwksUri, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new OidcException("The provider signing keys could not be loaded.", 502);
        }

        var document = await response.Content.ReadAsStringAsync(cancellationToken);
        IReadOnlyCollection<SecurityKey> keys = new JsonWebKeySet(document).GetSigningKeys().ToList();
        _jwks[provider.Id] = (keys, _time.GetUtcNow().Add(JwksTtl));
        return keys;
    }

    private async Task<OidcIdentity> GitHubIdentityAsync(
        OidcProvider provider,
        string? accessToken,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(accessToken))
        {
            throw new OidcException("GitHub did not return an access token.");
        }

        using var userRequest = GitHubRequest(GitHubUserEndpoint, accessToken);
        using var userResponse = await _http.SendAsync(userRequest, cancellationToken);
        if (!userResponse.IsSuccessStatusCode)
        {
            throw new OidcException("The provider did not return a profile.", 502);
        }

        using var userDocument = JsonDocument.Parse(await userResponse.Content.ReadAsStringAsync(cancellationToken));
        var user = userDocument.RootElement;
        var login = JsonValue.String(user, "login");
        var email = JsonValue.String(user, "email");

        if (string.IsNullOrEmpty(email))
        {
            using var emailRequest = GitHubRequest(GitHubEmailsEndpoint, accessToken);
            using var emailResponse = await _http.SendAsync(emailRequest, cancellationToken);
            if (emailResponse.IsSuccessStatusCode)
            {
                using var emailDocument = JsonDocument.Parse(
                    await emailResponse.Content.ReadAsStringAsync(cancellationToken));
                email = GitHubEmails.Select(ParseGitHubEmails(emailDocument.RootElement));
            }
        }

        if (string.IsNullOrEmpty(email) || !EmailAddress.IsValid(email))
        {
            throw new OidcException("The provider did not return a verified email address.");
        }

        var subject = JsonValue.String(user, "id") ?? login;
        if (string.IsNullOrEmpty(subject))
        {
            throw new OidcException("The provider did not return a subject identifier.");
        }

        return new OidcIdentity(
            provider.Id,
            subject,
            EmailAddress.Normalize(email),
            JsonValue.String(user, "name") ?? login);
    }

    private static HttpRequestMessage GitHubRequest(string url, string accessToken)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
        request.Headers.UserAgent.ParseAdd("Comply");
        return request;
    }

    internal static IReadOnlyList<GitHubEmail> ParseGitHubEmails(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Array) return [];

        var emails = new List<GitHubEmail>();
        foreach (var item in root.EnumerateArray())
        {
            var email = JsonValue.String(item, "email");
            if (string.IsNullOrEmpty(email)) continue;

            var primary = item.TryGetProperty("primary", out var primaryValue)
                && primaryValue.ValueKind == JsonValueKind.True;
            var verified = item.TryGetProperty("verified", out var verifiedValue)
                && verifiedValue.ValueKind == JsonValueKind.True;
            emails.Add(new GitHubEmail(email, primary, verified));
        }

        return emails;
    }

    private static string? ClaimValue(JwtSecurityToken token, string type) =>
        token.Claims.FirstOrDefault(claim => claim.Type == type)?.Value;

    private static string Base64Url(byte[] value) => AuthTokenService.Base64UrlEncode(value);

    private sealed record OidcTokens(string? AccessToken, string? IdToken);
}

public sealed record GitHubEmail(string Email, bool Primary, bool Verified);

/// <summary>GitHub returns every address; only a verified one may identify the account.</summary>
public static class GitHubEmails
{
    public static string? Select(IEnumerable<GitHubEmail> emails) =>
        emails
            .Where(email => email.Verified)
            .OrderByDescending(email => email.Primary)
            .Select(email => email.Email)
            .FirstOrDefault();
}

internal static class JsonValue
{
    public static string? String(JsonElement element, string name)
    {
        if (element.ValueKind != JsonValueKind.Object) return null;
        if (!element.TryGetProperty(name, out var value)) return null;

        return value.ValueKind switch
        {
            JsonValueKind.String => value.GetString(),
            JsonValueKind.Number => value.GetRawText(),
            _ => null,
        };
    }
}
