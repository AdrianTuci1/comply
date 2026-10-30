using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Comply.Functions.Agent;
using Comply.Functions.Models;
using Comply.Functions.Services;
using Microsoft.AspNetCore.Http;

namespace Comply.Functions.Api;

/// <summary>
/// Agent, MCP-key and MCP surfaces. Route shapes, status codes and bodies mirror
/// <c>apps/api-node/lib/api.mjs</c> (routes around <c>/mcp</c>, <c>/api/access/keys</c> and
/// <c>/api/agent/*</c>) so the Angular client and MCP clients see the same contract.
/// </summary>
public sealed partial class AgentApi(
    AgentService agent,
    McpKeyService keys,
    TenantContext tenant,
    McpToolCatalog? catalog = null)
{
    private static readonly JsonSerializerOptions PrettyJson = new()
    {
        WriteIndented = true,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    private readonly AgentService _agent = agent;
    private readonly McpKeyService _keys = keys;
    private readonly TenantContext _tenant = tenant;
    private readonly McpToolCatalog _catalog = catalog ?? McpToolCatalog.Default;

    public async Task<ApiResponse?> TryHandleAsync(
        HttpRequest request,
        string path,
        CancellationToken cancellationToken = default)
    {
        if (!IsAgentPath(path)) return null;

        try
        {
            if (path == "/mcp")
            {
                if (HttpMethods.IsPost(request.Method)) return await McpAsync(request, cancellationToken);
                if (HttpMethods.IsGet(request.Method))
                {
                    return new ApiResponse(
                        405,
                        new ErrorBody("Use POST with a JSON-RPC request."),
                        new Dictionary<string, string> { ["Allow"] = "POST" });
                }

                return null;
            }

            if (path == "/api/access/keys")
            {
                if (IsGet(request.Method)) return await ListKeysAsync(request, cancellationToken);
                if (HttpMethods.IsPost(request.Method)) return await CreateKeyAsync(request, cancellationToken);
                return null;
            }

            var keyMatch = KeyRoute().Match(path);
            if (keyMatch.Success && HttpMethods.IsDelete(request.Method))
            {
                var scope = await _tenant.ResolveAsync(request, cancellationToken);
                await _keys.RevokeAsync(scope.Organization, keyMatch.Groups["id"].Value, cancellationToken);
                return ApiResponse.NoContent();
            }

            if (path == "/api/agent/assessments" && IsGet(request.Method))
            {
                return await ListAssessmentsAsync(request, "assessments", cancellationToken);
            }

            if (path == "/api/agent/boards" && IsGet(request.Method))
            {
                return await ListAssessmentsAsync(request, "boards", cancellationToken);
            }

            var boardMatch = BoardRoute().Match(path);
            if (boardMatch.Success && IsGet(request.Method))
            {
                var scope = await _tenant.ResolveAsync(request, cancellationToken);
                return ApiResponse.Ok(new JsonObject
                {
                    ["assessment"] = await _agent.DetailAsync(
                        scope.OrganizationId,
                        boardMatch.Groups["id"].Value,
                        cancellationToken),
                });
            }

            var assessmentMatch = AssessmentRoute().Match(path);
            if (assessmentMatch.Success && IsGet(request.Method))
            {
                var scope = await _tenant.ResolveAsync(request, cancellationToken);
                return ApiResponse.Ok(await _agent.DetailAsync(
                    scope.OrganizationId,
                    assessmentMatch.Groups["id"].Value,
                    cancellationToken));
            }

            return null;
        }
        catch (TenantException exception)
        {
            return ApiResponse.Error(exception.Status, exception.Message);
        }
        catch (McpKeyException exception)
        {
            return ApiResponse.Error(exception.Status, exception.Message);
        }
        catch (AgentException exception)
        {
            return ApiResponse.Error(exception.Status, exception.Message, exception.Code);
        }
    }

    private async Task<ApiResponse> ListAssessmentsAsync(
        HttpRequest request,
        string member,
        CancellationToken cancellationToken)
    {
        var scope = await _tenant.ResolveAsync(request, cancellationToken);

        if (!request.Query.ContainsKey("page") && !request.Query.ContainsKey("pageSize"))
        {
            return ApiResponse.Ok(new JsonObject
            {
                [member] = await _agent.ListSummariesAsync(scope.OrganizationId, cancellationToken),
            });
        }

        var page = AgentService.PageNumber(AgentText.ParseInt(null, request.Query["page"].ToString()));
        var pageSize = AgentService.PageSize(AgentText.ParseInt(null, request.Query["pageSize"].ToString()));
        var (items, total) = await _agent.ListSummariesPageAsync(
            scope.OrganizationId,
            page,
            pageSize,
            cancellationToken);

        return ApiResponse.Ok(new JsonObject
        {
            [member] = items,
            ["total"] = total,
            ["page"] = page,
            ["pageSize"] = pageSize,
            ["page_info"] = AgentJson.PageInfo(total, page, pageSize),
        });
    }

    private async Task<ApiResponse> ListKeysAsync(HttpRequest request, CancellationToken cancellationToken)
    {
        var scope = await _tenant.ResolveAsync(request, cancellationToken);
        var list = await _keys.ListAsync(scope.Organization, cancellationToken);

        var array = new JsonArray();
        foreach (var key in list) array.Add(key.ToJson());
        return ApiResponse.Ok(new JsonObject { ["keys"] = array });
    }

    private async Task<ApiResponse> CreateKeyAsync(HttpRequest request, CancellationToken cancellationToken)
    {
        var scope = await _tenant.ResolveAsync(request, cancellationToken);
        var body = await ReadJsonAsync(request, cancellationToken);
        if (body is null)
        {
            return ApiResponse.Error(400, "Request body must be valid JSON.");
        }

        var json = body as JsonObject;
        var created = await _keys.CreateAsync(
            scope.Organization,
            Text(json?["name"]),
            json?["scopes"],
            cancellationToken);

        return ApiResponse.Created(new JsonObject
        {
            ["key"] = created.Key.ToJson(),
            ["secret"] = created.Secret,
        });
    }

    private async Task<ApiResponse> McpAsync(HttpRequest request, CancellationToken cancellationToken)
    {
        var scope = await _tenant.ResolveAsync(request, cancellationToken);
        var body = await ReadJsonAsync(request, cancellationToken);
        if (body is null)
        {
            return ApiResponse.Error(400, "Request body must be valid JSON.");
        }

        var reply = await ReplyAsync(scope, body, cancellationToken);
        return reply is null ? ApiResponse.NoContent() : ApiResponse.Ok(reply);
    }

    private async Task<JsonObject?> ReplyAsync(
        TenantScope scope,
        JsonNode? body,
        CancellationToken cancellationToken)
    {
        var request = body as JsonObject;
        var method = Text(request?["method"]);
        if (request is null
            || Text(request["jsonrpc"]) != "2.0"
            || method is null)
        {
            return Error(RpcId(request), -32600, "Invalid Request");
        }

        if (method.StartsWith("notifications/", StringComparison.Ordinal)) return null;

        var id = RpcId(request);
        var parameters = request["params"] as JsonObject;

        switch (method)
        {
            case "initialize":
            {
                var protocolVersion = parameters?["protocolVersion"];
                return Rpc(id, new JsonObject
                {
                    ["protocolVersion"] = protocolVersion is null
                        ? JsonValue.Create("2025-06-18")
                        : protocolVersion.DeepClone(),
                    ["capabilities"] = new JsonObject
                    {
                        ["tools"] = new JsonObject { ["listChanged"] = false },
                    },
                    ["serverInfo"] = _catalog.ServerInfo(),
                    ["instructions"] = _catalog.Instructions,
                });
            }
            case "ping":
                return Rpc(id, new JsonObject());
            case "tools/list":
                return Rpc(id, new JsonObject { ["tools"] = _catalog.Tools() });
            case "resources/list":
                return Rpc(id, new JsonObject { ["resources"] = new JsonArray() });
            case "prompts/list":
                return Rpc(id, new JsonObject { ["prompts"] = new JsonArray() });
            case "tools/call":
            {
                var name = Text(parameters?["name"]) ?? "";
                if (!_catalog.HasTool(name))
                {
                    return Error(id, -32602, $"Unknown tool: {name}.");
                }

                try
                {
                    var result = await _agent.CallAsync(
                        scope.OrganizationId,
                        name,
                        ToolArguments.FromNode(parameters?["arguments"]),
                        cancellationToken);

                    return Rpc(id, new JsonObject
                    {
                        ["content"] = new JsonArray(new JsonObject
                        {
                            ["type"] = "text",
                            ["text"] = result.ToJsonString(PrettyJson),
                        }),
                        ["structuredContent"] = result,
                        ["isError"] = false,
                    });
                }
                catch (AgentException exception)
                {
                    return ToolFailure(id, exception.Code, exception.Message, exception.Details);
                }
                catch (Exception exception)
                {
                    return ToolFailure(id, "unexpected_error", exception.Message, details: null);
                }
            }
            default:
                return Error(id, -32601, $"Method not found: {method}.");
        }
    }

    private static JsonObject ToolFailure(JsonNode? id, string code, string message, object? details)
    {
        var failure = new JsonObject
        {
            ["code"] = code,
            ["message"] = message,
        };

        if (details is JsonNode node)
        {
            failure["details"] = node.DeepClone();
        }
        else if (details is not null)
        {
            failure["details"] = JsonSerializer.SerializeToNode(details);
        }

        return Rpc(id, new JsonObject
        {
            ["content"] = new JsonArray(new JsonObject
            {
                ["type"] = "text",
                ["text"] = $"{message}\n\n{failure.ToJsonString(PrettyJson)}",
            }),
            ["structuredContent"] = new JsonObject { ["error"] = failure },
            ["isError"] = true,
        });
    }

    private static JsonObject Rpc(JsonNode? id, JsonNode result) => new()
    {
        ["jsonrpc"] = "2.0",
        ["id"] = id,
        ["result"] = result,
    };

    private static JsonObject Error(JsonNode? id, int code, string message) => new()
    {
        ["jsonrpc"] = "2.0",
        ["id"] = id,
        ["error"] = new JsonObject
        {
            ["code"] = code,
            ["message"] = message,
        },
    };

    private static JsonNode? RpcId(JsonObject? request) => request?["id"]?.DeepClone();

    /// <summary>Returns the parsed body; empty bodies read as <c>{}</c>, malformed JSON as null.</summary>
    private static async Task<JsonNode?> ReadJsonAsync(HttpRequest request, CancellationToken cancellationToken)
    {
        using var reader = new StreamReader(request.Body, Encoding.UTF8, leaveOpen: true);
        var text = await reader.ReadToEndAsync(cancellationToken);
        if (text.Length == 0) return new JsonObject();

        try
        {
            return JsonNode.Parse(text);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string? Text(JsonNode? node) =>
        node is JsonValue value && value.TryGetValue<string>(out var text) ? text : null;

    private static bool IsAgentPath(string path) =>
        path == "/mcp"
        || path == "/api/agent"
        || path.StartsWith("/api/agent/", StringComparison.Ordinal)
        || path == "/api/access"
        || path.StartsWith("/api/access/", StringComparison.Ordinal);

    private static bool IsGet(string method) => HttpMethods.IsGet(method) || HttpMethods.IsHead(method);

    [GeneratedRegex(@"^/api/access/keys/(?<id>[A-Za-z0-9-]+)$", RegexOptions.CultureInvariant)]
    private static partial Regex KeyRoute();

    [GeneratedRegex(@"^/api/agent/boards/(?<id>[A-Za-z0-9-]+)$", RegexOptions.CultureInvariant)]
    private static partial Regex BoardRoute();

    [GeneratedRegex(@"^/api/agent/assessments/(?<id>[A-Za-z0-9-]+)$", RegexOptions.CultureInvariant)]
    private static partial Regex AssessmentRoute();
}
