using System.Text.Json.Nodes;
using Comply.Functions.Agent;

namespace Comply.Functions.Tests;

public sealed class McpToolContractTests
{
    [Fact]
    public void The_embedded_contract_is_a_byte_copy_of_contracts_mcp_tools_json()
    {
        var contractPath = FindContract();
        Assert.NotNull(contractPath);

        using var embedded = typeof(McpToolCatalog).Assembly
            .GetManifestResourceStream("Comply.Functions.Agent.tools.json");
        Assert.NotNull(embedded);
        using var buffer = new MemoryStream();
        embedded!.CopyTo(buffer);

        Assert.Equal(File.ReadAllBytes(contractPath!), buffer.ToArray());
        Assert.True(JsonNode.DeepEquals(
            JsonNode.Parse(File.ReadAllText(contractPath!)),
            JsonNode.Parse(buffer.ToArray())));
    }

    [Fact]
    public void The_catalog_exposes_the_fifteen_documented_tools()
    {
        var catalog = McpToolCatalog.Default;

        Assert.Equal("comply", catalog.Name);
        Assert.Equal("1.0.0", catalog.Version);
        Assert.Equal(15, catalog.ToolNames.Count);
        Assert.All(catalog.ToolNames, name => Assert.True(catalog.HasTool(name)));

        var tools = catalog.Tools();
        Assert.Equal(15, tools.Count);
        foreach (var tool in tools)
        {
            Assert.False(string.IsNullOrWhiteSpace(tool!["name"]!.GetValue<string>()));
            Assert.False(string.IsNullOrWhiteSpace(tool["title"]!.GetValue<string>()));
            Assert.False(string.IsNullOrWhiteSpace(tool["description"]!.GetValue<string>()));
            Assert.Equal("object", tool["inputSchema"]!["type"]!.GetValue<string>());
        }
    }

    [Fact]
    public void Server_info_matches_the_contract_server_block()
    {
        var path = FindContract();
        Assert.NotNull(path);
        var contract = JsonNode.Parse(File.ReadAllText(path!))!["server"]!;

        Assert.True(JsonNode.DeepEquals(contract, McpToolCatalog.Default.ServerInfo()));
    }

    private static string? FindContract()
    {
        foreach (var start in new[] { AppContext.BaseDirectory, Directory.GetCurrentDirectory() })
        {
            var directory = new DirectoryInfo(start);
            while (directory is not null)
            {
                var candidate = Path.Combine(directory.FullName, "contracts", "mcp", "tools.json");
                if (File.Exists(candidate)) return candidate;
                directory = directory.Parent;
            }
        }

        return null;
    }
}
