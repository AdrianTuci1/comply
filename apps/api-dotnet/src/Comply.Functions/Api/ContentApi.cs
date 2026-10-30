using System.Globalization;
using System.Text.Json;
using Comply.Functions.Auth;
using Comply.Functions.Ingest;
using Comply.Functions.Models;
using Comply.Functions.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Json;

namespace Comply.Functions.Api;

/// <summary>
/// Read-only content API over <see cref="LibraryStore"/>. The route table mirrors the GET
/// surface of the Node server in <c>apps/api-node/lib/api.mjs</c>; everything else is
/// reported as not implemented instead of silently 404ing.
/// </summary>
public sealed class ContentApi
{
    private const string NotImplementedCode = "not_implemented";

    private static readonly (string Prefix, string Feature)[] UnimplementedRoutes =
    [
        ("/api/auth", "Authentication"),
        ("/api/library", "Library writes"),
    ];

    private static readonly string[] ReadRoutes =
    [
        "/healthz",
        "/api/runtime",
        "/api/frameworks",
        "/api/library",
        "/api/documents",
    ];

    private readonly LibraryStore _store;
    private readonly TimeProvider _time;
    private readonly DeploymentSettings _settings;
    private readonly AuthApi? _auth;
    private readonly AgentApi? _agent;
    private readonly IngestCoordinator? _ingest;

    public ContentApi(
        LibraryStore store,
        TimeProvider time,
        DeploymentSettings settings,
        AuthApi? auth = null,
        AgentApi? agent = null,
        IngestCoordinator? ingest = null)
    {
        _store = store;
        _time = time;
        _settings = settings;
        _auth = auth;
        _agent = agent;
        _ingest = ingest;
    }

    public async Task<ApiResponse> HandleAsync(HttpRequest request, CancellationToken cancellationToken = default)
    {
        var method = request.Method;
        if (HttpMethods.IsOptions(method)) return ApiResponse.NoContent();

        var path = NormalizePath(request.Path.Value);

        if (_auth is not null)
        {
            var authResponse = await _auth.TryHandleAsync(request, path, cancellationToken);
            if (authResponse is not null) return authResponse;
        }

        if (_agent is not null)
        {
            var agentResponse = await _agent.TryHandleAsync(request, path, cancellationToken);
            if (agentResponse is not null) return agentResponse;
        }

        if (ReadRoutes.Contains(path) && !IsRead(method))
        {
            return ApiResponse.MethodNotAllowed();
        }

        switch (path)
        {
            case "/healthz":
                return ApiResponse.Ok(new HealthStatus("ok", Timestamp(_time.GetUtcNow())));

            case "/api/runtime":
                return ApiResponse.Ok(await BuildRuntimeAsync(request, cancellationToken));

            case "/api/frameworks":
            {
                var library = await _store.GetAsync(cancellationToken);
                return ApiResponse.Ok(new FrameworkList(FrameworkCatalog.Summarize(library)));
            }

            case "/api/library":
            {
                if (!LibraryQuery.TryParse(request.Query, out var query, out var error))
                {
                    return ApiResponse.Error(400, error!);
                }

                var library = await _store.GetAsync(cancellationToken);
                return ApiResponse.Ok(LibraryFilter.Apply(library, query));
            }

            case "/api/documents":
            {
                var library = await _store.GetAsync(cancellationToken);
                return ApiResponse.Ok(new DocumentList(library.Documents));
            }
        }

        const string documentPrefix = "/api/documents/";
        if (path.StartsWith(documentPrefix, StringComparison.Ordinal))
        {
            if (!IsRead(method)) return ApiResponse.MethodNotAllowed();

            var document = await _store.GetDocumentAsync(path[documentPrefix.Length..], cancellationToken);
            return document is null
                ? ApiResponse.Error(404, "Document not found.")
                : ApiResponse.Ok(new DocumentEnvelope(document));
        }

        if (_ingest is not null)
        {
            var ingestResponse = await TryIngestAsync(request, path, _ingest, cancellationToken);
            if (ingestResponse is not null) return ingestResponse;
        }

        foreach (var (prefix, feature) in UnimplementedRoutes)
        {
            if (path == prefix || path.StartsWith($"{prefix}/", StringComparison.Ordinal))
            {
                return ApiResponse.Error(
                    501,
                    $"{feature} is not implemented by the .NET Functions host yet. See apps/api-dotnet/README.md.",
                    NotImplementedCode);
            }
        }

        if (path == "/api" || path.StartsWith("/api/", StringComparison.Ordinal))
        {
            return ApiResponse.Error(404, "Not found.");
        }

        return ApiResponse.Error(
            501,
            "Static hosting is not implemented by the .NET Functions host. Keep the Angular build on App Service or Azure Static Web Apps.",
            NotImplementedCode);
    }

    /// <summary>
    /// Routes <c>/api/ingest</c>, <c>/api/ingest/schedule</c> and <c>/api/ingest/{id}</c> to the
    /// coordinator. Returns null when the path is not an ingest route so the caller can fall
    /// through to the remaining route table.
    /// </summary>
    private static async Task<ApiResponse?> TryIngestAsync(
        HttpRequest request,
        string path,
        IngestCoordinator ingest,
        CancellationToken cancellationToken)
    {
        if (path == "/api/ingest")
        {
            if (IsRead(request.Method))
            {
                return ApiResponse.Ok(new IngestJobList(ingest.ListJobs()));
            }

            if (!HttpMethods.IsPost(request.Method))
            {
                return ApiResponse.MethodNotAllowed();
            }

            var body = await ReadBodyAsync(request, cancellationToken);
            if (body is null) return ApiResponse.Error(400, "Request body must be valid JSON.");

            string? framework = null;
            if (body.Value.ValueKind == JsonValueKind.Object
                && body.Value.TryGetProperty("framework", out var property)
                && property.ValueKind is not JsonValueKind.Null and not JsonValueKind.Undefined)
            {
                framework = property.ToString();
            }

            var start = ingest.StartJob(framework);
            return start.Job is null
                ? ApiResponse.Error(start.Status, start.Error ?? "Ingest could not be started.")
                : new ApiResponse(start.Status, new IngestJobEnvelope(start.Job));
        }

        if (path == "/api/ingest/schedule")
        {
            if (!IsRead(request.Method)) return ApiResponse.MethodNotAllowed();
            return ApiResponse.Ok(new IngestScheduleEnvelope(ingest.GetSchedule()));
        }

        const string jobPrefix = "/api/ingest/";
        if (path.StartsWith(jobPrefix, StringComparison.Ordinal))
        {
            if (!IsRead(request.Method)) return ApiResponse.MethodNotAllowed();

            var id = path[jobPrefix.Length..];
            if (id.Length == 0 || id.Contains('/')) return ApiResponse.Error(404, "Not found.");

            var job = ingest.FindJob(id);
            return job is null
                ? ApiResponse.Error(404, "Job not found.")
                : ApiResponse.Ok(new IngestJobEnvelope(job));
        }

        return null;
    }

    private static async Task<JsonElement?> ReadBodyAsync(
        HttpRequest request,
        CancellationToken cancellationToken)
    {
        try
        {
            using var document = await JsonDocument.ParseAsync(
                request.Body,
                cancellationToken: cancellationToken);
            return document.RootElement.Clone();
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private sealed record IngestJobList(IReadOnlyList<IngestJobSnapshot> Jobs);

    private sealed record IngestJobEnvelope(IngestJobSnapshot Job);

    private sealed record IngestScheduleEnvelope(IngestScheduleSnapshot Schedule);

    private async Task<RuntimeInfo> BuildRuntimeAsync(HttpRequest request, CancellationToken cancellationToken)
    {
        var deployment = _settings.DeploymentMode
            ?? (string.IsNullOrEmpty(_settings.TrustHost) ? "managed" : "self_hosted");

        var auth = _auth is null
            ? new RuntimeAuthInfo(false, [], false)
            : await _auth.RuntimeAsync(cancellationToken);

        return new RuntimeInfo(
            deployment,
            PublicOrigin(request),
            new RuntimeTrust(_settings.TrustHost, _settings.TrustSlug, "edge.comply.app"),
            PasswordLogin: auth.PasswordLogin,
            Providers: auth.Providers,
            SetupRequired: auth.SetupRequired);
    }

    private string PublicOrigin(HttpRequest request) =>
        RequestOrigin.Resolve(request, _settings.PublicUrl);

    private static bool IsRead(string method) =>
        HttpMethods.IsGet(method) || HttpMethods.IsHead(method);

    private static string NormalizePath(string? path)
    {
        var value = string.IsNullOrEmpty(path) ? "/" : path.TrimEnd('/');
        return value.Length == 0 ? "/" : value;
    }

    private static string Timestamp(DateTimeOffset value) =>
        value.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
}
