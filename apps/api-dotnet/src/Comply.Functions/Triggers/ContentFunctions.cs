using System.Text.Json;
using Comply.Functions.Api;
using Comply.Functions.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;

namespace Comply.Functions.Triggers;

/// <summary>
/// Single catch-all HTTP trigger. The Functions host routes every request here and
/// <see cref="ContentApi"/> decides the response, so the URL surface stays identical to the
/// Node container (host.json sets <c>routePrefix</c> to an empty string).
/// </summary>
public sealed class ContentFunctions
{
    private readonly ContentApi _api;
    private readonly CorsSettings _cors;
    private readonly ILogger<ContentFunctions> _logger;

    public ContentFunctions(ContentApi api, CorsSettings cors, ILogger<ContentFunctions> logger)
    {
        _api = api;
        _cors = cors;
        _logger = logger;
    }

    [Function("content")]
    public async Task<IActionResult> RunAsync(
        [HttpTrigger(
            AuthorizationLevel.Anonymous,
            "get", "post", "put", "patch", "delete", "options",
            Route = "{*path}")]
        HttpRequest request,
        CancellationToken cancellationToken)
    {
        var response = await _api.HandleAsync(request, cancellationToken);

        if (response.Status >= 500)
        {
            _logger.LogWarning(
                "Content request failed: {Method} {Path} -> {Status}",
                request.Method,
                request.Path,
                response.Status);
        }

        ApplyHeaders(request.HttpContext.Response, request, response);

        if (response.Body is null) return new StatusCodeResult(response.Status);

        return new ContentResult
        {
            StatusCode = response.Status,
            ContentType = "application/json; charset=utf-8",
            Content = JsonSerializer.Serialize(response.Body, response.Body.GetType(), JsonDefaults.Serializer),
        };
    }

    private void ApplyHeaders(HttpResponse httpResponse, HttpRequest request, ApiResponse response)
    {
        CorsPolicy.Apply(httpResponse, request.Headers.Origin.ToString(), _cors);

        httpResponse.Headers["Cache-Control"] = "no-store";
        httpResponse.Headers["X-Content-Type-Options"] = "nosniff";

        if (response.Headers is null) return;

        foreach (var (name, value) in response.Headers)
        {
            httpResponse.Headers[name] = value;
        }
    }
}
