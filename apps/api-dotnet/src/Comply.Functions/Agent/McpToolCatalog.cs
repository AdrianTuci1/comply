using System.Text.Json.Nodes;

namespace Comply.Functions.Agent;

/// <summary>
/// The MCP tool metadata served by <c>tools/list</c> and <c>initialize</c>. The JSON is the
/// canonical <c>contracts/mcp/tools.json</c>, embedded as a resource so the .NET host cannot
/// drift into a hand-maintained second list.
/// </summary>
public sealed class McpToolCatalog
{
    private const string ResourceName = "Comply.Functions.Agent.tools.json";

    private readonly JsonObject _root;
    private readonly HashSet<string> _toolNames;

    private McpToolCatalog(JsonObject root)
    {
        _root = root;
        var server = root["server"] as JsonObject
            ?? throw new InvalidOperationException("The MCP contract is missing the server block.");
        Name = server["name"]?.GetValue<string>() ?? "comply";
        Version = server["version"]?.GetValue<string>() ?? "1.0.0";
        Instructions = server["instructions"]?.GetValue<string>() ?? "";
        var toolNames = (root["tools"] as JsonArray ?? [])
            .Select(tool => tool?["name"]?.GetValue<string>() ?? "")
            .ToHashSet(StringComparer.Ordinal);
        _toolNames = toolNames;
        ToolNames = toolNames;
    }

    public static McpToolCatalog Default { get; } = Load();

    public string Name { get; }

    public string Version { get; }

    public string Instructions { get; }

    public IReadOnlySet<string> ToolNames { get; }

    public bool HasTool(string name) => _toolNames.Contains(name);

    /// <summary>A detached copy: a JSON node can only have one parent.</summary>
    public JsonArray Tools() => (JsonArray)_root["tools"]!.DeepClone();

    public JsonObject ServerInfo() => new()
    {
        ["name"] = Name,
        ["version"] = Version,
        ["instructions"] = Instructions,
    };

    private static McpToolCatalog Load()
    {
        using var stream = typeof(McpToolCatalog).Assembly.GetManifestResourceStream(ResourceName)
            ?? throw new InvalidOperationException(
                $"The embedded MCP contract {ResourceName} is missing from the assembly.");
        var root = JsonNode.Parse(stream) as JsonObject
            ?? throw new InvalidOperationException("The MCP contract must be a JSON object.");
        return new McpToolCatalog(root);
    }
}
