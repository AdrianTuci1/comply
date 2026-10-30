using System.Globalization;

namespace Comply.Functions.Ingest;

/// <summary>One job log line, same shape as the Node <c>{ at, message }</c> entries.</summary>
public sealed record IngestLogEntry(string At, string Message);

/// <summary>Per-framework summary written to <c>job.result</c>.</summary>
public sealed record IngestJobFrameworkResult(string Framework, string SourceId, int Requirements, int Pages);

/// <summary>Response shape of <c>GET /api/ingest</c> and <c>GET /api/ingest/{id}</c>.</summary>
public sealed record IngestJobSnapshot(
    string Id,
    string Framework,
    IReadOnlyList<string> Frameworks,
    string Status,
    string StartedAt,
    string? FinishedAt,
    IReadOnlyList<IngestLogEntry> Logs,
    IReadOnlyList<IngestJobFrameworkResult>? Result,
    string? Error);

/// <summary>Job currently holding a framework, exposed inside the schedule document.</summary>
public sealed record IngestRunningJob(string Id, string Framework, string StartedAt);

/// <summary>Response shape of <c>GET /api/ingest/schedule</c>.</summary>
public sealed record IngestScheduleSnapshot(
    bool Enabled,
    double IntervalHours,
    string? LastRunAt,
    string? LastFinishedAt,
    string? LastTrigger,
    string? LastStatus,
    string? LastError,
    IReadOnlyList<IngestJobFrameworkResult>? LastResult,
    string? NextRunAt,
    IngestRunningJob? Running);

/// <summary>
/// Outcome of <c>POST /api/ingest</c>. <see cref="Status"/> is 202 for a created or reused job
/// and 400 for an unknown framework, matching the Node handler.
/// </summary>
public sealed record IngestStartResult(int Status, IngestJobSnapshot? Job, string? Error);

/// <summary>
/// Schedule configuration. Defaults mirror the Node server: weekly refresh, 30s delay after
/// startup, startup run enabled. <c>COMPLY_INGEST_ON_START=0</c> disables the startup run,
/// <c>COMPLY_INGEST_INTERVAL_HOURS</c> sets the interval and
/// <c>COMPLY_INGEST_STARTUP_DELAY_SECONDS</c> the delay.
/// </summary>
public sealed class IngestScheduleOptions
{
    public const string IntervalVariable = "COMPLY_INGEST_INTERVAL_HOURS";
    public const string StartupDelayVariable = "COMPLY_INGEST_STARTUP_DELAY_SECONDS";
    public const string OnStartVariable = "COMPLY_INGEST_ON_START";

    public double IntervalHours { get; init; } = 168;

    public double StartupDelaySeconds { get; init; } = 30;

    public bool RunOnStart { get; init; } = true;

    public static IngestScheduleOptions FromEnvironment() =>
        FromValues(Environment.GetEnvironmentVariable);

    /// <summary>Reads the same variables through an injectable reader so tests avoid process state.</summary>
    public static IngestScheduleOptions FromValues(Func<string, string?> read)
    {
        var interval = read(IntervalVariable);
        var delay = read(StartupDelayVariable);

        return new IngestScheduleOptions
        {
            // A missing variable uses the default; an unparsable one becomes NaN, which
            // disables the schedule for the interval and means "run immediately" for the delay,
            // exactly like Number(...) in the Node server.
            IntervalHours = interval is null ? 168 : ParseNumber(interval),
            StartupDelaySeconds = delay is null ? 30 : ParseNumber(delay),
            RunOnStart = read(OnStartVariable) != "0",
        };
    }

    private static double ParseNumber(string value) =>
        double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : double.NaN;
}
