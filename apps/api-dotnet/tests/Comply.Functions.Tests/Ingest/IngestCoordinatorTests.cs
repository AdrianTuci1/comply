using Comply.Functions.Ingest;
using Comply.Functions.Services;
using Comply.Functions.Tests;

namespace Comply.Functions.Tests.Ingest;

public sealed class IngestCoordinatorTests : IDisposable
{
    private static readonly DateTimeOffset Now = new(2026, 10, 30, 12, 0, 0, TimeSpan.Zero);

    private readonly TempWorkspace _workspace = new();

    public void Dispose() => _workspace.Dispose();

    private (IngestCoordinator Coordinator, ManualTimeProvider Time, RecordingIngestRunner Runner) Create(
        IngestScheduleOptions? options = null,
        Func<string, IngestOptions, CancellationToken, Task<IngestResult>>? run = null)
    {
        _workspace.WriteLibrary(_workspace.DataDirectory, Fixtures.Library());

        var library = new LibraryStore(_workspace.DataDirectory, _workspace.SeedDirectory);
        var time = new ManualTimeProvider(Now);
        var store = new IngestStore(library, time);
        var runner = new RecordingIngestRunner(["ai-act", "nis2"], run);
        var coordinator = new IngestCoordinator(
            runner,
            store,
            time,
            options ?? new IngestScheduleOptions { IntervalHours = 0 });

        return (coordinator, time, runner);
    }

    [Fact]
    public async Task Starts_all_frameworks_in_registry_order()
    {
        var (coordinator, _, runner) = Create();

        var start = coordinator.StartJob();

        Assert.Equal(202, start.Status);
        Assert.NotNull(start.Job);
        Assert.Equal("all", start.Job.Framework);
        Assert.Equal(
            ["ai-act", "nis2"],
            start.Job.Frameworks);
        Assert.Equal("running", start.Job.Status);

        await coordinator.GetCompletion(start.Job.Id)!;

        var job = coordinator.FindJob(start.Job.Id)!;
        Assert.Equal("succeeded", job.Status);
        Assert.NotNull(job.FinishedAt);
        Assert.Equal(["ai-act", "nis2"], runner.Calls);
        Assert.Equal(["ai-act", "nis2"], job.Result!.Select(result => result.Framework));
        Assert.All(job.Result!, result => Assert.Equal(2, result.Requirements));
    }

    [Fact]
    public async Task Runs_only_the_requested_framework()
    {
        var (coordinator, _, runner) = Create();

        var start = coordinator.StartJob("nis2");
        await coordinator.GetCompletion(start.Job!.Id)!;

        Assert.Equal(["nis2"], start.Job.Frameworks);
        Assert.Equal(["nis2"], runner.Calls);
    }

    [Fact]
    public void Defaults_a_missing_framework_to_all()
    {
        var (coordinator, _, _) = Create();

        var start = coordinator.StartJob(null);

        Assert.Equal(202, start.Status);
        Assert.Equal("all", start.Job!.Framework);
    }

    [Fact]
    public void Rejects_an_unknown_framework_with_400()
    {
        var (coordinator, _, runner) = Create();

        var start = coordinator.StartJob("iso27001");

        Assert.Equal(400, start.Status);
        Assert.Null(start.Job);
        Assert.Equal("Unknown framework: iso27001.", start.Error);
        Assert.Empty(coordinator.ListJobs());
        Assert.Empty(runner.Calls);
    }

    [Fact]
    public async Task Reuses_an_active_job_that_covers_the_framework()
    {
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var (coordinator, _, _) = Create(run: async (framework, options, _) =>
        {
            await gate.Task;
            return IngestSamples.Result(framework, options.ResolveFetchedAt());
        });

        var first = coordinator.StartJob("all");
        var second = coordinator.StartJob("nis2");

        Assert.Equal(202, second.Status);
        Assert.Equal(first.Job!.Id, second.Job!.Id);

        gate.SetResult();
        await coordinator.GetCompletion(first.Job.Id)!;
        Assert.Single(coordinator.ListJobs());
    }

    [Fact]
    public async Task Allows_parallel_jobs_for_disjoint_frameworks()
    {
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var (coordinator, _, _) = Create(run: async (framework, options, _) =>
        {
            await gate.Task;
            return IngestSamples.Result(framework, options.ResolveFetchedAt());
        });

        var first = coordinator.StartJob("ai-act");
        var second = coordinator.StartJob("nis2");

        Assert.NotEqual(first.Job!.Id, second.Job!.Id);
        Assert.Equal(["ai-act"], first.Job.Frameworks);
        Assert.Equal(["nis2"], second.Job.Frameworks);

        gate.SetResult();
        await coordinator.GetCompletion(first.Job.Id)!;
        await coordinator.GetCompletion(second.Job.Id)!;
        Assert.Equal(2, coordinator.ListJobs().Count);
    }

    [Fact]
    public async Task Records_failures_on_the_job()
    {
        var (coordinator, _, _) = Create(run: (_, _, _) =>
            Task.FromException<IngestResult>(new IngestException("upstream exploded")));

        var start = coordinator.StartJob("nis2");
        await coordinator.GetCompletion(start.Job!.Id)!;

        var job = coordinator.FindJob(start.Job.Id)!;
        Assert.Equal("failed", job.Status);
        Assert.Equal("upstream exploded", job.Error);
        Assert.Contains(job.Logs, log => log.Message == "failed: upstream exploded");
        Assert.NotNull(job.FinishedAt);
        Assert.Equal("failed", coordinator.GetSchedule().LastStatus);
    }

    [Fact]
    public async Task Caps_the_job_log_at_200_entries()
    {
        var (coordinator, _, _) = Create(run: (framework, options, _) =>
        {
            for (var index = 1; index <= 250; index++) options.Log?.Invoke($"message {index}");
            return Task.FromResult(IngestSamples.Result(framework, options.ResolveFetchedAt()));
        });

        var start = coordinator.StartJob("nis2");
        await coordinator.GetCompletion(start.Job!.Id)!;

        var job = coordinator.FindJob(start.Job.Id)!;
        Assert.Equal(200, job.Logs.Count);
        Assert.Equal("message 52", job.Logs[0].Message);
        Assert.Equal("message 250", job.Logs[^2].Message);
        Assert.Equal("nis2: saved 2 requirements.", job.Logs[^1].Message);
    }

    [Fact]
    public async Task Lists_jobs_newest_first()
    {
        var (coordinator, time, _) = Create();

        var first = coordinator.StartJob("nis2");
        await coordinator.GetCompletion(first.Job!.Id)!;

        time.Advance(TimeSpan.FromSeconds(5));
        var second = coordinator.StartJob("ai-act");
        await coordinator.GetCompletion(second.Job!.Id)!;

        var jobs = coordinator.ListJobs();

        Assert.Equal(second.Job.Id, jobs[0].Id);
        Assert.Equal(first.Job.Id, jobs[1].Id);
    }

    [Fact]
    public void Returns_null_for_an_unknown_job()
    {
        var (coordinator, _, _) = Create();

        Assert.Null(coordinator.FindJob("not-a-job"));
        Assert.Null(coordinator.GetCompletion("not-a-job"));
    }

    [Fact]
    public void Reports_a_disabled_schedule()
    {
        var (coordinator, time, _) = Create();

        coordinator.Start();
        var schedule = coordinator.GetSchedule();

        Assert.False(schedule.Enabled);
        Assert.Equal(0, schedule.IntervalHours);
        Assert.Null(schedule.NextRunAt);
        Assert.Null(schedule.Running);
        Assert.Null(schedule.LastRunAt);
        Assert.Empty(time.Timers);
    }

    [Fact]
    public async Task Reports_the_running_job_on_the_schedule()
    {
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var (coordinator, _, _) = Create(run: async (framework, options, _) =>
        {
            await gate.Task;
            return IngestSamples.Result(framework, options.ResolveFetchedAt());
        });

        var start = coordinator.StartJob("nis2");

        var running = coordinator.GetSchedule().Running;
        Assert.NotNull(running);
        Assert.Equal(start.Job!.Id, running.Id);
        Assert.Equal("nis2", running.Framework);
        Assert.Equal("2026-10-30T12:00:00.000Z", running.StartedAt);

        gate.SetResult();
        await coordinator.GetCompletion(start.Job.Id)!;
        Assert.Null(coordinator.GetSchedule().Running);
    }

    [Fact]
    public void Plans_the_startup_run_after_the_configured_delay()
    {
        var (coordinator, time, _) = Create(new IngestScheduleOptions
        {
            IntervalHours = 168,
            StartupDelaySeconds = 30,
            RunOnStart = true,
        });

        coordinator.Start();

        Assert.True(coordinator.Enabled);
        Assert.Equal(TimeSpan.FromSeconds(30), Assert.Single(time.Timers).DueTime);
        var schedule = coordinator.GetSchedule();
        Assert.True(schedule.Enabled);
        Assert.Equal(168, schedule.IntervalHours);
        Assert.Equal("2026-10-30T12:00:30.000Z", schedule.NextRunAt);
    }

    [Fact]
    public void Schedules_the_interval_when_the_startup_run_is_disabled()
    {
        var (coordinator, time, _) = Create(new IngestScheduleOptions
        {
            IntervalHours = 168,
            StartupDelaySeconds = 30,
            RunOnStart = false,
        });

        coordinator.Start();

        Assert.Equal(TimeSpan.FromHours(168), Assert.Single(time.Timers).DueTime);
        Assert.Equal("2026-11-06T12:00:00.000Z", coordinator.GetSchedule().NextRunAt);
    }

    [Fact]
    public void Start_is_idempotent()
    {
        var (coordinator, time, _) = Create(new IngestScheduleOptions { IntervalHours = 168 });

        coordinator.Start();
        coordinator.Start();

        Assert.Single(time.Timers);
    }

    [Fact]
    public async Task Starting_a_job_also_starts_the_timer()
    {
        var (coordinator, time, _) = Create(new IngestScheduleOptions { IntervalHours = 24 });

        var start = coordinator.StartJob("nis2");
        await coordinator.GetCompletion(start.Job!.Id)!;

        Assert.Single(time.Timers);
        Assert.Equal(TimeSpan.FromSeconds(30), time.Timers[0].DueTime);
    }

    [Fact]
    public async Task Records_the_last_run_on_the_schedule()
    {
        var (coordinator, _, _) = Create();

        var start = coordinator.StartJob("nis2");
        await coordinator.GetCompletion(start.Job!.Id)!;

        var job = coordinator.FindJob(start.Job.Id)!;
        var schedule = coordinator.GetSchedule();

        Assert.Equal(job.StartedAt, schedule.LastRunAt);
        Assert.Equal(job.FinishedAt, schedule.LastFinishedAt);
        Assert.Equal("manual", schedule.LastTrigger);
        Assert.Equal("succeeded", schedule.LastStatus);
        Assert.Null(schedule.LastError);
        Assert.Equal(["nis2"], schedule.LastResult!.Select(result => result.Framework));
    }

    [Fact]
    public async Task Runs_all_frameworks_when_the_timer_fires()
    {
        var (coordinator, time, _) = Create(new IngestScheduleOptions
        {
            IntervalHours = 168,
            StartupDelaySeconds = 30,
            RunOnStart = true,
        });

        coordinator.Start();
        time.Fire();

        await AsyncWait.UntilAsync(() => coordinator.ListJobs().Count == 1, "the scheduled job to start");
        var job = Assert.Single(coordinator.ListJobs());
        await coordinator.GetCompletion(job.Id)!;

        var finished = coordinator.FindJob(job.Id)!;
        Assert.Equal("all", finished.Framework);
        Assert.Equal(["ai-act", "nis2"], finished.Frameworks);
        Assert.Equal("succeeded", finished.Status);

        await AsyncWait.UntilAsync(
            () => coordinator.GetSchedule().NextRunAt is not null,
            "the next interval run to be planned");

        var schedule = coordinator.GetSchedule();
        Assert.Equal("startup", schedule.LastTrigger);
        Assert.Equal("succeeded", schedule.LastStatus);
        Assert.Equal("2026-11-06T12:00:00.000Z", schedule.NextRunAt);
    }

    [Fact]
    public void Interval_has_a_one_minute_floor()
    {
        var (coordinator, _, _) = Create(new IngestScheduleOptions { IntervalHours = 0.001 });

        Assert.True(coordinator.Enabled);
        Assert.Equal(1d / 60, coordinator.GetSchedule().IntervalHours, 6);
    }

    [Fact]
    public void Non_numeric_intervals_disable_the_schedule()
    {
        var (coordinator, _, _) = Create(new IngestScheduleOptions { IntervalHours = double.NaN });

        Assert.False(coordinator.Enabled);
        coordinator.Start();
        Assert.Null(coordinator.GetSchedule().NextRunAt);
    }

    [Fact]
    public void Dispose_stops_the_timer_and_rejects_new_jobs()
    {
        var (coordinator, time, _) = Create(new IngestScheduleOptions { IntervalHours = 168 });
        coordinator.Start();

        coordinator.Dispose();

        Assert.True(Assert.Single(time.Timers).Disposed);
        Assert.Null(coordinator.GetSchedule().NextRunAt);
        Assert.Throws<ObjectDisposedException>(() => coordinator.StartJob("nis2"));
    }
}

public sealed class IngestScheduleOptionsTests
{
    private static IngestScheduleOptions Read(params (string Key, string Value)[] values)
    {
        var map = values.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal);
        return IngestScheduleOptions.FromValues(key => map.GetValueOrDefault(key));
    }

    [Fact]
    public void Uses_the_node_defaults()
    {
        var options = IngestScheduleOptions.FromValues(_ => null);

        Assert.Equal(168, options.IntervalHours);
        Assert.Equal(30, options.StartupDelaySeconds);
        Assert.True(options.RunOnStart);
    }

    [Fact]
    public void Reads_the_environment_variables()
    {
        var options = Read(
            ("COMPLY_INGEST_INTERVAL_HOURS", "24"),
            ("COMPLY_INGEST_STARTUP_DELAY_SECONDS", "5"),
            ("COMPLY_INGEST_ON_START", "0"));

        Assert.Equal(24, options.IntervalHours);
        Assert.Equal(5, options.StartupDelaySeconds);
        Assert.False(options.RunOnStart);
    }

    [Fact]
    public void Unparsable_interval_disables_the_schedule()
    {
        var options = Read(("COMPLY_INGEST_INTERVAL_HOURS", "weekly"));

        Assert.True(double.IsNaN(options.IntervalHours));
    }

    [Fact]
    public void Unparsable_delay_runs_immediately()
    {
        var options = Read(("COMPLY_INGEST_STARTUP_DELAY_SECONDS", "soon"));

        Assert.True(double.IsNaN(options.StartupDelaySeconds));
    }
}
