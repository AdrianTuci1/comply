using Comply.Functions.Ingest;
using Comply.Functions.Models;

namespace Comply.Functions.Tests.Ingest;

/// <summary>Fetcher that serves stored HTML; tests never touch the network.</summary>
internal sealed class FakeTextFetcher : ITextFetcher
{
    private readonly Dictionary<string, string> _pages;
    private int _active;

    public FakeTextFetcher(IReadOnlyDictionary<string, string> pages) =>
        _pages = new Dictionary<string, string>(pages, StringComparer.Ordinal);

    public List<string> Requests { get; } = [];

    public Func<string, Task>? OnFetch { get; set; }

    public int PeakConcurrency { get; private set; }

    public async Task<string> FetchAsync(string url, CancellationToken cancellationToken = default)
    {
        lock (Requests) Requests.Add(url);

        var active = Interlocked.Increment(ref _active);
        lock (Requests)
        {
            if (active > PeakConcurrency) PeakConcurrency = active;
        }

        try
        {
            if (OnFetch is not null) await OnFetch(url).ConfigureAwait(false);

            if (!_pages.TryGetValue(url, out var html))
            {
                throw new IngestException($"Unexpected fetch: {url}");
            }

            return html;
        }
        finally
        {
            Interlocked.Decrement(ref _active);
        }
    }
}

/// <summary>Ingest runner backed by a callback, recording the frameworks it was asked for.</summary>
internal sealed class RecordingIngestRunner : IIngestRunner
{
    private readonly Func<string, IngestOptions, CancellationToken, Task<IngestResult>> _run;

    public RecordingIngestRunner(
        IEnumerable<string> frameworks,
        Func<string, IngestOptions, CancellationToken, Task<IngestResult>>? run = null)
    {
        Frameworks = frameworks.ToList();
        _run = run ?? ((framework, options, _) =>
            Task.FromResult(IngestSamples.Result(framework, options.ResolveFetchedAt())));
    }

    public IReadOnlyList<string> Frameworks { get; }

    public List<string> Calls { get; } = [];

    public List<string> RequestedFetchedAt { get; } = [];

    public async Task<IngestResult> RunAsync(
        string frameworkId,
        IngestOptions options,
        CancellationToken cancellationToken = default)
    {
        lock (Calls)
        {
            Calls.Add(frameworkId);
            RequestedFetchedAt.Add(options.ResolveFetchedAt());
        }

        return await _run(frameworkId, options, cancellationToken).ConfigureAwait(false);
    }
}

internal static class IngestSamples
{
    public const string FetchedAt = "2026-10-30T12:00:00.000Z";

    public static IngestResult Result(
        string framework,
        string fetchedAt = FetchedAt,
        IReadOnlyList<string>? references = null)
    {
        var source = framework switch
        {
            "nis2" => IngestSources.Nis2(fetchedAt),
            "ai-act" => IngestSources.AiAct(fetchedAt),
            _ => new SourceRecord
            {
                Id = $"src-{framework}",
                FrameworkId = framework,
                Title = framework,
                Publisher = "European Union",
                Version = "1.0.0",
                Kind = "html",
                License = "public",
                ImportedAt = fetchedAt,
                LastReviewedAt = null,
            },
        };

        references ??= ["Art. 1(1)", "Art. 1(2)"];
        var text = $"{framework} snapshot text";

        return new IngestResult
        {
            Source = source,
            Document = new IngestDocument
            {
                Id = $"doc-{framework}-test",
                SourceId = source.Id ?? string.Empty,
                FrameworkId = framework,
                Title = source.Title ?? framework,
                Url = "https://example.test/index",
                OfficialUrl = "https://example.test/official",
                Publisher = "European Union",
                License = "public",
                FetchedAt = fetchedAt,
                Sha256 = IngestHash.Sha256Hex(text),
                Bytes = IngestHash.Utf8Bytes(text),
                Pages =
                [
                    new IngestedPage
                    {
                        Ref = "Art. 1",
                        Title = "Subject matter",
                        Url = "https://example.test/1",
                        Text = text,
                    },
                ],
            },
            Requirements = references.Select((reference, index) => new Requirement
            {
                Id = $"req-{framework}-{index}",
                SourceId = source.Id,
                FrameworkId = framework,
                Ref = reference,
                Title = $"Requirement {index + 1}",
                Text = "Text for the requirement.",
                Theme = "organizational",
                Status = "draft",
                Reviewer = null,
                ReviewedAt = null,
                CreatedAt = fetchedAt,
            }).ToList(),
        };
    }
}

/// <summary>Time provider with manual timers, so scheduling tests never wait on wall-clock time.</summary>
internal sealed class ManualTimeProvider : TimeProvider
{
    private readonly object _gate = new();
    private readonly List<ManualTimer> _timers = [];
    private DateTimeOffset _now;

    public ManualTimeProvider(DateTimeOffset now) => _now = now;

    public override DateTimeOffset GetUtcNow()
    {
        lock (_gate) return _now;
    }

    public void Advance(TimeSpan delta)
    {
        lock (_gate) _now = _now.Add(delta);
    }

    public IReadOnlyList<ManualTimer> Timers
    {
        get
        {
            lock (_gate) return _timers.ToList();
        }
    }

    public ManualTimer LastTimer => Timers[^1];

    public int Fire()
    {
        ManualTimer[] timers;
        lock (_gate) timers = _timers.Where(timer => !timer.Disposed).ToArray();

        foreach (var timer in timers) timer.Fire();
        return timers.Length;
    }

    public override ITimer CreateTimer(TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period)
    {
        var timer = new ManualTimer(callback, state, dueTime);
        lock (_gate) _timers.Add(timer);
        return timer;
    }

    internal sealed class ManualTimer(TimerCallback callback, object? state, TimeSpan dueTime) : ITimer
    {
        public TimeSpan DueTime { get; private set; } = dueTime;

        public bool Disposed { get; private set; }

        public bool Fired { get; private set; }

        public bool Change(TimeSpan dueTime, TimeSpan period)
        {
            DueTime = dueTime;
            return true;
        }

        public void Dispose() => Disposed = true;

        public ValueTask DisposeAsync()
        {
            Disposed = true;
            return ValueTask.CompletedTask;
        }

        public void Fire()
        {
            Fired = true;
            callback(state);
        }
    }
}

internal static class AsyncWait
{
    public static async Task UntilAsync(Func<bool> condition, string because, int timeoutMs = 5_000)
    {
        var started = Environment.TickCount64;
        while (!condition())
        {
            if (Environment.TickCount64 - started > timeoutMs)
            {
                throw new TimeoutException($"Timed out waiting for {because}.");
            }

            await Task.Delay(10);
        }
    }
}
