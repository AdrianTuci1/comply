using System.Text.Json;
using System.Text.Json.Nodes;
using Comply.Functions.Agent;

namespace Comply.Functions.Tests;

public sealed class McpApiTests
{
    private const string Initialize =
        """{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}""";

    private static string Text(JsonNode? node) => node!.GetValue<string>();

    private static JsonObject Parse(JsonNode? node) =>
        node as JsonObject ?? throw new InvalidOperationException("Expected a JSON object.");

    private static string Call(string name, string arguments) =>
        $$$"""
        {"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"{{{name}}}","arguments":{{{arguments}}}}}
        """;

    [Fact]
    public async Task Initialize_answers_with_the_node_handshake()
    {
        using var fixture = new AgentFixture();
        await fixture.RegisterAsync();

        var response = await fixture.SendAsync("/mcp", "POST", Initialize);
        var body = Parse(response.Body);

        Assert.Equal(200, response.Status);
        Assert.Equal("2.0", Text(body["jsonrpc"]));
        Assert.Equal(1, body["id"]!.GetValue<int>());
        Assert.Equal("2025-06-18", Text(body["result"]!["protocolVersion"]));
        Assert.False(body["result"]!["capabilities"]!["tools"]!["listChanged"]!.GetValue<bool>());
        Assert.Equal("comply", Text(body["result"]!["serverInfo"]!["name"]));
        Assert.Equal("1.0.0", Text(body["result"]!["serverInfo"]!["version"]));
        Assert.Equal(
            "Comply guides a compliance assessment. Speak to the user in their language. Publish all scope, evidence, conclusions, and exports in English. Call get_assessment_state after each answer and follow next_actions.",
            Text(body["result"]!["serverInfo"]!["instructions"]));
        Assert.Equal(Text(body["result"]!["serverInfo"]!["instructions"]), Text(body["result"]!["instructions"]));
    }

    [Fact]
    public async Task Initialize_defaults_the_protocol_version()
    {
        using var fixture = new AgentFixture();
        await fixture.RegisterAsync();

        var response = await fixture.SendAsync(
            "/mcp",
            "POST",
            """{"jsonrpc":"2.0","id":"a","method":"initialize"}""");
        var body = Parse(response.Body);

        Assert.Equal("2025-06-18", Text(body["result"]!["protocolVersion"]));
        Assert.Equal("a", Text(body["id"]));
    }

    [Fact]
    public async Task Tools_list_returns_the_fifteen_contract_tools()
    {
        using var fixture = new AgentFixture();
        await fixture.RegisterAsync();

        var response = await fixture.SendAsync(
            "/mcp",
            "POST",
            """{"jsonrpc":"2.0","id":2,"method":"tools/list"}""");
        var tools = Parse(response.Body)["result"]!["tools"]!.AsArray();

        Assert.Equal(15, tools.Count);
        Assert.Equal(
            new[]
            {
                "get_agent_guide", "start_assessment", "list_assessments", "get_assessment_state",
                "set_scope", "get_brief", "list_requirements", "search_requirements", "get_progress",
                "get_requirement", "submit_evidence", "complete_requirement", "mark_not_applicable",
                "review_assessment", "export_assessment",
            },
            tools.Select(tool => Text(tool!["name"])).ToArray());
        Assert.Equal("Start a guided assessment", Text(tools[1]!["title"]));
        Assert.Equal("object", Text(tools[1]!["inputSchema"]!["type"]));
        Assert.False(tools[1]!["inputSchema"]!["additionalProperties"]!.GetValue<bool>());
    }

    [Fact]
    public async Task Resources_and_prompts_are_empty()
    {
        using var fixture = new AgentFixture();
        await fixture.RegisterAsync();

        var resources = Parse((await fixture.SendAsync(
            "/mcp", "POST", """{"jsonrpc":"2.0","id":3,"method":"resources/list"}""")).Body);
        var prompts = Parse((await fixture.SendAsync(
            "/mcp", "POST", """{"jsonrpc":"2.0","id":4,"method":"prompts/list"}""")).Body);
        var ping = Parse((await fixture.SendAsync(
            "/mcp", "POST", """{"jsonrpc":"2.0","id":5,"method":"ping"}""")).Body);

        Assert.Empty(resources["result"]!["resources"]!.AsArray());
        Assert.Empty(prompts["result"]!["prompts"]!.AsArray());
        Assert.Empty(Parse(ping["result"]));
    }

    [Fact]
    public async Task Tools_call_returns_text_and_structured_content()
    {
        using var fixture = new AgentFixture();
        await fixture.RegisterAsync();

        var response = await fixture.SendAsync(
            "/mcp",
            "POST",
            Call("start_assessment", """{"framework":"nis2","scope":"Production systems."}"""));
        var result = Parse(response.Body)["result"]!;

        Assert.False(result["isError"]!.GetValue<bool>());
        Assert.Equal("text", Text(result["content"]![0]!["type"]));
        var structured = Parse(result["structuredContent"]);
        Assert.Equal("collect", Text(structured["phase"]));
        Assert.Equal("en", Text(structured["language_policy"]!["publishLanguage"]));

        var text = Text(result["content"]![0]!["text"]);
        using var parsed = JsonDocument.Parse(text);
        Assert.Equal(
            Text(structured["assessment_id"]),
            parsed.RootElement.GetProperty("assessment_id").GetString());
        Assert.Contains("\n  \"assessment_id\"", text);
    }

    [Fact]
    public async Task Tools_call_reports_agent_errors_as_tool_results()
    {
        using var fixture = new AgentFixture();
        await fixture.RegisterAsync();

        var response = await fixture.SendAsync("/mcp", "POST", Call("start_assessment", """{"framework":"gdpr"}"""));
        var result = Parse(response.Body)["result"]!;

        Assert.Equal(200, response.Status);
        Assert.True(result["isError"]!.GetValue<bool>());
        var error = Parse(result["structuredContent"]!["error"]);
        Assert.Equal("invalid_framework", Text(error["code"]));
        Assert.Equal("Choose a framework: nis2, iso27001, ai-act, soc2.", Text(error["message"]));
        Assert.Null(error["details"]);
        Assert.Contains("Choose a framework", Text(result["content"]![0]!["text"]));
        Assert.Contains("\"code\": \"invalid_framework\"", Text(result["content"]![0]!["text"]));
    }

    [Fact]
    public async Task Review_errors_keep_their_details()
    {
        using var fixture = new AgentFixture();
        await fixture.RegisterAsync();
        var started = Parse((await fixture.SendAsync(
            "/mcp",
            "POST",
            Call("start_assessment", """{"framework":"nis2","scope":"Production."}"""))).Body);
        var assessmentId = Text(started["result"]!["structuredContent"]!["assessment_id"]);

        var response = await fixture.SendAsync(
            "/mcp",
            "POST",
            Call("review_assessment", $$"""{"assessmentId":"{{assessmentId}}"}"""));
        var error = Parse(Parse(response.Body)["result"]!["structuredContent"]!["error"]);

        Assert.Equal("requirements_open", Text(error["code"]));
        Assert.Equal(5, error["details"]!.AsArray().Count);
    }

    [Fact]
    public async Task Unknown_tools_and_methods_return_json_rpc_errors()
    {
        using var fixture = new AgentFixture();
        await fixture.RegisterAsync();

        var tool = Parse((await fixture.SendAsync("/mcp", "POST", Call("nope", "{}"))).Body);
        var method = Parse((await fixture.SendAsync(
            "/mcp", "POST", """{"jsonrpc":"2.0","id":9,"method":"tools/execute"}""")).Body);

        Assert.Equal(-32602, tool["error"]!["code"]!.GetValue<int>());
        Assert.Equal("Unknown tool: nope.", Text(tool["error"]!["message"]));
        Assert.Equal(-32601, method["error"]!["code"]!.GetValue<int>());
        Assert.Equal("Method not found: tools/execute.", Text(method["error"]!["message"]));
    }

    [Fact]
    public async Task Invalid_requests_return_minus_32600()
    {
        using var fixture = new AgentFixture();
        await fixture.RegisterAsync();

        var wrongVersion = Parse((await fixture.SendAsync(
            "/mcp", "POST", """{"jsonrpc":"1.0","id":1,"method":"initialize"}""")).Body);
        var noMethod = Parse((await fixture.SendAsync(
            "/mcp", "POST", """{"jsonrpc":"2.0","id":2}""")).Body);
        var empty = Parse((await fixture.SendAsync("/mcp", "POST", """{"id":3}""")).Body);

        Assert.Equal(-32600, wrongVersion["error"]!["code"]!.GetValue<int>());
        Assert.Equal("Invalid Request", Text(wrongVersion["error"]!["message"]));
        Assert.Equal(2, noMethod["id"]!.GetValue<int>());
        Assert.Equal(-32600, noMethod["error"]!["code"]!.GetValue<int>());
        Assert.Equal(3, empty["id"]!.GetValue<int>());
        Assert.Equal(-32600, empty["error"]!["code"]!.GetValue<int>());
    }

    [Fact]
    public async Task Malformed_json_returns_400()
    {
        using var fixture = new AgentFixture();
        await fixture.RegisterAsync();

        var response = await fixture.SendAsync("/mcp", "POST", "{not json");

        Assert.Equal(400, response.Status);
        Assert.Equal("Request body must be valid JSON.", Text(Parse(response.Body)!["error"]));
    }

    [Fact]
    public async Task Notifications_return_204_without_a_body()
    {
        using var fixture = new AgentFixture();
        await fixture.RegisterAsync();

        var response = await fixture.SendAsync(
            "/mcp",
            "POST",
            """{"jsonrpc":"2.0","method":"notifications/initialized"}""");

        Assert.Equal(204, response.Status);
        Assert.Null(response.Body);
    }

    [Fact]
    public async Task Get_mcp_returns_405_with_allow_post()
    {
        using var fixture = new AgentFixture();
        await fixture.RegisterAsync();

        var response = await fixture.SendAsync("/mcp", "GET");

        Assert.Equal(405, response.Status);
        Assert.Equal("POST", response.Headers!["Allow"]);
        Assert.Equal("Use POST with a JSON-RPC request.", Text(Parse(response.Body)!["error"]));
    }

    [Fact]
    public async Task Mcp_requires_a_key_outside_development()
    {
        using var fixture = new AgentFixture(devLinks: false, production: true);
        await fixture.RegisterAsync();
        var created = await fixture.Keys.CreateAsync(fixture.Organization!, "Harness", new JsonArray("read"));

        var anonymous = await fixture.SendAsync("/mcp", "POST", Initialize);
        var forged = await fixture.SendAsync("/mcp", "POST", Initialize, bearer: $"sk_mcp_nordwind_{new string('a', 64)}");
        var mismatch = await fixture.SendAsync("/mcp", "POST", Initialize, bearer: created.Secret, tenant: "helios");
        var allowed = await fixture.SendAsync("/mcp", "POST", Initialize, bearer: created.Secret);

        Assert.Equal(401, anonymous.Status);
        Assert.Equal("Not signed in.", Text(Parse(anonymous.Body)!["error"]));
        Assert.Equal(401, forged.Status);
        Assert.Equal(403, mismatch.Status);
        Assert.Equal(
            "The tenant header does not match the tenant in the MCP key.",
            Text(Parse(mismatch.Body)!["error"]));
        Assert.Equal(200, allowed.Status);
    }

    [Fact]
    public async Task The_key_tenant_owns_assessments_created_over_mcp()
    {
        using var fixture = new AgentFixture();
        await fixture.RegisterAsync();
        await fixture.OtherOrganizationAsync();
        var helios = await fixture.Keys.CreateAsync(
            await fixture.OtherOrganizationAsync(),
            "Helios harness",
            new JsonArray("read", "evidence:write"));

        var started = Parse((await fixture.SendAsync(
            "/mcp",
            "POST",
            Call("start_assessment", """{"framework":"nis2","scope":"Helios production."}"""),
            bearer: helios.Secret)).Body);
        Assert.False(started["result"]!["isError"]!.GetValue<bool>());

        var heliosList = Parse((await fixture.SendAsync(
            "/api/agent/assessments",
            bearer: helios.Secret)).Body);
        var nordwindList = Parse((await fixture.SendAsync(
            "/api/agent/assessments",
            bearer: fixture.Session)).Body);

        Assert.Single(heliosList["assessments"]!.AsArray());
        Assert.Empty(nordwindList["assessments"]!.AsArray());
    }

    [Fact]
    public async Task A_session_bearer_can_call_tools()
    {
        using var fixture = new AgentFixture();
        var session = await fixture.RegisterAsync();

        var response = await fixture.SendAsync(
            "/mcp",
            "POST",
            Call("start_assessment", """{"framework":"nis2","scope":"Production."}"""),
            bearer: session.Session);
        var body = Parse(response.Body);

        Assert.False(body["result"]!["isError"]!.GetValue<bool>());
        Assert.Equal("collect", Text(body["result"]!["structuredContent"]!["phase"]));
    }
}
