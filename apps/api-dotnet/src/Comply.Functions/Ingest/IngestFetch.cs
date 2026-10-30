using System.Net;
using System.Text.RegularExpressions;

namespace Comply.Functions.Ingest;

/// <summary>
/// Fetch abstraction over <c>apps/api-node/lib/ingest/fetch.mjs</c>. Tests inject stored HTML,
/// production uses <see cref="HttpTextFetcher"/>.
/// </summary>
public interface ITextFetcher
{
    Task<string> FetchAsync(string url, CancellationToken cancellationToken = default);
}

/// <summary>
/// HTTP fetcher with the Node retry policy: a bot user agent, 30s per attempt, and retries on
/// 429 plus 5xx with linear backoff. Other statuses fail immediately.
/// </summary>
public sealed class HttpTextFetcher : ITextFetcher, IDisposable
{
    public const string UserAgent =
        "ComplyContentBot/1.0 (+https://comply.app; compliance content ingestion; contact: ops@comply.app)";

    private const string Accept = "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8";
    private static readonly HashSet<int> RetryStatuses = [429, 500, 502, 503, 504];

    /// <summary>Process-wide instance used when callers do not inject a fetcher.</summary>
    internal static HttpTextFetcher Shared { get; } = new();

    private readonly HttpClient _client;
    private readonly bool _ownsClient;
    private readonly int _retries;
    private readonly TimeSpan _timeout;
    private readonly Func<TimeSpan, CancellationToken, Task> _delay;

    public HttpTextFetcher(
        HttpClient? client = null,
        int retries = 2,
        TimeSpan? timeout = null,
        Func<TimeSpan, CancellationToken, Task>? delay = null)
    {
        _client = client ?? new HttpClient(new HttpClientHandler { AutomaticDecompression = DecompressionMethods.All })
        {
            // Per-attempt cancellation mirrors AbortSignal.timeout; the client itself never expires.
            Timeout = Timeout.InfiniteTimeSpan,
        };
        _ownsClient = client is null;
        _retries = Math.Max(0, retries);
        _timeout = timeout ?? TimeSpan.FromSeconds(30);
        _delay = delay ?? ((wait, token) => Task.Delay(wait, token));
    }

    public async Task<string> FetchAsync(string url, CancellationToken cancellationToken = default)
    {
        Exception? lastError = null;

        for (var attempt = 0; attempt <= _retries; attempt++)
        {
            try
            {
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                timeout.CancelAfter(_timeout);

                using var request = new HttpRequestMessage(HttpMethod.Get, url);
                request.Headers.TryAddWithoutValidation("user-agent", UserAgent);
                request.Headers.TryAddWithoutValidation("accept", Accept);
                request.Headers.TryAddWithoutValidation("accept-language", "en");

                using var response = await _client
                    .SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token)
                    .ConfigureAwait(false);

                if (response.IsSuccessStatusCode)
                {
                    return await response.Content.ReadAsStringAsync(timeout.Token).ConfigureAwait(false);
                }

                lastError = new HttpRequestException($"HTTP {(int)response.StatusCode} for {url}");
                if (!RetryStatuses.Contains((int)response.StatusCode)) break;
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception error)
            {
                lastError = error;
            }

            await _delay(TimeSpan.FromMilliseconds(250 * (attempt + 1)), cancellationToken)
                .ConfigureAwait(false);
        }

        throw lastError ?? new HttpRequestException($"Could not fetch {url}");
    }

    public void Dispose()
    {
        if (_ownsClient) _client.Dispose();
    }
}

/// <summary>Concurrency ceiling that keeps result order, like <c>mapLimit</c> in fetch.mjs.</summary>
public static class IngestFetch
{
    public static async Task<IReadOnlyList<TResult>> MapLimitAsync<TItem, TResult>(
        IReadOnlyList<TItem> items,
        int limit,
        Func<TItem, int, CancellationToken, Task<TResult>> task,
        CancellationToken cancellationToken = default)
    {
        if (items.Count == 0) return [];

        var results = new TResult[items.Count];
        var cursor = -1;
        var workers = Math.Max(1, Math.Min(limit, items.Count));
        var running = new List<Task>(workers);

        for (var index = 0; index < workers; index++) running.Add(WorkerAsync());

        await Task.WhenAll(running).ConfigureAwait(false);
        return results;

        async Task WorkerAsync()
        {
            while (true)
            {
                var index = Interlocked.Increment(ref cursor);
                if (index >= items.Count) return;
                results[index] = await task(items[index], index, cancellationToken).ConfigureAwait(false);
            }
        }
    }
}

internal static class LeadingNumber
{
    private static readonly Regex Pattern = new(
        "^\\s*[+-]?\\d+",
        RegexOptions.CultureInvariant);

    /// <summary>Same result as <c>Number.parseInt(value, 10)</c> for the article numbers we parse.</summary>
    public static bool TryParse(string? value, out int number)
    {
        number = 0;
        var match = Pattern.Match(value ?? string.Empty);
        return match.Success && int.TryParse(match.Value, out number);
    }
}
