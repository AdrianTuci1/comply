using System.Text.RegularExpressions;

namespace Comply.Functions.Auth;

/// <summary>Email normalization shared by every sign-in path.</summary>
public static partial class EmailAddress
{
    [GeneratedRegex(@"^[^@\s]+@[^@\s]+\.[^@\s]+$", RegexOptions.CultureInvariant)]
    private static partial Regex Pattern();

    public static string Normalize(string? email) => (email ?? "").Trim().ToLowerInvariant();

    public static bool IsValid(string? email) => Pattern().IsMatch(Normalize(email));
}

/// <summary>Error with the HTTP status the Node API uses for the same failure.</summary>
public sealed class AuthException(string message, int status) : Exception(message)
{
    public int Status { get; } = status;
}
