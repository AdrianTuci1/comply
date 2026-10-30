using Comply.Functions.Models;
using Comply.Functions.Services;

namespace Comply.Functions.Tests;

public sealed class LibraryStoreTests
{
    [Fact]
    public async Task Loads_library_from_data_directory()
    {
        using var workspace = new TempWorkspace();
        workspace.WriteLibrary(workspace.DataDirectory, Fixtures.Library());

        var store = new LibraryStore(workspace.DataDirectory, workspace.SeedDirectory);

        var library = await store.GetAsync();

        Assert.Equal(Fixtures.Library().Requirements.Count, library.Requirements.Count);
        Assert.Equal(Fixtures.Library().Sources.Count, library.Sources.Count);
    }

    [Fact]
    public async Task Falls_back_to_seed_when_data_directory_is_empty()
    {
        using var workspace = new TempWorkspace();
        workspace.WriteLibrary(workspace.SeedDirectory, Fixtures.Library());

        var store = new LibraryStore(workspace.DataDirectory, workspace.SeedDirectory);

        var library = await store.GetAsync();

        Assert.Equal(4, library.Requirements.Count);
    }

    [Fact]
    public async Task Prefers_data_directory_over_seed()
    {
        using var workspace = new TempWorkspace();
        workspace.WriteLibrary(workspace.SeedDirectory, Fixtures.Library());

        var seeded = Fixtures.Library();
        seeded.Requirements = [];
        workspace.WriteLibrary(workspace.DataDirectory, seeded);

        var store = new LibraryStore(workspace.DataDirectory, workspace.SeedDirectory);

        var library = await store.GetAsync();

        Assert.Empty(library.Requirements);
        Assert.Equal(2, library.Sources.Count);
    }

    [Fact]
    public async Task Normalizes_missing_collections()
    {
        using var workspace = new TempWorkspace();
        workspace.WriteRawLibrary(workspace.DataDirectory, """{"version":1}""");

        var store = new LibraryStore(workspace.DataDirectory, workspace.SeedDirectory);

        var library = await store.GetAsync();

        Assert.Equal(1, library.Version);
        Assert.Empty(library.Sources);
        Assert.Empty(library.Requirements);
        Assert.Empty(library.Documents);
    }

    [Fact]
    public async Task Drops_requirements_without_a_known_source()
    {
        using var workspace = new TempWorkspace();
        workspace.WriteRawLibrary(workspace.DataDirectory, """
        {
          "version": 1,
          "sources": [{ "id": "src-known", "frameworkId": "nis2", "title": "Known" }],
          "requirements": [
            { "id": "kept", "sourceId": "src-known", "frameworkId": "nis2", "ref": "Art. 1" },
            { "id": "orphan", "sourceId": "src-gone", "frameworkId": "nis2", "ref": "Art. 2" }
          ],
          "documents": []
        }
        """);

        var store = new LibraryStore(workspace.DataDirectory, workspace.SeedDirectory);

        var library = await store.GetAsync();

        Assert.Equal("kept", Assert.Single(library.Requirements).Id);
    }

    [Fact]
    public async Task Caches_the_library_after_the_first_read()
    {
        using var workspace = new TempWorkspace();
        workspace.WriteLibrary(workspace.DataDirectory, Fixtures.Library());

        var store = new LibraryStore(workspace.DataDirectory, workspace.SeedDirectory);
        await store.GetAsync();

        var updated = Fixtures.Library();
        updated.Requirements = [];
        workspace.WriteLibrary(workspace.DataDirectory, updated);

        var cached = await store.GetAsync();

        Assert.Equal(4, cached.Requirements.Count);
    }

    [Fact]
    public async Task Serves_documents_from_data_then_seed()
    {
        using var workspace = new TempWorkspace();
        workspace.WriteDocument(workspace.DataDirectory, "doc-data", """{"id":"doc-data","origin":"data"}""");
        workspace.WriteDocument(workspace.SeedDirectory, "doc-seed", """{"id":"doc-seed","origin":"seed"}""");
        workspace.WriteDocument(workspace.SeedDirectory, "shared", """{"id":"shared","origin":"seed"}""");
        workspace.WriteDocument(workspace.DataDirectory, "shared", """{"id":"shared","origin":"data"}""");

        var store = new LibraryStore(workspace.DataDirectory, workspace.SeedDirectory);

        Assert.Equal("data", (await store.GetDocumentAsync("doc-data"))!["origin"]!.GetValue<string>());
        Assert.Equal("seed", (await store.GetDocumentAsync("doc-seed"))!["origin"]!.GetValue<string>());
        Assert.Equal("data", (await store.GetDocumentAsync("shared"))!["origin"]!.GetValue<string>());
        Assert.Null(await store.GetDocumentAsync("missing"));
    }

    [Theory]
    [InlineData("../library")]
    [InlineData("..")]
    [InlineData(".")]
    [InlineData("nested/doc")]
    [InlineData("")]
    public async Task Rejects_unsafe_document_ids(string id)
    {
        using var workspace = new TempWorkspace();
        workspace.WriteLibrary(workspace.DataDirectory, Fixtures.Library());

        var store = new LibraryStore(workspace.DataDirectory, workspace.SeedDirectory);

        Assert.Null(await store.GetDocumentAsync(id));
    }

    [Fact]
    public void Default_store_points_at_the_repository_seed()
    {
        var store = LibraryStore.CreateDefault();

        Assert.EndsWith(Path.Combine("apps", "api-node", "seed"), store.SeedDirectory);
    }
}
