using Comply.Functions.Auth;
using Microsoft.AspNetCore.Http;

namespace Comply.Functions.Api;

/// <summary>
/// CORS allowlist. <c>COMPLY_APP_URL</c> may hold a comma-separated list (its first value stays
/// the sign-in redirect target) and <c>COMPLY_CORS_ORIGINS</c> adds more origins, so a
/// CDN-hosted Angular build and the Angular dev server can both call the API.
/// </summary>
public sealed record CorsSettings(IReadOnlyList<string> AllowedOrigins, bool Development)
{
    public const string DevAppOrigin = "http://localhost:4200";

    public static CorsSettings FromEnvironment() => Resolve(
        Environment.GetEnvironmentVariable("COMPLY_APP_URL"),
        Environment.GetEnvironmentVariable("COMPLY_CORS_ORIGINS"),
        AuthSettings.IsProductionEnvironment());

    public static CorsSettings Resolve(string? appUrl, bool production) =>
        Resolve(appUrl, null, production);

    public static CorsSettings Resolve(string? appUrl, string? corsOrigins, bool production)
    {
        var origins = new List<string>();
        foreach (var origin in Origins(appUrl).Concat(Origins(corsOrigins)))
        {
            if (!origins.Contains(origin, StringComparer.OrdinalIgnoreCase))
            {
                origins.Add(origin);
            }
        }

        if (!production && !origins.Contains(DevAppOrigin, StringComparer.OrdinalIgnoreCase))
        {
            origins.Add(DevAppOrigin);
        }

        return new CorsSettings(origins, !production);
    }

    /// <summary>Splits a comma-separated origin list; each value is trimmed of whitespace and a trailing slash.</summary>
    public static IReadOnlyList<string> Origins(string? value) =>
        string.IsNullOrWhiteSpace(value)
            ? []
            : value
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(origin => origin.TrimEnd('/'))
                .Where(origin => origin.Length > 0)
                .ToList();

    public bool Allows(string origin) =>
        AllowedOrigins.Contains(origin, StringComparer.OrdinalIgnoreCase);
}

/// <summary>
/// Explicit CORS allowlist. Production never echoes an arbitrary origin; development also
/// accepts any caller so tooling on other ports keeps working.
/// </summary>
public static class CorsPolicy
{
    public const string AllowMethods = "GET,POST,PUT,PATCH,DELETE,OPTIONS";

    /// <summary>Same header list the Node server advertises, so MCP clients can preflight.</summary>
    public const string AllowHeaders =
        "content-type,authorization,accept,mcp-protocol-version,mcp-session-id,x-comply-tenant";

    public const string MaxAge = "86400";

    public static IReadOnlyDictionary<string, string> Build(string? origin, CorsSettings settings)
    {
        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrEmpty(origin)) return headers;

        if (!settings.Allows(origin) && !settings.Development) return headers;

        headers["Access-Control-Allow-Origin"] = origin;
        headers["Access-Control-Allow-Methods"] = AllowMethods;
        headers["Access-Control-Allow-Headers"] = AllowHeaders;
        headers["Access-Control-Max-Age"] = MaxAge;
        headers["Vary"] = "origin";
        return headers;
    }

    public static void Apply(HttpResponse response, string? origin, CorsSettings settings)
    {
        foreach (var (name, value) in Build(origin, settings))
        {
            response.Headers[name] = value;
        }
    }
}
