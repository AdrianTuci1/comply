using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Comply.Functions.Auth;

/// <summary>
/// PBKDF2-SHA256 password hashes. The stored value is
/// <c>pbkdf2-sha256$v1$&lt;iterations&gt;$&lt;salt&gt;$&lt;key&gt;</c> with base64url salt and key,
/// so the algorithm and cost can be upgraded without losing old hashes.
/// </summary>
public sealed class PasswordHasher
{
    public const int MinimumLength = 10;
    public const string Scheme = "pbkdf2-sha256";

    private const int Version = 1;
    private const int DefaultIterations = 210_000;
    private const int SaltSize = 16;
    private const int KeySize = 32;

    public string Hash(string password)
    {
        ArgumentException.ThrowIfNullOrEmpty(password);

        var salt = RandomNumberGenerator.GetBytes(SaltSize);
        var key = Derive(password, salt, DefaultIterations, KeySize);
        return string.Join(
            '$',
            Scheme,
            $"v{Version}",
            DefaultIterations.ToString(CultureInfo.InvariantCulture),
            AuthTokenService.Base64UrlEncode(salt),
            AuthTokenService.Base64UrlEncode(key));
    }

    /// <summary>Constant-time verification. Malformed or foreign hashes return false.</summary>
    public bool Verify(string? password, string? hash)
    {
        if (string.IsNullOrEmpty(password) || string.IsNullOrEmpty(hash)) return false;

        var parts = hash.Split('$');
        if (parts.Length != 5) return false;
        if (!string.Equals(parts[0], Scheme, StringComparison.Ordinal)) return false;
        if (!string.Equals(parts[1], $"v{Version}", StringComparison.Ordinal)) return false;
        if (!int.TryParse(parts[2], NumberStyles.None, CultureInfo.InvariantCulture, out var iterations)) return false;
        if (iterations < 1) return false;

        byte[] salt;
        byte[] expected;
        try
        {
            salt = AuthTokenService.Base64UrlDecode(parts[3]);
            expected = AuthTokenService.Base64UrlDecode(parts[4]);
        }
        catch (FormatException)
        {
            return false;
        }

        if (salt.Length == 0 || expected.Length == 0) return false;

        var candidate = Derive(password, salt, iterations, expected.Length);
        return CryptographicOperations.FixedTimeEquals(candidate, expected);
    }

    private static byte[] Derive(string password, byte[] salt, int iterations, int length) =>
        Rfc2898DeriveBytes.Pbkdf2(
            Encoding.UTF8.GetBytes(password),
            salt,
            iterations,
            HashAlgorithmName.SHA256,
            length);
}
