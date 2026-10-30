using System.Net;
using Comply.Functions.Ingest;

namespace Comply.Functions.Tests.Ingest;

public sealed class IngestPipelineTests
{
    [Fact]
    public void Default_handlers_run_ai_act_then_nis2()
    {
        var pipeline = new IngestPipeline();

        Assert.Equal(["ai-act", "nis2"], pipeline.Frameworks);
        Assert.Equal(["ai-act", "nis2"], IngestPipeline.DefaultHandlers.Keys);
    }

    [Fact]
    public async Task Rejects_frameworks_without_a_downloadable_document()
    {
        var pipeline = new IngestPipeline();

        var error = await Assert.ThrowsAsync<IngestException>(
            () => pipeline.RunAsync("iso27001", new IngestOptions()));

        Assert.Equal(
            "Framework iso27001 has no downloadable document. Accepted: ai-act, nis2.",
            error.Message);
    }

    [Fact]
    public void Dedupe_keeps_the_first_requirement_per_lowercased_reference()
    {
        var result = IngestSamples.Result("nis2", references: ["Art. 1", "art. 1", "Art. 2", "ART. 2"]);

        var deduped = IngestPipeline.Dedupe(result.Requirements);

        Assert.Equal(["Art. 1", "Art. 2"], deduped.Select(requirement => requirement.Ref));
    }

    [Fact]
    public async Task Run_dedupes_what_the_handler_returns()
    {
        var pipeline = new IngestPipeline(
            new Dictionary<string, IngestHandler>(StringComparer.Ordinal)
            {
                ["custom"] = (_, _) => Task.FromResult(
                    IngestSamples.Result("custom", references: ["Art. 1(1)", "art. 1(1)", "Art. 1(2)"])),
            },
            ["custom"]);

        var result = await pipeline.RunAsync("custom", new IngestOptions());

        Assert.Equal(["Art. 1(1)", "Art. 1(2)"], result.Requirements.Select(requirement => requirement.Ref));
    }

    [Fact]
    public async Task Passes_the_options_to_the_handler()
    {
        IngestOptions? received = null;

        var pipeline = new IngestPipeline(
            new Dictionary<string, IngestHandler>(StringComparer.Ordinal)
            {
                ["custom"] = (options, _) =>
                {
                    received = options;
                    return Task.FromResult(IngestSamples.Result("custom"));
                },
            },
            ["custom"]);

        var options = new IngestOptions { FetchedAt = IngestSamples.FetchedAt, Concurrency = 2 };
        await pipeline.RunAsync("custom", options);

        Assert.Same(options, received);
    }
}

public sealed class IngestFetchTests
{
    private sealed class StubHandler : HttpMessageHandler
    {
        private readonly Queue<Func<HttpResponseMessage>> _responses;

        public StubHandler(params Func<HttpResponseMessage>[] responses) =>
            _responses = new Queue<Func<HttpResponseMessage>>(responses);

        public List<string?> UserAgents { get; } = [];

        public int Calls => UserAgents.Count;

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            // NonValidated keeps the raw header; the typed collection re-tokenises the value.
            UserAgents.Add(request.Headers.NonValidated.TryGetValues("user-agent", out var values)
                ? string.Join(",", values)
                : null);

            var response = _responses.Dequeue()();
            response.RequestMessage = request;
            return Task.FromResult(response);
        }
    }

    private static HttpResponseMessage Ok(string body) =>
        new(HttpStatusCode.OK) { Content = new StringContent(body) };

    private static HttpResponseMessage Status(HttpStatusCode status) => new(status);

    [Fact]
    public async Task Retries_retryable_statuses_with_linear_backoff()
    {
        var handler = new StubHandler(
            () => Status(HttpStatusCode.TooManyRequests),
            () => Status(HttpStatusCode.BadGateway),
            () => Ok("payload"));
        var delays = new List<TimeSpan>();

        using var client = new HttpClient(handler);
        var fetcher = new HttpTextFetcher(
            client,
            retries: 2,
            delay: (wait, _) =>
            {
                delays.Add(wait);
                return Task.CompletedTask;
            });

        var text = await fetcher.FetchAsync("https://example.test/page");

        Assert.Equal("payload", text);
        Assert.Equal(3, handler.Calls);
        Assert.Equal([TimeSpan.FromMilliseconds(250), TimeSpan.FromMilliseconds(500)], delays);
    }

    [Fact]
    public async Task Does_not_retry_client_errors()
    {
        var handler = new StubHandler(() => Status(HttpStatusCode.NotFound));
        var delays = new List<TimeSpan>();

        using var client = new HttpClient(handler);
        var fetcher = new HttpTextFetcher(
            client,
            retries: 2,
            delay: (wait, _) =>
            {
                delays.Add(wait);
                return Task.CompletedTask;
            });

        var error = await Assert.ThrowsAsync<HttpRequestException>(
            () => fetcher.FetchAsync("https://example.test/missing"));

        Assert.Equal("HTTP 404 for https://example.test/missing", error.Message);
        Assert.Equal(1, handler.Calls);
        Assert.Empty(delays);
    }

    [Fact]
    public async Task Sends_the_ingest_user_agent()
    {
        var handler = new StubHandler(() => Ok("payload"));

        using var client = new HttpClient(handler);
        var fetcher = new HttpTextFetcher(client);

        await fetcher.FetchAsync("https://example.test/page");

        Assert.Equal(HttpTextFetcher.UserAgent, Assert.Single(handler.UserAgents));
    }

    [Fact]
    public async Task Times_out_each_attempt()
    {
        var handler = new SlowHandler();

        using var client = new HttpClient(handler);
        var fetcher = new HttpTextFetcher(
            client,
            retries: 0,
            timeout: TimeSpan.FromMilliseconds(30),
            delay: (_, _) => Task.CompletedTask);

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => fetcher.FetchAsync("https://example.test/slow"));
        Assert.Equal(1, handler.Calls);
    }

    [Fact]
    public async Task Map_limit_preserves_order_and_caps_concurrency()
    {
        var active = 0;
        var peak = 0;
        var gate = new object();

        var results = await IngestFetch.MapLimitAsync(
            Enumerable.Range(0, 8).ToList(),
            2,
            async (item, _, _) =>
            {
                var running = Interlocked.Increment(ref active);
                lock (gate)
                {
                    if (running > peak) peak = running;
                }

                await Task.Delay(5);
                Interlocked.Decrement(ref active);
                return item * 2;
            });

        Assert.Equal([0, 2, 4, 6, 8, 10, 12, 14], results);
        Assert.InRange(peak, 1, 2);
    }

    [Fact]
    public async Task Map_limit_accepts_an_empty_list()
    {
        var results = await IngestFetch.MapLimitAsync(
            Array.Empty<int>(),
            4,
            (item, _, _) => Task.FromResult(item));

        Assert.Empty(results);
    }

    private sealed class SlowHandler : HttpMessageHandler
    {
        private int _calls;

        public int Calls => Volatile.Read(ref _calls);

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            Interlocked.Increment(ref _calls);
            await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
            throw new InvalidOperationException("unreachable");
        }
    }
}
