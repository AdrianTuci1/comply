using Microsoft.Extensions.Logging;

namespace Comply.Functions.Ingest;

/// <summary>
/// In-memory ingest job runner and refresh schedule, ported from the job handling in
/// <c>apps/api-node/lib/api.mjs</c>. Jobs run in the background; every completion (manual or
/// scheduled) is recorded on the schedule document.
/// </summary>
public sealed class IngestCoordinator : IDisposable
{
    private const int LogLimit = 200;
    private const double MillisecondsPerHour = 3_600_000;

    private readonly IIngestRunner _runner;
    private readonly IngestStore _store;
    private readonly TimeProvider _time;
    private readonly ILogger<IngestCoordinator>? _logger;
    private readonly long _intervalMs;
    private readonly long _startupDelayMs;
    private readonly bool _runOnStart;
    private readonly CancellationToken _shutdownToken;

    private readonly object _jobsGate = new();
    private readonly List<Job> _jobs = [];
    private readonly object _scheduleGate = new();
    private readonly CancellationTokenSource _shutdown = new();

    private ScheduleState _schedule = new();
    private ITimer? _timer;
    private int _started;
    private bool _disposed;

    public IngestCoordinator(
        IIngestRunner runner,
        IngestStore store,
        TimeProvider? time = null,
        IngestScheduleOptions? options = null,
        ILogger<IngestCoordinator>? logger = null)
    {
        options ??= new IngestScheduleOptions();

        _runner = runner;
        _store = store;
        _time = time ?? TimeProvider.System;
        _logger = logger;
        _intervalMs = NormalizeIntervalMs(options.IntervalHours);
        _startupDelayMs = ToMilliseconds(options.StartupDelaySeconds);
        _runOnStart = options.RunOnStart;
        _shutdownToken = _shutdown.Token;
    }

    public bool Enabled => _intervalMs > 0;

    public IReadOnlyList<string> Frameworks => _runner.Frameworks;

    /// <summary>
    /// Starts the refresh timer once. Safe to call repeatedly; the host wiring may call it
    /// explicitly or rely on the first API request / job start.
    /// </summary>
    public void Start()
    {
        if (Interlocked.Exchange(ref _started, 1) == 1) return;
        if (!Enabled || _disposed) return;

        PlanRun(_runOnStart ? _startupDelayMs : _intervalMs, _runOnStart ? "startup" : "interval");

        _logger?.LogInformation(
            "Content refresh scheduled every {IntervalHours}h; next run {NextRunAt}.",
            IntervalMsToHours(_intervalMs),
            GetSchedule().NextRunAt);
    }

    /// <summary>
    /// Starts an ingest job. An unknown framework returns 400, an active job covering any of the
    /// requested frameworks is reused (Node behaviour), otherwise a new job starts and returns 202.
    /// </summary>
    public IngestStartResult StartJob(string? framework = null, string trigger = "manual")
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        Start();

        var requested = framework ?? "all";
        var requestedFrameworks = requested == "all"
            ? _runner.Frameworks
            : _runner.Frameworks
                .Where(item => string.Equals(item, requested, StringComparison.Ordinal))
                .ToList();

        if (requestedFrameworks.Count == 0)
        {
            return new IngestStartResult(400, null, $"Unknown framework: {requested}.");
        }

        Job job;
        TaskCompletionSource completion;

        lock (_jobsGate)
        {
            var active = _jobs.FirstOrDefault(existing =>
                string.Equals(existing.Status, "running", StringComparison.Ordinal)
                && existing.Frameworks.Any(item => requestedFrameworks.Contains(item, StringComparer.Ordinal)));

            if (active is not null) return new IngestStartResult(202, Snapshot(active), null);

            completion = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            job = new Job
            {
                Id = Guid.NewGuid().ToString(),
                Framework = requested,
                Frameworks = requestedFrameworks.ToList(),
                StartedAt = IngestTime.Timestamp(_time.GetUtcNow()),
                Completion = completion.Task,
            };
            _jobs.Add(job);
        }

        var run = RunJobAsync(job, requestedFrameworks, trigger, completion);
        _ = run.ContinueWith(
            static failed => _ = failed.Exception,
            CancellationToken.None,
            TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously,
            TaskScheduler.Default);

        return new IngestStartResult(202, Snapshot(job), null);
    }

    /// <summary>All jobs, newest first by start time (the Node list order).</summary>
    public IReadOnlyList<IngestJobSnapshot> ListJobs()
    {
        List<Job> jobs;
        lock (_jobsGate) jobs = _jobs.ToList();

        return jobs
            .Select(Snapshot)
            .OrderByDescending(job => job.StartedAt, StringComparer.Ordinal)
            .ToList();
    }

    /// <summary>The job with this id, or null when it never existed. Routes turn null into 404.</summary>
    public IngestJobSnapshot? FindJob(string id)
    {
        Job? job;
        lock (_jobsGate) job = _jobs.FirstOrDefault(item => string.Equals(item.Id, id, StringComparison.Ordinal));
        return job is null ? null : Snapshot(job);
    }

    /// <summary>Completes when the job is finished; the scheduler waits on running jobs.</summary>
    public Task? GetCompletion(string id)
    {
        Job? job;
        lock (_jobsGate) job = _jobs.FirstOrDefault(item => string.Equals(item.Id, id, StringComparison.Ordinal));
        return job?.Completion;
    }

    public IngestScheduleSnapshot GetSchedule()
    {
        var running = ActiveJob();
        var runningSnapshot = running is null
            ? null
            : new IngestRunningJob(running.Id, running.Framework, running.StartedAt);

        lock (_scheduleGate)
        {
            return new IngestScheduleSnapshot(
                Enabled: Enabled,
                IntervalHours: IntervalMsToHours(_intervalMs),
                LastRunAt: _schedule.LastRunAt,
                LastFinishedAt: _schedule.LastFinishedAt,
                LastTrigger: _schedule.LastTrigger,
                LastStatus: _schedule.LastStatus,
                LastError: _schedule.LastError,
                LastResult: _schedule.LastResult?.ToList(),
                NextRunAt: _schedule.NextRunAt,
                Running: runningSnapshot);
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        lock (_scheduleGate)
        {
            _timer?.Dispose();
            _timer = null;
            _schedule.NextRunAt = null;
        }

        _shutdown.Cancel();
        // The CTS is not disposed: jobs still holding the token would get ObjectDisposedException
        // from their cancellation registrations. Cancelling is what stops them.
    }

    private async Task RunJobAsync(
        Job job,
        IReadOnlyList<string> frameworks,
        string trigger,
        TaskCompletionSource completion)
    {
        try
        {
            await Task.Yield();

            var results = new List<IngestJobFrameworkResult>();

            foreach (var framework in frameworks)
            {
                _shutdownToken.ThrowIfCancellationRequested();

                var options = new IngestOptions
                {
                    FetchedAt = IngestTime.Timestamp(_time.GetUtcNow()),
                    Log = message => PushLog(job, message),
                };

                var result = await _runner.RunAsync(framework, options, _shutdownToken).ConfigureAwait(false);
                await _store.ApplyAsync(result, _shutdownToken).ConfigureAwait(false);

                results.Add(new IngestJobFrameworkResult(
                    framework,
                    result.Source.Id ?? string.Empty,
                    result.Requirements.Count,
                    result.Document.Pages.Count));

                PushLog(job, $"{framework}: saved {result.Requirements.Count} requirements.");
            }

            lock (job)
            {
                job.Status = "succeeded";
                job.Result = results;
            }
        }
        catch (Exception error)
        {
            lock (job)
            {
                job.Status = "failed";
                job.Error = error.Message;
            }

            PushLog(job, $"failed: {error.Message}");
        }
        finally
        {
            lock (job) job.FinishedAt = IngestTime.Timestamp(_time.GetUtcNow());
            RecordRun(job, trigger);
            completion.TrySetResult();
        }
    }

    private async Task ExecuteScheduledRunAsync(string trigger)
    {
        SetNextRunAt(null);

        try
        {
            var start = StartJob("all", trigger);
            var completion = start.Job is null ? null : GetCompletion(start.Job.Id);
            if (completion is not null) await completion.ConfigureAwait(false);
        }
        catch (Exception error)
        {
            _logger?.LogWarning(error, "Scheduled content refresh failed.");

            lock (_scheduleGate)
            {
                _schedule.LastError = error.Message;
                _schedule.LastStatus = "failed";
            }
        }
        finally
        {
            if (Enabled) PlanRun(_intervalMs, "interval");
        }
    }

    private void PlanRun(long delayMs, string trigger)
    {
        if (!Enabled || _disposed) return;

        lock (_scheduleGate)
        {
            _schedule.NextRunAt = IngestTime.Timestamp(_time.GetUtcNow().AddMilliseconds(delayMs));
            _timer?.Dispose();
            _timer = _time.CreateTimer(
                _ => OnScheduleTimer(trigger),
                null,
                TimeSpan.FromMilliseconds(delayMs),
                Timeout.InfiniteTimeSpan);
        }
    }

    private void OnScheduleTimer(string trigger)
    {
        if (_disposed) return;

        var run = ExecuteScheduledRunAsync(trigger);
        _ = run.ContinueWith(
            static failed => _ = failed.Exception,
            CancellationToken.None,
            TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously,
            TaskScheduler.Default);
    }

    private void SetNextRunAt(string? value)
    {
        lock (_scheduleGate) _schedule.NextRunAt = value;
    }

    private Job? ActiveJob()
    {
        lock (_jobsGate)
        {
            return _jobs.FirstOrDefault(job => string.Equals(job.Status, "running", StringComparison.Ordinal));
        }
    }

    private void RecordRun(Job job, string trigger)
    {
        string startedAt;
        string? finishedAt;
        string status;
        string? error;
        List<IngestJobFrameworkResult>? result;

        lock (job)
        {
            startedAt = job.StartedAt;
            finishedAt = job.FinishedAt;
            status = job.Status;
            error = job.Error;
            result = job.Result?.ToList();
        }

        lock (_scheduleGate)
        {
            _schedule.LastRunAt = startedAt;
            _schedule.LastFinishedAt = finishedAt;
            _schedule.LastTrigger = trigger;
            _schedule.LastStatus = status;
            _schedule.LastError = error;
            _schedule.LastResult = result;
        }
    }

    private void PushLog(Job job, string message)
    {
        var entry = new IngestLogEntry(IngestTime.Timestamp(_time.GetUtcNow()), message);

        lock (job)
        {
            job.Logs.Add(entry);
            if (job.Logs.Count > LogLimit) job.Logs.RemoveRange(0, job.Logs.Count - LogLimit);
        }
    }

    private static IngestJobSnapshot Snapshot(Job job)
    {
        lock (job)
        {
            return new IngestJobSnapshot(
                job.Id,
                job.Framework,
                job.Frameworks.ToList(),
                job.Status,
                job.StartedAt,
                job.FinishedAt,
                job.Logs.ToList(),
                job.Result?.ToList(),
                job.Error);
        }
    }

    private static long NormalizeIntervalMs(double hours)
    {
        if (double.IsNaN(hours) || double.IsInfinity(hours) || hours <= 0) return 0;

        var milliseconds = hours * MillisecondsPerHour;
        return milliseconds >= long.MaxValue ? long.MaxValue : (long)Math.Max(60_000, milliseconds);
    }

    private static long ToMilliseconds(double seconds)
    {
        if (double.IsNaN(seconds) || seconds <= 0) return 0;

        var milliseconds = seconds * 1000;
        return milliseconds >= long.MaxValue ? long.MaxValue : (long)milliseconds;
    }

    private static double IntervalMsToHours(long intervalMs) => intervalMs / MillisecondsPerHour;

    private sealed class Job
    {
        public required string Id { get; init; }

        public required string Framework { get; init; }

        public required IReadOnlyList<string> Frameworks { get; init; }

        public required string StartedAt { get; init; }

        public required Task Completion { get; init; }

        public string Status { get; set; } = "running";

        public string? FinishedAt { get; set; }

        public string? Error { get; set; }

        public List<IngestLogEntry> Logs { get; } = [];

        public List<IngestJobFrameworkResult>? Result { get; set; }
    }

    private sealed class ScheduleState
    {
        public string? LastRunAt { get; set; }

        public string? LastFinishedAt { get; set; }

        public string? LastTrigger { get; set; }

        public string? LastStatus { get; set; }

        public string? LastError { get; set; }

        public List<IngestJobFrameworkResult>? LastResult { get; set; }

        public string? NextRunAt { get; set; }
    }
}
