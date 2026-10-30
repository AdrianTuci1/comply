using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Comply.Functions.Json;
using Comply.Functions.Models;

namespace Comply.Functions.Services;

/// <summary>
/// Content library store. Loads <c>library.json</c> from the data directory, falls back to the
/// repository seed, and caches the normalized result for the process lifetime (the Node server
/// behaves the same way). Ingest writes go through <see cref="WriteLibraryAsync"/> and
/// <see cref="WriteDocumentAsync"/>, followed by <see cref="Refresh"/> so later reads see them.
/// </summary>
public sealed partial class LibraryStore
{
    private const string LibraryFileName = "library.json";
    private const string DocumentsDirectoryName = "documents";

    /// <summary>Indented output with a trailing newline, like <c>JSON.stringify(value, null, 2)</c>.</summary>
    private static readonly JsonSerializerOptions WriteOptions = new(JsonDefaults.Serializer)
    {
        WriteIndented = true,
    };

    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly SemaphoreSlim _writeGate = new(1, 1);
    private ContentLibrary? _library;

    public LibraryStore(string dataDirectory, string seedDirectory)
    {
        DataDirectory = Path.GetFullPath(dataDirectory);
        SeedDirectory = Path.GetFullPath(seedDirectory);
    }

    public string DataDirectory { get; }

    public string SeedDirectory { get; }

    /// <summary>
    /// Resolves directories from the environment the same way the Node backend does:
    /// <c>COMPLY_DATA_DIR</c> wins, Azure uses <c>/home/data</c>, everything else uses the
    /// repository <c>data/</c> directory.
    /// </summary>
    public static LibraryStore CreateDefault()
    {
        var repositoryRoot = RepositoryPaths.FindRoot();

        var dataDirectory = Environment.GetEnvironmentVariable("COMPLY_DATA_DIR");
        if (string.IsNullOrWhiteSpace(dataDirectory))
        {
            dataDirectory = !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("WEBSITE_SITE_NAME"))
                ? "/home/data"
                : Path.Combine(repositoryRoot ?? Directory.GetCurrentDirectory(), "data");
        }

        var seedDirectory = Environment.GetEnvironmentVariable("COMPLY_SEED_DIR");
        if (string.IsNullOrWhiteSpace(seedDirectory))
        {
            seedDirectory = repositoryRoot is null
                ? Path.Combine(AppContext.BaseDirectory, "seed")
                : Path.Combine(repositoryRoot, "apps", "api-node", "seed");
        }

        return new LibraryStore(dataDirectory, seedDirectory);
    }

    public async Task<ContentLibrary> GetAsync(CancellationToken cancellationToken = default)
    {
        var cached = Volatile.Read(ref _library);
        if (cached is not null) return cached;

        await _gate.WaitAsync(cancellationToken);
        try
        {
            cached = _library;
            if (cached is null)
            {
                cached = await LoadAsync(cancellationToken);
                Volatile.Write(ref _library, cached);
            }

            return cached;
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>
    /// Returns the captured document JSON, preferring the data directory over the seed.
    /// Documents are read per request so a refreshed capture is visible without a restart.
    /// </summary>
    public async Task<JsonNode?> GetDocumentAsync(string id, CancellationToken cancellationToken = default)
    {
        if (!IsSafeId(id)) return null;

        var fromData = await ReadJsonAsync(
            Path.Combine(DataDirectory, DocumentsDirectoryName, $"{id}.json"),
            cancellationToken);
        if (fromData is not null) return fromData;

        return await ReadJsonAsync(
            Path.Combine(SeedDirectory, DocumentsDirectoryName, $"{id}.json"),
            cancellationToken);
    }

    /// <summary>
    /// Replaces the cached snapshot. Call after a successful write so request handlers see the
    /// new content without restarting the process; the value is normalized first.
    /// </summary>
    public void Refresh(ContentLibrary library)
    {
        // Taking the load gate keeps a concurrent cold-cache load from overwriting this snapshot.
        _gate.Wait();
        try
        {
            Volatile.Write(ref _library, Normalize(library));
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>Re-reads the library from disk and replaces the cached snapshot.</summary>
    public async Task<ContentLibrary> ReloadAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var library = await LoadAsync(cancellationToken);
            Volatile.Write(ref _library, library);
            return library;
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>Writes <c>library.json</c> atomically (temporary file, then rename).</summary>
    public async Task WriteLibraryAsync(ContentLibrary library, CancellationToken cancellationToken = default)
    {
        var json = JsonSerializer.Serialize(library, WriteOptions);

        await _writeGate.WaitAsync(cancellationToken);
        try
        {
            await WriteTextAsync(Path.Combine(DataDirectory, LibraryFileName), json, cancellationToken);
        }
        finally
        {
            _writeGate.Release();
        }
    }

    /// <summary>
    /// Writes <c>documents/&lt;id&gt;.json</c> atomically. Ids are validated and the resolved path
    /// must stay inside the data directory; anything else throws before touching the file system.
    /// </summary>
    public async Task WriteDocumentAsync(string id, object document, CancellationToken cancellationToken = default)
    {
        EnsureSafeId(id);

        var documentsDirectory = Path.Combine(DataDirectory, DocumentsDirectoryName);
        var path = Path.GetFullPath(Path.Combine(documentsDirectory, $"{id}.json"));
        if (!IsInside(documentsDirectory, path)) throw new InvalidOperationException("Invalid document id.");

        var json = JsonSerializer.Serialize(document, document.GetType(), WriteOptions);

        await _writeGate.WaitAsync(cancellationToken);
        try
        {
            await WriteTextAsync(path, json, cancellationToken);
        }
        finally
        {
            _writeGate.Release();
        }
    }

    private static async Task WriteTextAsync(string path, string json, CancellationToken cancellationToken)
    {
        var directory = Path.GetDirectoryName(path);
        if (directory is not null) Directory.CreateDirectory(directory);

        var temporary = $"{path}.tmp";
        await File.WriteAllTextAsync(temporary, $"{json}\n", cancellationToken);
        File.Move(temporary, path, overwrite: true);
    }

    private static bool IsInside(string directory, string path)
    {
        var root = Path.GetFullPath(directory);
        var prefix = root.EndsWith(Path.DirectorySeparatorChar) ? root : $"{root}{Path.DirectorySeparatorChar}";
        return path.StartsWith(prefix, StringComparison.Ordinal);
    }

    private async Task<ContentLibrary> LoadAsync(CancellationToken cancellationToken)
    {
        var library =
            await ReadLibraryAsync(Path.Combine(DataDirectory, LibraryFileName), cancellationToken)
            ?? await ReadLibraryAsync(Path.Combine(SeedDirectory, LibraryFileName), cancellationToken)
            ?? new ContentLibrary();

        return Normalize(library);
    }

    private static async Task<ContentLibrary?> ReadLibraryAsync(string path, CancellationToken cancellationToken)
    {
        if (!File.Exists(path)) return null;

        await using var stream = File.OpenRead(path);
        return await JsonSerializer.DeserializeAsync<ContentLibrary>(stream, JsonDefaults.Serializer, cancellationToken);
    }

    private static async Task<JsonNode?> ReadJsonAsync(string path, CancellationToken cancellationToken)
    {
        if (!File.Exists(path)) return null;

        await using var stream = File.OpenRead(path);
        return await JsonNode.ParseAsync(stream, cancellationToken: cancellationToken);
    }

    private static ContentLibrary Normalize(ContentLibrary library)
    {
        if (library.Sources is null) library.Sources = [];
        if (library.Requirements is null) library.Requirements = [];
        if (library.Documents is null) library.Documents = [];

        // The Node store drops requirements whose source is gone; keep that invariant.
        var sourceIds = library.Sources
            .Select(source => source.Id)
            .OfType<string>()
            .ToHashSet(StringComparer.Ordinal);

        library.Requirements = library.Requirements
            .Where(requirement => requirement.SourceId is not null && sourceIds.Contains(requirement.SourceId))
            .ToList();

        return library;
    }

    /// <summary>Same rule as the Node <c>safeId</c> helper: a single path segment, nothing exotic.</summary>
    public static bool IsSafeId(string? id) =>
        id is not null
        && SafeIdPattern().IsMatch(id)
        && id is not "." and not ".."
        && !id.Contains("..", StringComparison.Ordinal);

    /// <summary>Throws the Node error string when an id would escape the documents directory.</summary>
    public static void EnsureSafeId(string? id)
    {
        if (!IsSafeId(id)) throw new InvalidOperationException("Invalid document id.");
    }

    [GeneratedRegex("^[A-Za-z0-9._-]+$")]
    private static partial Regex SafeIdPattern();
}
