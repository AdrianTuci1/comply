using System.Text.Json;
using System.Text.Json.Nodes;
using Comply.Functions.Json;
using Comply.Functions.Services;

namespace Comply.Functions.Tests;

public sealed class SerializationTests
{
    [Fact]
    public async Task Writes_node_compatible_property_names_and_keeps_unknown_fields()
    {
        using var workspace = new TempWorkspace();
        workspace.WriteRawLibrary(workspace.DataDirectory, """
        {
          "version": 1,
          "updatedAt": "2026-10-30T00:00:00.000Z",
          "sources": [{ "id": "src-1", "frameworkId": "nis2", "title": "Directive" }],
          "requirements": [
            {
              "id": "req-1",
              "sourceId": "src-1",
              "frameworkId": "nis2",
              "ref": "Art. 1",
              "title": "Scope",
              "text": "Text",
              "theme": "organizational",
              "status": "draft",
              "reviewer": null,
              "reviewedAt": null,
              "createdAt": "2026-10-30T00:00:00.000Z",
              "customFlag": true
            }
          ],
          "documents": []
        }
        """);

        var store = new LibraryStore(workspace.DataDirectory, workspace.SeedDirectory);
        var library = await store.GetAsync();
        var response = LibraryFilter.Apply(library, new LibraryQuery { HasParameters = false });

        var json = JsonSerializer.Serialize(response, JsonDefaults.Serializer);
        var requirement = JsonNode.Parse(json)!["requirements"]![0]!;

        Assert.Equal("req-1", requirement["id"]!.GetValue<string>());
        Assert.Equal("src-1", requirement["sourceId"]!.GetValue<string>());
        Assert.Equal("nis2", requirement["frameworkId"]!.GetValue<string>());
        Assert.Equal("Art. 1", requirement["ref"]!.GetValue<string>());
        Assert.Null(requirement["reviewer"]);
        Assert.True(requirement["customFlag"]!.GetValue<bool>());
        Assert.Null(requirement["source_id"]);
        Assert.Null(requirement["SourceId"]);
    }
}
