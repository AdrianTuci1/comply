using System.Text.Json;
using Comply.Functions.Json;
using Comply.Functions.Models;
using Comply.Functions.Services;

namespace Comply.Functions.Ingest;

/// <summary>
/// Extension point for the Azure Blob mirror. The Node store also writes
/// <c>library.json</c> and <c>documents/&lt;id&gt;.json</c> to Blob Storage when it is configured;
/// the .NET host is local-disk only for now. Implement this and pass it to
/// <see cref="IngestStore"/> to add the second target without touching the pipeline.
/// </summary>
public interface IIngestBlobSink
{
    Task PutAsync(string path, string content, string contentType, CancellationToken cancellationToken);
}

/// <summary>
/// Applies an <see cref="IngestResult"/> to the content library with the same rules as
/// <c>applyIngest</c> in <c>apps/api-node/lib/store.mjs</c>: replace the source, drop the
/// requirements it owned, dedupe by lowercased reference inside the framework, add the new
/// requirements, upsert the document metadata, then write the document and the library.
/// </summary>
public sealed class IngestStore
{
    private readonly LibraryStore _library;
    private readonly TimeProvider _time;
    private readonly IIngestBlobSink? _blobs;
    private readonly SemaphoreSlim _gate = new(1, 1);

    public IngestStore(LibraryStore library, TimeProvider? time = null, IIngestBlobSink? blobs = null)
    {
        _library = library;
        _time = time ?? TimeProvider.System;
        _blobs = blobs;
    }

    public async Task<IngestApplyResult> ApplyAsync(
        IngestResult result,
        CancellationToken cancellationToken = default)
    {
        // Validate before mutating anything: an unsafe id must not leave a half-applied library.
        LibraryStore.EnsureSafeId(result.Document.Id);

        await _gate.WaitAsync(cancellationToken);
        try
        {
            var current = await _library.GetAsync(cancellationToken);
            var source = result.Source;

            var sources = current.Sources
                .Where(item => !string.Equals(item.Id, source.Id, StringComparison.Ordinal))
                .ToList();
            sources.Add(source);

            var kept = current.Requirements
                .Where(item => !string.Equals(item.SourceId, source.Id, StringComparison.Ordinal))
                .ToList();

            // References are unique per framework only: NIS2 and the AI Act both have an
            // "Art. 1(1)", so a global set would silently drop real controls.
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var requirement in kept)
            {
                if (string.Equals(requirement.FrameworkId, source.FrameworkId, StringComparison.Ordinal))
                {
                    seen.Add(ReferenceKey(requirement));
                }
            }

            var added = new List<Requirement>(result.Requirements.Count);
            foreach (var requirement in result.Requirements)
            {
                if (seen.Add(ReferenceKey(requirement))) added.Add(requirement);
            }

            var requirements = new List<Requirement>(kept.Count + added.Count);
            requirements.AddRange(kept);
            requirements.AddRange(added);

            var metadata = result.Document.ToMetadata();
            var documents = current.Documents
                .Where(item => !string.Equals(item.Id, metadata.Id, StringComparison.Ordinal))
                .ToList();
            documents.Add(metadata);

            var next = new ContentLibrary
            {
                Version = current.Version,
                UpdatedAt = IngestTime.Timestamp(_time.GetUtcNow()),
                Sources = sources,
                Requirements = requirements,
                Documents = documents,
                AdditionalProperties = current.AdditionalProperties,
            };

            // The full capture goes to documents/<id>.json first, matching the Node apply order.
            await _library.WriteDocumentAsync(result.Document.Id, result.Document, cancellationToken);
            await _library.WriteLibraryAsync(next, cancellationToken);
            _library.Refresh(next);

            await MirrorAsync($"documents/{result.Document.Id}.json", result.Document, cancellationToken);
            await MirrorAsync("library.json", next, cancellationToken);

            return new IngestApplyResult(source, added.Count, metadata);
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task MirrorAsync(string path, object value, CancellationToken cancellationToken)
    {
        if (_blobs is null) return;

        try
        {
            var json = JsonSerializer.Serialize(value, value.GetType(), JsonDefaults.Serializer);
            await _blobs.PutAsync(path, json, "application/json; charset=utf-8", cancellationToken);
        }
        catch (Exception) when (!cancellationToken.IsCancellationRequested)
        {
            // Node logs and continues when the Blob write fails; local disk stays authoritative.
        }
    }

    private static string ReferenceKey(Requirement requirement) =>
        (requirement.Ref ?? string.Empty).ToLowerInvariant();
}
