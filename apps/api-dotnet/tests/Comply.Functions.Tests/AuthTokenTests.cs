using System.Text;
using Comply.Functions.Auth;

namespace Comply.Functions.Tests;

public sealed class AuthTokenTests
{
    private static readonly DateTimeOffset Start = new(2026, 10, 30, 12, 0, 0, TimeSpan.Zero);

    private static (AuthTokenService Tokens, MutableTimeProvider Time) Create(string secret = "token-test-secret")
    {
        var time = new MutableTimeProvider(Start);
        return (new AuthTokenService(secret, time), time);
    }

    [Fact]
    public void Signs_and_verifies_a_session_token()
    {
        var (tokens, _) = Create();

        var payload = tokens.Verify(tokens.SignSession("ada@example.com"));

        Assert.NotNull(payload);
        Assert.Equal(TokenKind.Session, payload!.Kind);
        Assert.Equal("ada@example.com", payload.Email);
        Assert.Equal(Start.AddHours(8), payload.ExpiresAt);
    }

    [Fact]
    public void Token_is_two_base64url_sections()
    {
        var (tokens, _) = Create();

        var token = tokens.SignMagic("ada@example.com");

        var parts = token.Split('.');
        Assert.Equal(2, parts.Length);
        Assert.DoesNotContain('=', parts[0]);
        Assert.DoesNotContain('+', parts[0]);
        Assert.DoesNotContain('/', parts[0]);
        Assert.DoesNotContain('=', parts[1]);
    }

    [Fact]
    public void Uses_the_json_and_hmac_format_from_the_node_auth_module()
    {
        var (tokens, _) = Create("shared-secret");

        var token = tokens.SignSession("ada@example.com", Start.AddHours(8));

        var body = Encoding.UTF8.GetString(AuthTokenService.Base64UrlDecode(token.Split('.')[0]));
        Assert.Contains("\"kind\":\"session\"", body);
        Assert.Contains("\"email\":\"ada@example.com\"", body);
        Assert.Contains($"\"exp\":{Start.AddHours(8).ToUnixTimeMilliseconds()}", body);
    }

    [Fact]
    public void Rejects_a_tampered_signature()
    {
        var (tokens, _) = Create();
        var token = tokens.SignSession("ada@example.com");

        var tampered = token[..^2] + (token.EndsWith("A", StringComparison.Ordinal) ? "BB" : "AA");

        Assert.Null(tokens.Verify(tampered));
    }

    [Fact]
    public void Rejects_a_token_signed_with_another_secret()
    {
        var (issuer, _) = Create("secret-one");
        var (verifier, _) = Create("secret-two");

        Assert.Null(verifier.Verify(issuer.SignSession("ada@example.com")));
    }

    [Fact]
    public void Rejects_an_expired_token()
    {
        var (tokens, time) = Create();
        var token = tokens.SignSession("ada@example.com");

        time.Advance(TimeSpan.FromHours(8) + TimeSpan.FromSeconds(1));

        Assert.Null(tokens.Verify(token));
    }

    [Fact]
    public void Expiry_boundary_is_still_valid()
    {
        var (tokens, time) = Create();
        var token = tokens.SignMagic("ada@example.com");

        time.Advance(AuthTokenService.MagicTtl);

        Assert.NotNull(tokens.Verify(token));
    }

    [Fact]
    public void Rejects_malformed_tokens()
    {
        var (tokens, _) = Create();

        Assert.Null(tokens.Verify(null));
        Assert.Null(tokens.Verify(""));
        Assert.Null(tokens.Verify("no-dot"));
        Assert.Null(tokens.Verify(".signature"));
        Assert.Null(tokens.Verify("body."));
        Assert.Null(tokens.Verify("body.signature.extra"));
        Assert.Null(tokens.Verify("!!not-base64!!.c2ln"));
    }

    [Fact]
    public void Magic_tokens_use_a_fifteen_minute_ttl()
    {
        var (tokens, time) = Create();
        var token = tokens.SignMagic("ada@example.com");
        var expiresAt = tokens.Verify(token)!.ExpiresAt;

        Assert.Equal(Start.AddMinutes(15), expiresAt);

        time.Advance(TimeSpan.FromMinutes(15) + TimeSpan.FromSeconds(1));
        Assert.Null(tokens.Verify(token));
    }

    [Fact]
    public void Code_tokens_use_a_sixty_second_ttl()
    {
        var (tokens, time) = Create();
        var token = tokens.SignCode("ada@example.com");

        Assert.Equal(Start.AddSeconds(60), tokens.Verify(token)!.ExpiresAt);
        time.Advance(TimeSpan.FromSeconds(61));
        Assert.Null(tokens.Verify(token));
    }

    [Fact]
    public void State_tokens_carry_provider_verifier_and_nonce()
    {
        var (tokens, _) = Create();

        var payload = tokens.Verify(tokens.SignState("google", "pkce-verifier", "nonce-value"));

        Assert.NotNull(payload);
        Assert.Equal(TokenKind.OidcState, payload!.Kind);
        Assert.Null(payload.Email);
        Assert.Equal("google", payload.Provider);
        Assert.Equal("pkce-verifier", payload.Verifier);
        Assert.Equal("nonce-value", payload.Nonce);
        Assert.Equal(Start.AddMinutes(10), payload.ExpiresAt);
    }

    [Fact]
    public void Kinds_are_not_interchangeable()
    {
        var (tokens, _) = Create();

        Assert.Equal(TokenKind.Magic, tokens.Verify(tokens.SignMagic("ada@example.com"))!.Kind);
        Assert.Equal(TokenKind.OidcCode, tokens.Verify(tokens.SignCode("ada@example.com"))!.Kind);
        Assert.Equal(TokenKind.Session, tokens.Verify(tokens.SignSession("ada@example.com"))!.Kind);
    }
}
