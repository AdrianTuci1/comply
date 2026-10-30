using System.Text.Json;
using Comply.Functions.Json;

namespace Comply.Functions.Tests;

/// <summary>Scratch directory with <c>data/</c> and <c>seed/</c> subdirectories.</summary>
internal sealed class TempWorkspace : IDisposable
{
    public TempWorkspace()
    {
        Root = Path.Combine(Path.GetTempPath(), "comply-functions-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Root);
    }

    public string Root { get; }

    public string DataDirectory => Path.Combine(Root, "data");

    public string SeedDirectory => Path.Combine(Root, "seed");

    public void WriteLibrary(string directory, object library) =>
        WriteJson(Path.Combine(directory, "library.json"), JsonSerializer.Serialize(library, JsonDefaults.Serializer));

    public void WriteRawLibrary(string directory, string json) =>
        WriteJson(Path.Combine(directory, "library.json"), json);

    public void WriteDocument(string directory, string id, string json) =>
        WriteJson(Path.Combine(directory, "documents", $"{id}.json"), json);

    private static void WriteJson(string path, string json)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, json);
    }

    public void Dispose()
    {
        if (Directory.Exists(Root)) Directory.Delete(Root, recursive: true);
    }
}
