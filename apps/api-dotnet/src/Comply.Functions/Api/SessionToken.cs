using Microsoft.AspNetCore.Http;

namespace Comply.Functions.Api;

/// <summary>
/// Browser session transport. The Angular client uses the bearer token; the HttpOnly cookie is
/// additionally accepted for same-origin deployments and is set on every new session.
/// </summary>
public static class SessionToken
{
    public const string CookieName = "comply_session";

    public static string? From(HttpRequest request)
    {
        var header = RequestOrigin.Header(request, "Authorization");
        if (!string.IsNullOrEmpty(header))
        {
            const string prefix = "Bearer ";
            if (header.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            {
                var token = header[prefix.Length..].Trim();
                if (token.Length > 0) return token;
            }
        }

        return request.Cookies.TryGetValue(CookieName, out var cookie) && !string.IsNullOrEmpty(cookie)
            ? cookie
            : null;
    }

    public static string CreateCookie(string token, int maxAgeSeconds, bool secure)
    {
        var attributes = $"{CookieName}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={Math.Max(0, maxAgeSeconds)}";
        return secure ? $"{attributes}; Secure" : attributes;
    }

    public static string ClearCookie() => $"{CookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
}
