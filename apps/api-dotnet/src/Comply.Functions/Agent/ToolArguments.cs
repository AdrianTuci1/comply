using System.Text.Json;
using System.Text.Json.Nodes;

namespace Comply.Functions.Agent;

/// <summary>
/// Read-only view over MCP <c>params.arguments</c>. Values are read the way the Node agent reads
/// them: missing, null and non-scalar values behave like <c>undefined</c> and callers apply their
/// own defaults.
/// </summary>
public sealed class ToolArguments
{
    public static ToolArguments Empty { get; } = new(null);

    private readonly JsonObject? _values;

    public ToolArguments(JsonObject? values)
    {
        _values = values;
    }

    public static ToolArguments FromNode(JsonNode? node) => node is JsonObject value ? new ToolArguments(value) : Empty;

    public bool Contains(string name) => _values?.ContainsKey(name) == true;

    public JsonNode? Node(string name) => _values?[name];

    /// <summary>JavaScript <c>String(value)</c> for scalars; null for missing or JSON null.</summary>
    public string? Text(string name)
    {
        var node = _values?[name];
        if (node is null) return null;

        return node.GetValueKind() switch
        {
            JsonValueKind.String => node.GetValue<string>(),
            JsonValueKind.Number => node.ToJsonString(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            JsonValueKind.Null or JsonValueKind.Undefined => null,
            _ => node.ToJsonString(),
        };
    }

    /// <summary>JavaScript <c>Number(value)</c>; null stands for <c>NaN</c>.</summary>
    public double? Number(string name)
    {
        var node = _values?[name];
        if (node is null) return null;

        return node.GetValueKind() switch
        {
            JsonValueKind.Number => AsNumber(node),
            JsonValueKind.String => AgentText.ParseNumber(null, node.GetValue<string>()),
            _ => null,
        };
    }

    /// <summary>JavaScript <c>Number.parseInt(value, 10)</c>; null stands for <c>NaN</c>.</summary>
    public double? ParseInt(string name)
    {
        var node = _values?[name];
        if (node is null) return null;

        return node.GetValueKind() switch
        {
            JsonValueKind.Number => AgentText.ParseInt(AsNumber(node), null),
            JsonValueKind.String => AgentText.ParseInt(null, node.GetValue<string>()),
            _ => null,
        };
    }

    // JsonValue<int>.GetValue<double>() throws, so widen through whichever CLR type the parser used.
    private static double? AsNumber(JsonNode node)
    {
        if (node is JsonValue value)
        {
            if (value.TryGetValue<double>(out var real)) return real;
            if (value.TryGetValue<long>(out var integer)) return integer;
            if (value.TryGetValue<decimal>(out var exact)) return (double)exact;
        }

        return AgentText.ParseNumber(null, node.ToJsonString());
    }
}
