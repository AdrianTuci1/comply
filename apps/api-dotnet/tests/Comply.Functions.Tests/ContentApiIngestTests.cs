using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Comply.Functions.Api;
using Comply.Functions.Ingest;
using Comply.Functions.Json;
using Comply.Functions.Services;
using Comply.Functions.Tests.Ingest;
using Microsoft.AspNetCore.Http;

namespace Comply.Functions.Tests;

public sealed class ContentApiIngestTests : IDisposable
{
    private static readonly DateTimeOffset Now = new(2026, 10, 30, 12, 0, 0, TimeSpan.Zero);

    private readonly TempWorkspace _workspace = new();
    private readonly IngestCoordinator _coordinator;
    private readonly ContentApi _api;

    public ContentApiIngestTests()
    {
        _workspace.WriteLibrary(_workspace.DataDirectory, Fixtures.Library());

        var library = new LibraryStore(_workspace.DataDirectory, _workspace.SeedDirectory);
        var time = new ManualTimeProvider(Now);
        _coordinator = new IngestCoordinator(
            new RecordingIngestRunner(["ai-act", "nis2"]),
            new IngestStore(library, time),
            time,
            new IngestScheduleOptions { IntervalHours = 0 });

        var settings = new DeploymentSettings(
            DeploymentMode: null,
            PublicUrl: null,
            TrustHost: null,
            TrustSlug: null);

        _api = new ContentApi(library, time, settings, ingest: _coordinator);
    }

    public void Dispose()
    {
        _coordinator.Dispose();
        _workspace.Dispose();
    }

    [Fact]
    public async Task Lists_jobs()
    {
        var response = await _api.HandleAsync(Request("/api/ingest"));

        Assert.Equal(200, response.Status);
        Assert.Empty(Body(response)["jobs"]!.AsArray());
    }

    [Fact]
    public async Task Starts_a_job_and_serves_it_by_id()
    {
        var start = await _api.HandleAsync(Request("/api/ingest", "POST", """{"framework":"nis2"}"""));

        Assert.Equal(202, start.Status);
        var job = Body(start)["job"]!;
        var id = job["id"]!.GetValue<string>();
        Assert.Equal("nis2", job["framework"]!.GetValue<string>());

        await _coordinator.GetCompletion(id)!;

        var response = await _api.HandleAsync(Request($"/api/ingest/{id}"));
        Assert.Equal(200, response.Status);
        Assert.Equal("succeeded", Body(response)["job"]!["status"]!.GetValue<string>());
    }

    [Fact]
    public async Task Rejects_an_unknown_framework()
    {
        var response = await _api.HandleAsync(Request("/api/ingest", "POST", """{"framework":"hipaa"}"""));

        Assert.Equal(400, response.Status);
        Assert.Contains("Unknown framework", Body(response)["error"]!.GetValue<string>());
    }

    [Fact]
    public async Task Rejects_an_invalid_json_body()
    {
        var response = await _api.HandleAsync(Request("/api/ingest", "POST", "{"));

        Assert.Equal(400, response.Status);
        Assert.Equal("Request body must be valid JSON.", Body(response)["error"]!.GetValue<string>());
    }

    [Fact]
    public async Task Returns_404_for_a_missing_job()
    {
        var response = await _api.HandleAsync(Request("/api/ingest/does-not-exist"));

        Assert.Equal(404, response.Status);
        Assert.Equal("Job not found.", Body(response)["error"]!.GetValue<string>());
    }

    [Fact]
    public async Task Serves_the_schedule()
    {
        var response = await _api.HandleAsync(Request("/api/ingest/schedule"));

        Assert.Equal(200, response.Status);
        var schedule = Body(response)["schedule"]!;
        Assert.False(schedule["enabled"]!.GetValue<bool>());
        Assert.Null(schedule["running"]);
    }

    private static HttpRequest Request(string path, string method = "GET", string? body = null)
    {
        var context = new DefaultHttpContext();
        context.Request.Method = method;
        context.Request.Path = path;
        context.Request.Scheme = "http";
        context.Request.Host = new HostString("localhost");
        if (body is not null)
        {
            context.Request.Body = new MemoryStream(Encoding.UTF8.GetBytes(body));
            context.Request.ContentType = "application/json";
        }

        return context.Request;
    }

    private static JsonNode Body(ApiResponse response) =>
        JsonNode.Parse(JsonSerializer.Serialize(response.Body, response.Body!.GetType(), JsonDefaults.Serializer))!;
}
