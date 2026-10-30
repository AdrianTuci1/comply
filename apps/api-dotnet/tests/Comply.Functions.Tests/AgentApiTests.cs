using System.Text.Json.Nodes;

namespace Comply.Functions.Tests;

public sealed class AgentApiTests
{
    private static string Text(JsonNode? node) => node!.GetValue<string>();

    private static JsonObject Parse(JsonNode? node) =>
        node as JsonObject ?? throw new InvalidOperationException("Expected a JSON object.");

    private static async Task<string> StartAsync(AgentFixture fixture, string? bearer = null, string? tenant = null)
    {
        var started = await fixture.CallAsync(
            "start_assessment",
            """{"framework":"nis2","scope":"Production systems."}""");
        return Text(started["assessment_id"]);
    }

    [Fact]
    public async Task Assessments_and_boards_list_the_same_summaries()
    {
        using var fixture = new AgentFixture();
        var session = await fixture.RegisterAsync();
        var assessmentId = await StartAsync(fixture);

        var assessments = Parse((await fixture.SendAsync(
            "/api/agent/assessments", bearer: session.Session)).Body);
        var boards = Parse((await fixture.SendAsync(
            "/api/agent/boards", bearer: session.Session)).Body);

        Assert.Single(assessments["assessments"]!.AsArray());
        Assert.Single(boards["boards"]!.AsArray());
        Assert.Equal(assessmentId, Text(assessments["assessments"]![0]!["assessment_id"]));
        Assert.Equal("NIS2 assessment", Text(boards["boards"]![0]!["name"]));
        Assert.Equal("collect", Text(boards["boards"]![0]!["phase"]));
        Assert.Equal(5, boards["boards"]![0]!["progress"]!["total"]!.GetValue<int>());
        Assert.Equal("2026-01-01", Text(boards["boards"]![0]!["period"]!["from"]));
    }

    [Fact]
    public async Task Board_and_assessment_detail_return_the_items()
    {
        using var fixture = new AgentFixture();
        var session = await fixture.RegisterAsync();
        var assessmentId = await StartAsync(fixture);

        var board = Parse((await fixture.SendAsync(
            $"/api/agent/boards/{assessmentId}", bearer: session.Session)).Body);
        var detail = Parse((await fixture.SendAsync(
            $"/api/agent/assessments/{assessmentId}", bearer: session.Session)).Body);

        Assert.Equal(5, board["assessment"]!["total"]!.GetValue<int>());
        Assert.Equal(5, detail["total"]!.GetValue<int>());
        Assert.Equal("req-nis2-risk", Text(detail["items"]![0]!["requirement_id"]));
        Assert.Equal("governance", Text(detail["items"]![0]!["theme"]));
        Assert.Equal("extracted", Text(detail["items"]![0]!["contentStatus"]));
        Assert.Equal("en", Text(detail["language_policy"]!["publishLanguage"]));
    }

    [Fact]
    public async Task Unknown_assessments_return_400_with_the_agent_code()
    {
        using var fixture = new AgentFixture();
        var session = await fixture.RegisterAsync();

        var response = await fixture.SendAsync("/api/agent/boards/asm-missing", bearer: session.Session);

        Assert.Equal(400, response.Status);
        Assert.Equal("Assessment not found for this tenant.", Text(Parse(response.Body)!["error"]));
        Assert.Equal("not_found", Text(Parse(response.Body)!["code"]));
    }

    [Fact]
    public async Task List_pagination_is_optional()
    {
        using var fixture = new AgentFixture();
        var session = await fixture.RegisterAsync();
        await StartAsync(fixture);
        fixture.Time.Advance(TimeSpan.FromMinutes(1));
        await StartAsync(fixture);

        var paged = Parse((await fixture.SendAsync(
            "/api/agent/assessments",
            bearer: session.Session,
            query: "?page=1&pageSize=1")).Body);

        Assert.Single(paged["assessments"]!.AsArray());
        Assert.Equal(2, paged["total"]!.GetValue<int>());
        Assert.True(paged["page_info"]!["has_next_page"]!.GetValue<bool>());
    }

    [Fact]
    public async Task Keys_are_listed_created_and_revoked()
    {
        using var fixture = new AgentFixture();
        var session = await fixture.RegisterAsync();

        var empty = Parse((await fixture.SendAsync("/api/access/keys", bearer: session.Session)).Body);
        Assert.Empty(empty["keys"]!.AsArray());

        var created = await fixture.SendAsync(
            "/api/access/keys",
            "POST",
            """{"name":"CI harness","scopes":["read","evidence:write"]}""",
            bearer: session.Session);
        var body = Parse(created.Body);
        var secret = Text(body["secret"]);
        var key = body["key"]!;

        Assert.Equal(201, created.Status);
        Assert.Matches("^sk_mcp_nordwind_[a-f0-9]{64}$", secret);
        Assert.Equal("nordwind", Text(key["tenantId"]));
        Assert.Equal("CI harness", Text(key["name"]));
        Assert.Equal(6, Text(key["prefix"])["sk_mcp_nordwind_".Length..].Length);
        Assert.Null(key["hash"]);
        Assert.Null(key["revokedAt"]);

        var listed = Parse((await fixture.SendAsync("/api/access/keys", bearer: session.Session)).Body);
        Assert.Single(listed["keys"]!.AsArray());

        var revoked = await fixture.SendAsync(
            $"/api/access/keys/{Text(key["id"])}", "DELETE", bearer: session.Session);
        var again = await fixture.SendAsync(
            $"/api/access/keys/{Text(key["id"])}", "DELETE", bearer: session.Session);
        var missing = await fixture.SendAsync("/api/access/keys/key-missing", "DELETE", bearer: session.Session);

        Assert.Equal(204, revoked.Status);
        Assert.Equal(204, again.Status);
        Assert.Equal(404, missing.Status);
        Assert.Equal("The key was not found.", Text(Parse(missing.Body)!["error"]));
    }

    [Fact]
    public async Task Key_validation_errors_match_the_node_bodies()
    {
        using var fixture = new AgentFixture();
        var session = await fixture.RegisterAsync();

        var name = await fixture.SendAsync(
            "/api/access/keys", "POST", """{"name":" ","scopes":["read"]}""", bearer: session.Session);
        var scopes = await fixture.SendAsync(
            "/api/access/keys", "POST", """{"name":"CI","scopes":["write"]}""", bearer: session.Session);
        var none = await fixture.SendAsync(
            "/api/access/keys", "POST", """{"name":"CI"}""", bearer: session.Session);
        var malformed = await fixture.SendAsync(
            "/api/access/keys", "POST", "{", bearer: session.Session);

        Assert.Equal(400, name.Status);
        Assert.Equal("The key needs a name.", Text(Parse(name.Body)!["error"]));
        Assert.Null(Parse(name.Body)!["code"]);
        Assert.Equal("Unknown access scope: write.", Text(Parse(scopes.Body)!["error"]));
        Assert.Equal("Choose at least one permission for the key.", Text(Parse(none.Body)!["error"]));
        Assert.Equal(400, malformed.Status);
        Assert.Equal("Request body must be valid JSON.", Text(Parse(malformed.Body)!["error"]));
    }

    [Fact]
    public async Task A_key_reads_only_its_own_tenant()
    {
        using var fixture = new AgentFixture();
        await fixture.RegisterAsync();
        await StartAsync(fixture);
        var helios = await fixture.OtherOrganizationAsync();
        var key = await fixture.Keys.CreateAsync(helios, "Helios harness", new JsonArray("read"));

        var heliosList = Parse((await fixture.SendAsync("/api/agent/assessments", bearer: key.Secret)).Body);

        Assert.Empty(heliosList["assessments"]!.AsArray());
    }

    [Fact]
    public async Task Development_uses_the_tenant_header_without_a_session()
    {
        using var fixture = new AgentFixture();
        await fixture.RegisterAsync();
        await StartAsync(fixture);
        await fixture.OtherOrganizationAsync();

        var nordwind = Parse((await fixture.SendAsync("/api/agent/assessments", tenant: "nordwind")).Body);
        var helios = Parse((await fixture.SendAsync("/api/agent/boards", tenant: "helios")).Body);

        Assert.Single(nordwind["assessments"]!.AsArray());
        Assert.Empty(helios["boards"]!.AsArray());
    }

    [Fact]
    public async Task Production_requires_a_session_for_the_agent_routes()
    {
        using var fixture = new AgentFixture(devLinks: false, production: true);
        await fixture.RegisterAsync();

        var response = await fixture.SendAsync("/api/agent/assessments", tenant: "nordwind");

        Assert.Equal(401, response.Status);
        Assert.Equal("Not signed in.", Text(Parse(response.Body)!["error"]));
    }

    [Fact]
    public async Task Unknown_agent_routes_fall_through_to_404()
    {
        using var fixture = new AgentFixture();
        var session = await fixture.RegisterAsync();

        var response = await fixture.SendAsync("/api/unknown", bearer: session.Session);

        Assert.Equal(404, response.Status);
        Assert.Equal("Not found.", Text(Parse(response.Body)!["error"]));
    }
}
