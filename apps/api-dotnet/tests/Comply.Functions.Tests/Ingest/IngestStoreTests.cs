using System.Text.Json.Nodes;
using Comply.Functions.Ingest;
using Comply.Functions.Services;
using Comply.Functions.Tests;

namespace Comply.Functions.Tests.Ingest;

public sealed class IngestStoreTests : IDisposable
{
    private static readonly DateTimeOffset Now = new(2026, 10, 30, 12, 34, 56, TimeSpan.Zero);

    private readonly TempWorkspace _workspace = new();

    public void Dispose() => _workspace.Dispose();

    private static string DocumentPath(TempWorkspace workspace, string id) =>
        Path.Combine(workspace.DataDirectory, "documents", $"{id}.json");

    private (LibraryStore Library, IngestStore Store) Create(
        string? libraryJson = null,
        IIngestBlobSink? blobs = null)
    {
        if (libraryJson is null)
        {
            _workspace.WriteLibrary(_workspace.DataDirectory, Fixtures.Library());
        }
        else
        {
            _workspace.WriteRawLibrary(_workspace.DataDirectory, libraryJson);
        }

        var library = new LibraryStore(_workspace.DataDirectory, _workspace.SeedDirectory);
        return (library, new IngestStore(library, new ManualTimeProvider(Now), blobs));
    }

    [Fact]
    public async Task Replaces_the_source_record()
    {
        var (library, store) = Create();
        await library.GetAsync();

        await store.ApplyAsync(IngestSamples.Result("nis2"));

        var updated = await library.GetAsync();
        Assert.Equal(2, updated.Sources.Count);
        var source = updated.Sources[1];
        Assert.Equal("src-nis2-2022-2555", source.Id);
        Assert.Equal(IngestSamples.FetchedAt, source.ImportedAt);
        Assert.Null(source.LastReviewedAt);
    }

    [Fact]
    public async Task Removes_prior_requirements_of_the_source()
    {
        var (library, store) = Create();
        await library.GetAsync();

        await store.ApplyAsync(IngestSamples.Result("nis2", references: ["Art. 1(9)", "Art. 1(10)"]));

        var updated = await library.GetAsync();
        Assert.DoesNotContain(updated.Requirements, requirement => requirement.Id == "req-nis-1");
        Assert.DoesNotContain(updated.Requirements, requirement => requirement.Id == "req-nis-2");
        Assert.Contains(updated.Requirements, requirement => requirement.Id == "req-ai-1");
    }

    [Fact]
    public async Task Adds_the_new_requirements_and_reports_the_count()
    {
        var (library, store) = Create();
        await library.GetAsync();

        var applied = await store.ApplyAsync(
            IngestSamples.Result("nis2", references: ["Art. 1(9)", "Art. 1(10)"]));

        Assert.Equal(2, applied.Added);
        var updated = await library.GetAsync();
        Assert.Contains(updated.Requirements, requirement => requirement.Ref == "Art. 1(9)");
        Assert.Contains(updated.Requirements, requirement => requirement.Ref == "Art. 1(10)");
        Assert.Equal(4, updated.Requirements.Count);
    }

    [Fact]
    public async Task Dedupes_by_lowercased_reference_inside_the_framework()
    {
        var (library, store) = Create("""
            {
              "version": 1,
              "sources": [
                { "id": "src-nis2-2022-2555", "frameworkId": "nis2", "title": "NIS2" },
                { "id": "src-other", "frameworkId": "nis2", "title": "Other" }
              ],
              "requirements": [
                { "id": "req-other-1", "sourceId": "src-other", "frameworkId": "nis2", "ref": "art. 1(9)" },
                { "id": "req-old-1", "sourceId": "src-nis2-2022-2555", "frameworkId": "nis2", "ref": "Art. 1(1)" }
              ],
              "documents": []
            }
            """);

        var applied = await store.ApplyAsync(
            IngestSamples.Result("nis2", references: ["Art. 1(9)", "Art. 1(10)"]));

        Assert.Equal(1, applied.Added);
        var updated = await library.GetAsync();
        Assert.Equal("req-other-1", updated.Requirements[0].Id);
        Assert.Equal(2, updated.Requirements.Count);
        Assert.Equal("Art. 1(10)", updated.Requirements[1].Ref);
    }

    [Fact]
    public async Task Keeps_the_same_reference_in_another_framework()
    {
        var (library, store) = Create("""
            {
              "version": 1,
              "sources": [
                { "id": "src-nis2-2022-2555", "frameworkId": "nis2", "title": "NIS2" },
                { "id": "src-ai-act-2024-1689", "frameworkId": "ai-act", "title": "AI Act" }
              ],
              "requirements": [
                { "id": "req-ai-1", "sourceId": "src-ai-act-2024-1689", "frameworkId": "ai-act", "ref": "Art. 1(9)" }
              ],
              "documents": []
            }
            """);

        var applied = await store.ApplyAsync(
            IngestSamples.Result("nis2", references: ["Art. 1(9)"]));

        Assert.Equal(1, applied.Added);
        var updated = await library.GetAsync();
        Assert.Equal(
            ["ai-act", "nis2"],
            updated.Requirements.Select(requirement => requirement.FrameworkId));
    }

    [Fact]
    public async Task Writes_the_captured_document_file()
    {
        var (library, store) = Create();
        await library.GetAsync();

        await store.ApplyAsync(IngestSamples.Result("nis2"));

        var path = DocumentPath(_workspace, "doc-nis2-test");
        Assert.True(File.Exists(path));

        var document = JsonNode.Parse(await File.ReadAllTextAsync(path))!;
        Assert.Equal("doc-nis2-test", document["id"]!.GetValue<string>());
        Assert.Equal("src-nis2-2022-2555", document["sourceId"]!.GetValue<string>());
        Assert.Equal("nis2", document["frameworkId"]!.GetValue<string>());
        Assert.Equal("https://example.test/official", document["officialUrl"]!.GetValue<string>());
        var page = Assert.Single(document["pages"]!.AsArray())!;
        Assert.Equal("Art. 1", page["ref"]!.GetValue<string>());
        Assert.Equal("Subject matter", page["title"]!.GetValue<string>());
        Assert.Equal("https://example.test/1", page["url"]!.GetValue<string>());
    }

    [Fact]
    public async Task Serves_the_new_document_through_the_store()
    {
        var (library, store) = Create();
        await library.GetAsync();

        await store.ApplyAsync(IngestSamples.Result("nis2"));

        var document = await library.GetDocumentAsync("doc-nis2-test");

        Assert.NotNull(document);
        Assert.Single(document!["pages"]!.AsArray());
    }

    [Fact]
    public async Task Stores_document_metadata_without_the_pages()
    {
        var (library, store) = Create();
        await library.GetAsync();

        await store.ApplyAsync(IngestSamples.Result("nis2"));

        var updated = await library.GetAsync();
        var metadata = Assert.Single(updated.Documents, document => document.Id == "doc-nis2-test");
        Assert.Equal("src-nis2-2022-2555", metadata.SourceId);
        Assert.Equal("nis2", metadata.FrameworkId);
        Assert.Equal(IngestSamples.FetchedAt, metadata.FetchedAt);
        Assert.Equal(64, metadata.Sha256!.Length);

        var libraryJson = JsonNode.Parse(await File.ReadAllTextAsync(
            Path.Combine(_workspace.DataDirectory, "library.json")))!;
        var stored = libraryJson["documents"]!.AsArray()
            .Single(node => node!["id"]!.GetValue<string>() == "doc-nis2-test")!;
        Assert.Null(stored["pages"]);
        Assert.Equal("public", stored["license"]!.GetValue<string>());
    }

    [Fact]
    public async Task Writes_indented_library_json_and_updates_the_timestamp()
    {
        var (library, store) = Create();
        await library.GetAsync();

        await store.ApplyAsync(IngestSamples.Result("nis2"));

        var path = Path.Combine(_workspace.DataDirectory, "library.json");
        var text = await File.ReadAllTextAsync(path);

        Assert.Contains("\n  \"sources\"", text);
        Assert.EndsWith("\n", text);
        Assert.False(File.Exists($"{path}.tmp"));

        var json = JsonNode.Parse(text)!;
        Assert.Equal("2026-10-30T12:34:56.000Z", json["updatedAt"]!.GetValue<string>());
    }

    [Fact]
    public async Task Refreshes_the_in_memory_snapshot()
    {
        var (library, store) = Create();
        var before = await library.GetAsync();

        await store.ApplyAsync(IngestSamples.Result("nis2", references: ["Art. 9(1)"]));

        var sameInstance = await library.GetAsync();
        Assert.NotSame(before, sameInstance);
        Assert.Contains(sameInstance.Requirements, requirement => requirement.Ref == "Art. 9(1)");
    }

    [Fact]
    public async Task Persists_for_a_new_store_instance()
    {
        var (library, store) = Create();
        await library.GetAsync();

        await store.ApplyAsync(IngestSamples.Result("nis2", references: ["Art. 9(1)"]));

        var reloaded = new LibraryStore(_workspace.DataDirectory, _workspace.SeedDirectory);
        var fromDisk = await reloaded.GetAsync();

        Assert.Contains(fromDisk.Requirements, requirement => requirement.Ref == "Art. 9(1)");
        Assert.Single(fromDisk.Documents, document => document.Id == "doc-nis2-test");
    }

    [Theory]
    [InlineData("../escape")]
    [InlineData("nested/doc")]
    [InlineData("..")]
    [InlineData("")]
    public async Task Rejects_unsafe_document_ids(string id)
    {
        var (library, store) = Create();
        await library.GetAsync();
        var before = await File.ReadAllTextAsync(Path.Combine(_workspace.DataDirectory, "library.json"));

        var result = IngestSamples.Result("nis2");
        result = new IngestResult
        {
            Source = result.Source,
            Document = new IngestDocument
            {
                Id = id,
                SourceId = result.Document.SourceId,
                FrameworkId = result.Document.FrameworkId,
                Title = result.Document.Title,
                Url = result.Document.Url,
                OfficialUrl = result.Document.OfficialUrl,
                Publisher = result.Document.Publisher,
                License = result.Document.License,
                FetchedAt = result.Document.FetchedAt,
                Sha256 = result.Document.Sha256,
                Bytes = result.Document.Bytes,
                Pages = result.Document.Pages,
            },
            Requirements = result.Requirements,
        };

        await Assert.ThrowsAsync<InvalidOperationException>(() => store.ApplyAsync(result));

        Assert.Equal(
            before,
            await File.ReadAllTextAsync(Path.Combine(_workspace.DataDirectory, "library.json")));
        Assert.False(File.Exists(Path.Combine(_workspace.Root, "escape.json")));
        Assert.False(File.Exists(Path.Combine(_workspace.DataDirectory, "escape.json")));
    }

    [Fact]
    public async Task Returns_the_applied_metadata()
    {
        var (library, store) = Create();
        await library.GetAsync();

        var applied = await store.ApplyAsync(IngestSamples.Result("nis2"));

        Assert.Equal("doc-nis2-test", applied.Document.Id);
        Assert.Equal("src-nis2-2022-2555", applied.Source.Id);
        Assert.Equal(2, applied.Added);
    }

    [Fact]
    public async Task Mirrors_writes_to_the_optional_blob_sink()
    {
        var sink = new RecordingBlobSink();
        var (library, store) = Create(blobs: sink);
        await library.GetAsync();

        await store.ApplyAsync(IngestSamples.Result("nis2"));

        Assert.Equal(
            ["documents/doc-nis2-test.json", "library.json"],
            sink.Paths);
    }

    [Fact]
    public async Task Reload_forces_a_disk_read()
    {
        var (library, _) = Create();
        await library.GetAsync();

        _workspace.WriteRawLibrary(
            _workspace.DataDirectory,
            """{"version":1,"sources":[],"requirements":[],"documents":[]}""");

        var reloaded = await library.ReloadAsync();

        Assert.Empty(reloaded.Requirements);
        Assert.Empty(reloaded.Sources);
    }

    private sealed class RecordingBlobSink : IIngestBlobSink
    {
        public List<string> Paths { get; } = [];

        public Task PutAsync(string path, string content, string contentType, CancellationToken cancellationToken)
        {
            lock (Paths) Paths.Add(path);
            return Task.CompletedTask;
        }
    }
}
