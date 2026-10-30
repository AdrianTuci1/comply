using Comply.Functions.Models;

namespace Comply.Functions.Ingest;

/// <summary>Ingest function for one framework.</summary>
public delegate Task<IngestResult> IngestHandler(IngestOptions options, CancellationToken cancellationToken);

/// <summary>Runs a named framework ingest; the seam the coordinator and tests depend on.</summary>
public interface IIngestRunner
{
    /// <summary>Ingestable frameworks in run order (used by <c>framework:"all"</c>).</summary>
    IReadOnlyList<string> Frameworks { get; }

    Task<IngestResult> RunAsync(
        string frameworkId,
        IngestOptions options,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// Port of <c>apps/api-node/lib/ingest/index.mjs</c>: registry of ingestors plus the final
/// dedupe by lowercased reference.
/// </summary>
public sealed class IngestPipeline : IIngestRunner
{
    private static readonly string[] DefaultOrder = ["ai-act", "nis2"];

    public static IReadOnlyDictionary<string, IngestHandler> DefaultHandlers { get; } =
        new Dictionary<string, IngestHandler>(StringComparer.Ordinal)
        {
            ["ai-act"] = (options, cancellationToken) => AiActIngest.IngestAsync(options, cancellationToken),
            ["nis2"] = (options, cancellationToken) => Nis2Ingest.IngestAsync(options, cancellationToken),
        };

    private readonly IReadOnlyDictionary<string, IngestHandler> _handlers;
    private readonly IReadOnlyList<string> _frameworks;

    public IngestPipeline(
        IReadOnlyDictionary<string, IngestHandler>? handlers = null,
        IReadOnlyList<string>? frameworks = null)
    {
        _handlers = handlers ?? DefaultHandlers;
        _frameworks = frameworks ?? (handlers is null ? DefaultOrder : handlers.Keys.ToList());
    }

    public IReadOnlyList<string> Frameworks => _frameworks;

    public async Task<IngestResult> RunAsync(
        string frameworkId,
        IngestOptions options,
        CancellationToken cancellationToken = default)
    {
        if (!_handlers.TryGetValue(frameworkId, out var handler))
        {
            throw new IngestException(
                $"Framework {frameworkId} has no downloadable document. Accepted: {string.Join(", ", _frameworks)}.");
        }

        var result = await handler(options, cancellationToken).ConfigureAwait(false);

        return new IngestResult
        {
            Source = result.Source,
            Document = result.Document,
            Requirements = Dedupe(result.Requirements),
        };
    }

    /// <summary>Keeps the first requirement per lowercased reference.</summary>
    public static IReadOnlyList<Requirement> Dedupe(IReadOnlyList<Requirement> requirements)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var kept = new List<Requirement>(requirements.Count);

        foreach (var requirement in requirements)
        {
            var key = (requirement.Ref ?? string.Empty).ToLowerInvariant();
            if (seen.Add(key)) kept.Add(requirement);
        }

        return kept;
    }
}
