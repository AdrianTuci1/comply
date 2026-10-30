using System.Security.Cryptography;
using Microsoft.Extensions.Logging;

namespace Comply.Functions.Auth;

/// <summary>
/// Runtime auth configuration from the environment. In production a missing secret is fatal;
/// outside production an ephemeral secret is generated so the API still starts.
/// </summary>
public sealed record AuthSettings(
    string Secret,
    string? AppUrl,
    string? MailWebhookUrl,
    bool DevLinks,
    bool IsProduction)
{
    public const string DefaultAppUrl = "http://localhost:4200";

    public string? ConfiguredAppUrl => string.IsNullOrEmpty(AppUrl) ? null : AppUrl;

    /// <summary>Where sign-in links and OIDC callbacks send the browser.</summary>
    public string AppBaseUrl => ConfiguredAppUrl ?? DefaultAppUrl;

    public static AuthSettings FromEnvironment(ILogger? logger = null) => Resolve(
        Environment.GetEnvironmentVariable("COMPLY_AUTH_SECRET"),
        Environment.GetEnvironmentVariable("COMPLY_APP_URL"),
        Environment.GetEnvironmentVariable("COMPLY_MAIL_WEBHOOK_URL"),
        Environment.GetEnvironmentVariable("COMPLY_DEV_LINKS"),
        IsProductionEnvironment(),
        logger);

    public static AuthSettings Resolve(
        string? secret,
        string? appUrl,
        string? mailWebhookUrl,
        string? devLinks,
        bool production,
        ILogger? logger = null)
    {
        var value = secret?.Trim() ?? "";
        if (value.Length == 0)
        {
            if (production)
            {
                throw new InvalidOperationException(
                    "COMPLY_AUTH_SECRET must be set in production. Generate one with: openssl rand -hex 32");
            }

            value = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
            logger?.LogWarning(
                "COMPLY_AUTH_SECRET is not set; generated an ephemeral development secret. "
                + "Sessions and sign-in links will not survive a restart.");
        }

        var normalizedAppUrl = FirstAppUrl(appUrl);
        return new AuthSettings(
            value,
            normalizedAppUrl,
            string.IsNullOrWhiteSpace(mailWebhookUrl) ? null : mailWebhookUrl.Trim(),
            devLinks?.Trim() == "1" || !production,
            production);
    }

    /// <summary>
    /// <c>COMPLY_APP_URL</c> may hold a comma-separated origin list; the first value is where
    /// sign-in links and OIDC callbacks send the browser.
    /// </summary>
    private static string? FirstAppUrl(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;

        var first = value
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .FirstOrDefault();
        return string.IsNullOrWhiteSpace(first) ? null : first.TrimEnd('/');
    }

    public static bool IsProductionEnvironment() =>
        Matches(Environment.GetEnvironmentVariable("NODE_ENV"))
        || Matches(Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT"))
        || Matches(Environment.GetEnvironmentVariable("AZURE_FUNCTIONS_ENVIRONMENT"))
        || Matches(Environment.GetEnvironmentVariable("COMPLY_ENV"));

    private static bool Matches(string? value) =>
        string.Equals(value?.Trim(), "production", StringComparison.OrdinalIgnoreCase);
}
