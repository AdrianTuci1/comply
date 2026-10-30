using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Comply.Functions.Auth;
using Microsoft.AspNetCore.WebUtilities;

namespace Comply.Functions.Tests;

public sealed class OidcTests
{
    private static Dictionary<string, string> GoogleEnv() => new()
    {
        ["COMPLY_OIDC_GOOGLE_CLIENT_ID"] = "google-client",
        ["COMPLY_OIDC_GOOGLE_CLIENT_SECRET"] = "google-secret",
    };

    [Fact]
    public void Provider_catalog_is_empty_without_configuration()
    {
        Assert.Empty(OidcProviderCatalog.FromLookup(_ => null));
    }

    [Fact]
    public void Provider_catalog_requires_both_credentials()
    {
        var providers = OidcProviderCatalog.FromLookup(name => name switch
        {
            "COMPLY_OIDC_GOOGLE_CLIENT_ID" => "id-only",
            _ => null,
        });

        Assert.Empty(providers);
    }

    [Fact]
    public void Provider_catalog_uses_v2_endpoints_for_entra()
    {
        var providers = OidcProviderCatalog.FromLookup(name => name switch
        {
            "COMPLY_OIDC_MICROSOFT_CLIENT_ID" => "ms-id",
            "COMPLY_OIDC_MICROSOFT_CLIENT_SECRET" => "ms-secret",
            "COMPLY_OIDC_MICROSOFT_TENANT" => "contoso.onmicrosoft.com",
            _ => null,
        });

        var microsoft = Assert.Single(providers);
        Assert.Equal("microsoft", microsoft.Id);
        Assert.Equal("https://login.microsoftonline.com/contoso.onmicrosoft.com/v2.0", microsoft.Issuer);
        Assert.Equal(
            "https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/authorize",
            microsoft.AuthorizationEndpoint);
        Assert.Equal(
            "https://login.microsoftonline.com/contoso.onmicrosoft.com/discovery/v2.0/keys",
            microsoft.JwksUri);
    }

    [Fact]
    public void Provider_catalog_defaults_to_the_common_entra_tenant()
    {
        var providers = OidcProviderCatalog.FromLookup(name => name switch
        {
            "COMPLY_OIDC_MICROSOFT_CLIENT_ID" => "ms-id",
            "COMPLY_OIDC_MICROSOFT_CLIENT_SECRET" => "ms-secret",
            _ => null,
        });

        Assert.Contains("/common/v2.0", Assert.Single(providers).Issuer);
    }

    [Fact]
    public void Generic_provider_uses_the_configured_id_label_and_endpoints()
    {
        var providers = OidcProviderCatalog.FromLookup(name => name switch
        {
            "COMPLY_OIDC_CLIENT_ID" => "sso-id",
            "COMPLY_OIDC_CLIENT_SECRET" => "sso-secret",
            "COMPLY_OIDC_ISSUER" => "https://sso.example.com",
            "COMPLY_OIDC_AUTHORIZATION_ENDPOINT" => "https://sso.example.com/authorize",
            "COMPLY_OIDC_TOKEN_ENDPOINT" => "https://sso.example.com/token",
            "COMPLY_OIDC_JWKS_URI" => "https://sso.example.com/jwks",
            "COMPLY_OIDC_ID" => "okta",
            "COMPLY_OIDC_LABEL" => "Okta",
            _ => null,
        });

        var provider = Assert.Single(providers);
        Assert.Equal("okta", provider.Id);
        Assert.Equal("Okta", provider.Label);
        Assert.True(provider.IsOidc);
    }

    [Fact]
    public void GitHub_is_an_oauth2_provider()
    {
        var providers = OidcProviderCatalog.FromLookup(name => name switch
        {
            "COMPLY_OIDC_GITHUB_CLIENT_ID" => "gh-id",
            "COMPLY_OIDC_GITHUB_CLIENT_SECRET" => "gh-secret",
            _ => null,
        });

        var github = Assert.Single(providers);
        Assert.Equal(OidcProvider.OAuth2, github.Kind);
        Assert.Equal("read:user", github.Scopes[0]);
    }

    [Fact]
    public void Begin_builds_pkce_nonce_and_signed_state()
    {
        using var fixture = new AuthFixture(GoogleEnv());

        var url = fixture.Oidc.Begin("google", "https://api.example.com");
        var query = QueryHelpers.ParseQuery(new Uri(url).Query);

        Assert.Equal("google-client", query["client_id"].ToString());
        Assert.Equal("https://api.example.com/api/auth/oidc/google/callback", query["redirect_uri"].ToString());
        Assert.Equal("code", query["response_type"].ToString());
        Assert.Equal("openid email profile", query["scope"].ToString());
        Assert.Equal("S256", query["code_challenge_method"].ToString());
        Assert.False(string.IsNullOrEmpty(query["code_challenge"].ToString()));
        Assert.False(string.IsNullOrEmpty(query["nonce"].ToString()));

        var state = fixture.Tokens.Verify(query["state"].ToString());
        Assert.NotNull(state);
        Assert.Equal(TokenKind.OidcState, state!.Kind);
        Assert.Equal("google", state.Provider);
        Assert.Equal(query["nonce"].ToString(), state.Nonce);

        var challenge = AuthTokenService.Base64UrlEncode(
            SHA256.HashData(Encoding.ASCII.GetBytes(state.Verifier!)));
        Assert.Equal(challenge, query["code_challenge"].ToString());
    }

    [Fact]
    public void Begin_generates_a_fresh_verifier_for_each_attempt()
    {
        using var fixture = new AuthFixture(GoogleEnv());

        var first = QueryHelpers.ParseQuery(new Uri(fixture.Oidc.Begin("google", "https://api.example.com")).Query);
        var second = QueryHelpers.ParseQuery(new Uri(fixture.Oidc.Begin("google", "https://api.example.com")).Query);

        Assert.NotEqual(first["code_challenge"].ToString(), second["code_challenge"].ToString());
        Assert.NotEqual(first["state"].ToString(), second["state"].ToString());
    }

    [Fact]
    public void Begin_uses_the_configured_public_origin_for_the_callback()
    {
        using var fixture = new AuthFixture(GoogleEnv());

        var query = QueryHelpers.ParseQuery(
            new Uri(fixture.Oidc.Begin("google", "https://comply.example.com/")).Query);

        Assert.Equal(
            "https://comply.example.com/api/auth/oidc/google/callback",
            query["redirect_uri"].ToString());
    }

    [Fact]
    public void Begin_omits_pkce_for_github()
    {
        using var fixture = new AuthFixture(new Dictionary<string, string>
        {
            ["COMPLY_OIDC_GITHUB_CLIENT_ID"] = "gh-id",
            ["COMPLY_OIDC_GITHUB_CLIENT_SECRET"] = "gh-secret",
        });

        var query = QueryHelpers.ParseQuery(
            new Uri(fixture.Oidc.Begin("github", "https://api.example.com")).Query);

        Assert.False(query.ContainsKey("code_challenge"));
        Assert.False(query.ContainsKey("nonce"));
        Assert.Equal("read:user user:email", query["scope"].ToString());
    }

    [Fact]
    public void Begin_rejects_an_unknown_provider()
    {
        using var fixture = new AuthFixture(GoogleEnv());

        var error = Assert.Throws<OidcException>(() => fixture.Oidc.Begin("okta", "https://api.example.com"));

        Assert.Equal(404, error.Status);
    }

    [Fact]
    public void GitHub_email_selection_prefers_primary_then_verified()
    {
        var emails = new List<GitHubEmail>
        {
            new("secondary@example.com", Primary: false, Verified: true),
            new("primary@example.com", Primary: true, Verified: true),
            new("unverified@example.com", Primary: true, Verified: false),
        };

        Assert.Equal("primary@example.com", GitHubEmails.Select(emails));
    }

    [Fact]
    public void GitHub_email_selection_skips_unverified_addresses()
    {
        var emails = new List<GitHubEmail>
        {
            new("primary-unverified@example.com", Primary: true, Verified: false),
            new("verified@example.com", Primary: false, Verified: true),
        };

        Assert.Equal("verified@example.com", GitHubEmails.Select(emails));
    }

    [Fact]
    public void GitHub_email_selection_returns_null_without_a_verified_address()
    {
        var emails = new List<GitHubEmail>
        {
            new("primary-unverified@example.com", Primary: true, Verified: false),
        };

        Assert.Null(GitHubEmails.Select(emails));
    }

    [Fact]
    public void GitHub_emails_payload_is_parsed()
    {
        using var document = JsonDocument.Parse(
            """
            [
              {"email":"one@example.com","primary":false,"verified":true},
              {"email":"two@example.com","primary":true,"verified":true},
              {"email":"three@example.com","primary":false,"verified":false}
            ]
            """);

        var emails = OidcService.ParseGitHubEmails(document.RootElement);

        Assert.Equal(3, emails.Count);
        Assert.True(emails[1].Primary);
        Assert.False(emails[2].Verified);
        Assert.Equal("two@example.com", GitHubEmails.Select(emails));
    }

    [Fact]
    public async Task Callback_rejects_missing_or_tampered_state()
    {
        using var fixture = new AuthFixture(GoogleEnv());
        var foreign = new AuthTokenService("other-secret", fixture.Time).SignState("google", "v", "n");

        var missing = await Assert.ThrowsAsync<OidcException>(() =>
            fixture.Oidc.CompleteAsync(
                "google",
                new OidcCallback("code", null, null),
                "https://api.example.com",
                default));
        var tampered = await Assert.ThrowsAsync<OidcException>(() =>
            fixture.Oidc.CompleteAsync(
                "google",
                new OidcCallback("code", foreign, null),
                "https://api.example.com",
                default));

        Assert.Equal("The sign-in request expired. Start again.", missing.Message);
        Assert.Equal("The sign-in request expired. Start again.", tampered.Message);
    }

    [Fact]
    public async Task Callback_rejects_an_expired_state()
    {
        using var fixture = new AuthFixture(GoogleEnv());
        var state = fixture.Tokens.SignState("google", "verifier", "nonce");
        fixture.Time.Advance(TimeSpan.FromMinutes(11));

        var error = await Assert.ThrowsAsync<OidcException>(() =>
            fixture.Oidc.CompleteAsync(
                "google",
                new OidcCallback("code", state, null),
                "https://api.example.com",
                default));

        Assert.Equal("The sign-in request expired. Start again.", error.Message);
    }

    [Fact]
    public async Task Callback_maps_a_provider_cancellation()
    {
        using var fixture = new AuthFixture(GoogleEnv());

        var error = await Assert.ThrowsAsync<OidcException>(() =>
            fixture.Oidc.CompleteAsync(
                "google",
                new OidcCallback(null, null, "access_denied"),
                "https://api.example.com",
                default));

        Assert.Equal("Sign-in was cancelled.", error.Message);
    }

    [Fact]
    public void Public_list_exposes_only_id_label_and_kind()
    {
        using var fixture = new AuthFixture(GoogleEnv());

        var view = Assert.Single(fixture.Oidc.PublicList);

        Assert.Equal("google", view.Id);
        Assert.Equal("Google", view.Label);
        Assert.Equal("oidc", view.Kind);
    }
}
