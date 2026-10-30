using System.Text.Json;
using System.Text.Json.Nodes;
using Comply.Functions.Api;
using Comply.Functions.Json;
using Comply.Functions.Services;
using Microsoft.AspNetCore.Http;

namespace Comply.Functions.Tests;

public sealed class ContentApiTests : IDisposable
{
    private static readonly DateTimeOffset Now = new(2026, 10, 30, 12, 0, 0, TimeSpan.Zero);

    private readonly TempWorkspace _workspace = new();
    private readonly ContentApi _api;

    public ContentApiTests()
    {
        _workspace.WriteLibrary(_workspace.DataDirectory, Fixtures.Library());
        _workspace.WriteDocument(
            _workspace.DataDirectory,
            Fixtures.AiActDocumentId,
            """{"id":"doc-ai-act-2024-1689","pages":[{"index":1,"text":"Article 1"}]}""");

        var store = new LibraryStore(_workspace.DataDirectory, _workspace.SeedDirectory);
        var settings = new DeploymentSettings(
            DeploymentMode: null,
            PublicUrl: null,
            TrustHost: "trust.example.com",
            TrustSlug: "nordwind");

        _api = new ContentApi(store, new FixedTimeProvider(Now), settings);
    }

    public void Dispose() => _workspace.Dispose();

    [Fact]
    public async Task Serves_health()
    {
        var response = await _api.HandleAsync(Request("/healthz"));

        Assert.Equal(200, response.Status);
        var body = Body(response);
        Assert.Equal("ok", body["status"]!.GetValue<string>());
        Assert.Equal("2026-10-30T12:00:00.000Z", body["time"]!.GetValue<string>());
    }

    [Fact]
    public async Task Serves_runtime_metadata()
    {
        var response = await _api.HandleAsync(Request("/api/runtime"));

        Assert.Equal(200, response.Status);
        var body = Body(response);
        Assert.Equal("self_hosted", body["deployment"]!.GetValue<string>());
        Assert.Equal("http://localhost", body["publicUrl"]!.GetValue<string>());
        Assert.Equal("trust.example.com", body["trust"]!["host"]!.GetValue<string>());
        Assert.Equal("nordwind", body["trust"]!["slug"]!.GetValue<string>());
        Assert.Equal("edge.comply.app", body["trust"]!["managedHost"]!.GetValue<string>());
        Assert.False(body["passwordLogin"]!.GetValue<bool>());
        Assert.Empty(body["providers"]!.AsArray());
        Assert.False(body["setupRequired"]!.GetValue<bool>());
    }

    [Fact]
    public async Task Serves_framework_summary()
    {
        var response = await _api.HandleAsync(Request("/api/frameworks"));

        Assert.Equal(200, response.Status);
        var frameworks = Body(response)["frameworks"]!.AsArray();
        Assert.Equal(4, frameworks.Count);
        Assert.Equal("ai-act", frameworks[0]!["frameworkId"]!.GetValue<string>());
        Assert.Equal(2, frameworks[0]!["requirements"]!.GetValue<int>());
        Assert.Null(frameworks[2]!["sourceId"]);
    }

    [Fact]
    public async Task Serves_the_whole_library()
    {
        var response = await _api.HandleAsync(Request("/api/library"));

        Assert.Equal(200, response.Status);
        var body = Body(response);
        Assert.Equal(4, body["requirements"]!.AsArray().Count);
        Assert.Equal(4, body["total"]!.GetValue<int>());
        Assert.Equal(1, body["page"]!.GetValue<int>());
        Assert.Equal(4, body["pageSize"]!.GetValue<int>());
        Assert.Equal("2026-10-30T00:00:00.000Z", body["updatedAt"]!.GetValue<string>());
    }

    [Fact]
    public async Task Filters_the_library()
    {
        var response = await _api.HandleAsync(Request("/api/library", queryString: "?framework=nis2&status=published"));

        Assert.Equal(200, response.Status);
        var body = Body(response);
        Assert.Equal(1, body["total"]!.GetValue<int>());
        Assert.Equal("req-nis-2", body["requirements"]![0]!["id"]!.GetValue<string>());
        Assert.Single(body["sources"]!.AsArray());
    }

    [Fact]
    public async Task Rejects_invalid_pagination()
    {
        var response = await _api.HandleAsync(Request("/api/library", queryString: "?page=abc"));

        Assert.Equal(400, response.Status);
        Assert.Contains("page", Body(response)["error"]!.GetValue<string>());
    }

    [Fact]
    public async Task Lists_documents()
    {
        var response = await _api.HandleAsync(Request("/api/documents"));

        Assert.Equal(200, response.Status);
        var documents = Body(response)["documents"]!.AsArray();
        Assert.Equal(2, documents.Count);
        Assert.Equal(Fixtures.AiActDocumentId, documents[0]!["id"]!.GetValue<string>());
    }

    [Fact]
    public async Task Serves_a_document_by_id()
    {
        var response = await _api.HandleAsync(Request($"/api/documents/{Fixtures.AiActDocumentId}"));

        Assert.Equal(200, response.Status);
        var document = Body(response)["document"]!;
        Assert.Equal(Fixtures.AiActDocumentId, document["id"]!.GetValue<string>());
        Assert.Equal("Article 1", document["pages"]![0]!["text"]!.GetValue<string>());
    }

    [Fact]
    public async Task Returns_404_for_a_missing_document()
    {
        var response = await _api.HandleAsync(Request("/api/documents/doc-missing"));

        Assert.Equal(404, response.Status);
        Assert.Equal("Document not found.", Body(response)["error"]!.GetValue<string>());
    }

    [Theory]
    [InlineData("/api/auth/login", "POST")]
    [InlineData("/api/library/sources", "POST")]
    public async Task Reports_unimplemented_areas_as_501(string path, string method)
    {
        var response = await _api.HandleAsync(Request(path, method));

        Assert.Equal(501, response.Status);
        var body = Body(response);
        Assert.Equal("not_implemented", body["code"]!.GetValue<string>());
        Assert.Contains("README.md", body["error"]!.GetValue<string>());
    }

    [Theory]
    [InlineData("/")]
    [InlineData("/index.html")]
    [InlineData("/t/nordwind")]
    public async Task Reports_static_hosting_as_unimplemented(string path)
    {
        var response = await _api.HandleAsync(Request(path));

        Assert.Equal(501, response.Status);
        Assert.Equal("not_implemented", Body(response)["code"]!.GetValue<string>());
    }

    [Fact]
    public async Task Returns_404_for_unknown_api_routes()
    {
        var response = await _api.HandleAsync(Request("/api/nope"));

        Assert.Equal(404, response.Status);
        Assert.Equal("Not found.", Body(response)["error"]!.GetValue<string>());
    }

    [Fact]
    public async Task Rejects_wrong_methods_on_read_routes()
    {
        var response = await _api.HandleAsync(Request("/api/library", "POST"));

        Assert.Equal(405, response.Status);
        Assert.Equal("GET, OPTIONS", response.Headers!["Allow"]);
    }

    [Fact]
    public async Task Answers_cors_preflight()
    {
        var response = await _api.HandleAsync(Request("/api/library", "OPTIONS"));

        Assert.Equal(204, response.Status);
        Assert.Null(response.Body);
    }

    [Fact]
    public async Task Ignores_trailing_slashes()
    {
        var response = await _api.HandleAsync(Request("/api/library///"));

        Assert.Equal(200, response.Status);
    }

    private static HttpRequest Request(string path, string method = "GET", string? queryString = null)
    {
        var context = new DefaultHttpContext();
        context.Request.Method = method;
        context.Request.Path = path;
        context.Request.Scheme = "http";
        context.Request.Host = new HostString("localhost");
        if (queryString is not null) context.Request.QueryString = new QueryString(queryString);
        return context.Request;
    }

    private static JsonNode Body(ApiResponse response) =>
        JsonNode.Parse(JsonSerializer.Serialize(response.Body, response.Body!.GetType(), JsonDefaults.Serializer))!;

    private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
