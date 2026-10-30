using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Comply.Functions.Auth;

public enum TokenKind
{
    Session,
    Magic,
    OidcCode,
    OidcState,
}

public sealed record AuthTokenPayload(
    TokenKind Kind,
    string? Email,
    string? Provider,
    string? Verifier,
    string? Nonce,
    DateTimeOffset ExpiresAt);

/// <summary>
/// HMAC-SHA256 tokens in the Node format: base64url(JSON) + "." + base64url(signature).
/// The payload is readable, the signature is not forgeable; <c>exp</c> is Unix milliseconds.
/// </summary>
public sealed class AuthTokenService(string secret, TimeProvider time)
{
    public static readonly TimeSpan SessionTtl = TimeSpan.FromHours(8);
    public static readonly TimeSpan MagicTtl = TimeSpan.FromMinutes(15);
    public static readonly TimeSpan CodeTtl = TimeSpan.FromSeconds(60);
    public static readonly TimeSpan StateTtl = TimeSpan.FromMinutes(10);

    private readonly byte[] _key = Encoding.UTF8.GetBytes(secret);
    private readonly TimeProvider _time = time;

    public string SignSession(string email, DateTimeOffset? expiresAt = null) =>
        Sign(TokenKind.Session, email, expiresAt ?? Now.Add(SessionTtl));

    public string SignMagic(string email, DateTimeOffset? expiresAt = null) =>
        Sign(TokenKind.Magic, email, expiresAt ?? Now.Add(MagicTtl));

    public string SignCode(string email, DateTimeOffset? expiresAt = null) =>
        Sign(TokenKind.OidcCode, email, expiresAt ?? Now.Add(CodeTtl));

    public string SignState(string provider, string verifier, string nonce) =>
        Sign(TokenKind.OidcState, email: null, expiresAt: Now.Add(StateTtl), provider, verifier, nonce);

    /// <summary>Returns the payload for a valid, unexpired token; otherwise null.</summary>
    public AuthTokenPayload? Verify(string? token)
    {
        if (string.IsNullOrEmpty(token)) return null;

        var separator = token.IndexOf('.');
        if (separator <= 0 || separator == token.Length - 1) return null;
        if (token.IndexOf('.', separator + 1) >= 0) return null;

        var body = token[..separator];
        var signature = token[(separator + 1)..];
        var expected = Base64UrlEncode(ComputeSignature(body));

        // Compare fixed-length ASCII strings without early exit.
        if (!CryptographicOperations.FixedTimeEquals(
                Encoding.ASCII.GetBytes(signature),
                Encoding.ASCII.GetBytes(expected)))
        {
            return null;
        }

        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(Base64UrlDecode(body));
        }
        catch (Exception exception) when (exception is JsonException or FormatException)
        {
            return null;
        }

        using (document)
        {
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return null;
            if (!TryGetString(root, "kind", out var kindName)) return null;
            if (!TryParseKind(kindName!, out var kind)) return null;
            if (!root.TryGetProperty("exp", out var expElement) || expElement.ValueKind != JsonValueKind.Number)
            {
                return null;
            }

            if (!expElement.TryGetInt64(out var exp)) return null;
            var expiresAt = DateTimeOffset.FromUnixTimeMilliseconds(exp);
            if (expiresAt < _time.GetUtcNow()) return null;

            TryGetString(root, "email", out var email);
            TryGetString(root, "provider", out var provider);
            TryGetString(root, "verifier", out var verifier);
            TryGetString(root, "nonce", out var nonce);

            var valid = kind switch
            {
                TokenKind.Session or TokenKind.Magic or TokenKind.OidcCode => email is not null,
                TokenKind.OidcState => provider is not null && verifier is not null && nonce is not null,
                _ => false,
            };

            return valid ? new AuthTokenPayload(kind, email, provider, verifier, nonce, expiresAt) : null;
        }
    }

    private DateTimeOffset Now => _time.GetUtcNow();

    private string Sign(
        TokenKind kind,
        string? email,
        DateTimeOffset expiresAt,
        string? provider = null,
        string? verifier = null,
        string? nonce = null)
    {
        var payload = new Dictionary<string, object?>
        {
            ["kind"] = KindName(kind),
            ["exp"] = expiresAt.ToUnixTimeMilliseconds(),
        };

        if (email is not null) payload["email"] = email;
        if (provider is not null) payload["provider"] = provider;
        if (verifier is not null) payload["verifier"] = verifier;
        if (nonce is not null) payload["nonce"] = nonce;

        var body = Base64UrlEncode(JsonSerializer.SerializeToUtf8Bytes(payload));
        var signature = Base64UrlEncode(ComputeSignature(body));
        return $"{body}.{signature}";
    }

    private byte[] ComputeSignature(string body) =>
        HMACSHA256.HashData(_key, Encoding.ASCII.GetBytes(body));

    private static bool TryParseKind(string value, out TokenKind kind)
    {
        switch (value)
        {
            case "session": kind = TokenKind.Session; return true;
            case "magic": kind = TokenKind.Magic; return true;
            case "oidc-code": kind = TokenKind.OidcCode; return true;
            case "oidc-state": kind = TokenKind.OidcState; return true;
            default: kind = default; return false;
        }
    }

    private static string KindName(TokenKind kind) => kind switch
    {
        TokenKind.Session => "session",
        TokenKind.Magic => "magic",
        TokenKind.OidcCode => "oidc-code",
        TokenKind.OidcState => "oidc-state",
        _ => throw new ArgumentOutOfRangeException(nameof(kind)),
    };

    private static bool TryGetString(JsonElement root, string name, out string? value)
    {
        value = null;
        if (!root.TryGetProperty(name, out var element) || element.ValueKind != JsonValueKind.String)
        {
            return false;
        }

        value = element.GetString();
        return value is not null;
    }

    internal static string Base64UrlEncode(byte[] value) =>
        Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    internal static byte[] Base64UrlDecode(string value)
    {
        var padded = value.Replace('-', '+').Replace('_', '/');
        padded = (padded.Length % 4) switch
        {
            2 => padded + "==",
            3 => padded + "=",
            0 => padded,
            _ => throw new FormatException("Invalid base64url value."),
        };
        return Convert.FromBase64String(padded);
    }
}
