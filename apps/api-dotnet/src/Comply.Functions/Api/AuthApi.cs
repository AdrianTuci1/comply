using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Comply.Functions.Auth;
using Comply.Functions.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace Comply.Functions.Api;

/// <summary>
/// HTTP surface of <c>/api/auth</c>. Response shapes follow the Node implementation so the
/// Angular client keeps working: <c>{session, expiresAt, user}</c> on sign-in, <c>{user}</c> on
/// <c>/me</c>, and <c>{password, providers, demo, setupRequired}</c> on <c>/providers</c>.
/// </summary>
public sealed partial class AuthApi(
    AuthService auth,
    OidcService oidc,
    AuthSettings settings,
    DeploymentSettings deployment,
    HttpClient http,
    ILogger<AuthApi>? logger = null)
{
    private readonly AuthService _auth = auth;
    private readonly OidcService _oidc = oidc;
    private readonly AuthSettings _settings = settings;
    private readonly DeploymentSettings _deployment = deployment;
    private readonly HttpClient _http = http;
    private readonly ILogger<AuthApi>? _logger = logger;

    /// <summary>Auth fields for <c>GET /api/runtime</c>; never touches provider endpoints.</summary>
    public async Task<RuntimeAuthInfo> RuntimeAsync(CancellationToken cancellationToken) =>
        new(
            _auth.DatabaseAvailable,
            _oidc.PublicList,
            await _auth.SetupRequiredAsync(cancellationToken));

    public async Task<ApiResponse?> TryHandleAsync(
        HttpRequest request,
        string path,
        CancellationToken cancellationToken)
    {
        if (path != "/api/auth" && !path.StartsWith("/api/auth/", StringComparison.Ordinal))
        {
            return null;
        }

        if (path == "/api/auth") return ApiResponse.Error(404, "Not found.");

        try
        {
            var method = request.Method;

            switch (path)
            {
                case "/api/auth/register":
                    return IsPost(method)
                        ? await RegisterAsync(request, cancellationToken)
                        : MethodNotAllowed("POST, OPTIONS");

                case "/api/auth/login":
                    return IsPost(method)
                        ? await LoginAsync(request, cancellationToken)
                        : MethodNotAllowed("POST, OPTIONS");

                case "/api/auth/magic-link":
                    return IsPost(method)
                        ? await MagicLinkAsync(request, cancellationToken)
                        : MethodNotAllowed("POST, OPTIONS");

                case "/api/auth/verify":
                    return IsPost(method)
                        ? await VerifyAsync(request, cancellationToken)
                        : MethodNotAllowed("POST, OPTIONS");

                case "/api/auth/exchange":
                    return IsPost(method)
                        ? await ExchangeAsync(request, cancellationToken)
                        : MethodNotAllowed("POST, OPTIONS");

                case "/api/auth/me":
                    return IsGet(method)
                        ? await MeAsync(request, cancellationToken)
                        : MethodNotAllowed("GET, OPTIONS");

                case "/api/auth/sign-out":
                    return IsPost(method)
                        ? ApiResponse.NoContent(new Dictionary<string, string>
                        {
                            ["Set-Cookie"] = SessionToken.ClearCookie(),
                        })
                        : MethodNotAllowed("POST, OPTIONS");

                case "/api/auth/providers":
                    return IsGet(method)
                        ? ApiResponse.Ok(await _auth.GetProvidersAsync(_oidc.PublicList, cancellationToken))
                        : MethodNotAllowed("GET, OPTIONS");
            }

            var match = OidcRoute().Match(path);
            if (match.Success && IsGet(method))
            {
                var providerId = match.Groups["provider"].Value;
                return match.Groups["action"].Value == "start"
                    ? StartOidc(request, providerId)
                    : await CompleteOidcAsync(request, providerId, cancellationToken);
            }

            return ApiResponse.Error(404, "Not found.");
        }
        catch (AuthException exception)
        {
            return ApiResponse.Error(exception.Status, exception.Message);
        }
        catch (OidcException exception)
        {
            return ApiResponse.Error(exception.Status, exception.Message);
        }
    }

    private async Task<ApiResponse> RegisterAsync(HttpRequest request, CancellationToken cancellationToken)
    {
        var body = await ReadBodyAsync(request, cancellationToken);
        var result = await _auth.RegisterAsync(
            new RegisterRequest(
                Field(body, "email"),
                Field(body, "name"),
                Field(body, "password"),
                Field(body, "organizationName")),
            cancellationToken);

        return WithSessionCookie(ApiResponse.Created(result), result, request);
    }

    private async Task<ApiResponse> LoginAsync(HttpRequest request, CancellationToken cancellationToken)
    {
        var body = await ReadBodyAsync(request, cancellationToken);
        var result = await _auth.LoginAsync(
            Field(body, "email"),
            Field(body, "password"),
            cancellationToken);

        return WithSessionCookie(ApiResponse.Ok(result), result, request);
    }

    private async Task<ApiResponse> MagicLinkAsync(HttpRequest request, CancellationToken cancellationToken)
    {
        if (!_auth.DatabaseAvailable)
        {
            return ApiResponse.Error(503, "The database is not configured for this deployment.");
        }

        var body = await ReadBodyAsync(request, cancellationToken);
        var link = _auth.RequestMagicLink(Field(body, "email"));
        var signInUrl = $"{_settings.AppBaseUrl}/sign-in?token={Uri.EscapeDataString(link.Token)}";

        if (!_settings.DevLinks)
        {
            if (string.IsNullOrEmpty(_settings.MailWebhookUrl))
            {
                return ApiResponse.Error(503, "Email delivery is not configured for this deployment.");
            }

            if (!await DeliverMagicLinkAsync(link, signInUrl, cancellationToken))
            {
                return ApiResponse.Error(502, "The sign-in email could not be sent.");
            }

            return ApiResponse.Created(new MagicLinkResponse(true, link.Email, link.ExpiresAt, null));
        }

        _logger?.LogInformation("Issued a development sign-in link for {Email}.", link.Email);
        return ApiResponse.Created(new MagicLinkResponse(true, link.Email, link.ExpiresAt, link.Token));
    }

    private async Task<ApiResponse> VerifyAsync(HttpRequest request, CancellationToken cancellationToken)
    {
        var body = await ReadBodyAsync(request, cancellationToken);
        var result = await _auth.VerifyMagicLinkAsync(Field(body, "token"), cancellationToken);
        return WithSessionCookie(ApiResponse.Ok(result), result, request);
    }

    private async Task<ApiResponse> ExchangeAsync(HttpRequest request, CancellationToken cancellationToken)
    {
        var body = await ReadBodyAsync(request, cancellationToken);
        var result = await _auth.ExchangeCodeAsync(Field(body, "code"), cancellationToken);
        return WithSessionCookie(ApiResponse.Ok(result), result, request);
    }

    private async Task<ApiResponse> MeAsync(HttpRequest request, CancellationToken cancellationToken)
    {
        var user = await _auth.UserForTokenAsync(SessionToken.From(request), cancellationToken);
        return user is null
            ? ApiResponse.Error(401, "Not signed in.")
            : ApiResponse.Ok(new MeResponse(user));
    }

    private ApiResponse StartOidc(HttpRequest request, string providerId)
    {
        var origin = RequestOrigin.Resolve(request, _deployment.PublicUrl);
        return ApiResponse.Redirect(_oidc.Begin(providerId, origin));
    }

    private async Task<ApiResponse> CompleteOidcAsync(
        HttpRequest request,
        string providerId,
        CancellationToken cancellationToken)
    {
        var origin = RequestOrigin.Resolve(request, _deployment.PublicUrl);
        var appUrl = _settings.AppBaseUrl;

        try
        {
            var identity = await _oidc.CompleteAsync(
                providerId,
                new OidcCallback(
                    request.Query["code"].ToString(),
                    request.Query["state"].ToString(),
                    request.Query["error"].ToString()),
                origin,
                cancellationToken);

            var user = await _auth.EnsureExternalAsync(identity, cancellationToken);
            var code = _auth.IssueCode(user);
            return ApiResponse.Redirect($"{appUrl}/sign-in?code={Uri.EscapeDataString(code)}");
        }
        catch (Exception exception) when (exception is OidcException or AuthException)
        {
            _logger?.LogWarning(
                "External sign-in with {Provider} failed: {Status}.",
                providerId,
                exception.Message);
            return ApiResponse.Redirect($"{appUrl}/sign-in?error={Uri.EscapeDataString(exception.Message)}");
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception exception)
        {
            _logger?.LogError(exception, "External sign-in with {Provider} failed unexpectedly.", providerId);
            return ApiResponse.Redirect(
                $"{appUrl}/sign-in?error={Uri.EscapeDataString("The provider could not complete the sign-in.")}");
        }
    }

    private async Task<bool> DeliverMagicLinkAsync(
        MagicLinkResult link,
        string signInUrl,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(_settings.MailWebhookUrl)) return false;

        try
        {
            using var response = await _http.PostAsJsonAsync(
                _settings.MailWebhookUrl,
                new { to = link.Email, url = signInUrl, expiresAt = link.ExpiresAt },
                cancellationToken);
            return response.IsSuccessStatusCode;
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException)
        {
            _logger?.LogWarning("The mail webhook could not be reached: {Reason}.", exception.GetType().Name);
            return false;
        }
    }

    private ApiResponse WithSessionCookie(ApiResponse response, SessionResult session, HttpRequest request)
    {
        var headers = response.Headers is null
            ? new Dictionary<string, string>()
            : new Dictionary<string, string>(response.Headers);

        headers["Set-Cookie"] = SessionToken.CreateCookie(
            session.Session,
            (int)AuthTokenService.SessionTtl.TotalSeconds,
            IsSecure(request));

        return response with { Headers = headers };
    }

    private static bool IsSecure(HttpRequest request) =>
        request.IsHttps
        || string.Equals(RequestOrigin.Header(request, "X-Forwarded-Proto"), "https", StringComparison.OrdinalIgnoreCase);

    private static bool IsGet(string method) => HttpMethods.IsGet(method) || HttpMethods.IsHead(method);

    private static bool IsPost(string method) => HttpMethods.IsPost(method);

    private static ApiResponse MethodNotAllowed(string allow) =>
        new(405, new ErrorBody("Method not allowed."), new Dictionary<string, string>
        {
            ["Allow"] = allow,
        });

    private static async Task<JsonElement> ReadBodyAsync(HttpRequest request, CancellationToken cancellationToken)
    {
        try
        {
            using var document = await JsonDocument.ParseAsync(request.Body, cancellationToken: cancellationToken);
            return document.RootElement.Clone();
        }
        catch (JsonException)
        {
            return default;
        }
    }

    private static string? Field(JsonElement body, string name)
    {
        if (body.ValueKind != JsonValueKind.Object) return null;

        foreach (var property in body.EnumerateObject())
        {
            if (string.Equals(property.Name, name, StringComparison.OrdinalIgnoreCase)
                && property.Value.ValueKind == JsonValueKind.String)
            {
                return property.Value.GetString();
            }
        }

        return null;
    }

    [GeneratedRegex(
        @"^/api/auth/oidc/(?<provider>[a-z0-9-]+)/(?<action>start|callback)$",
        RegexOptions.CultureInvariant)]
    private static partial Regex OidcRoute();

    private sealed record MagicLinkResponse(
        bool Sent,
        string Email,
        string ExpiresAt,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? DevToken);

    private sealed record MeResponse(UserView User);
}
