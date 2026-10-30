using System.Globalization;
using Comply.Functions.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Primitives;

namespace Comply.Functions.Services;

/// <summary>
/// Filter and paging arguments of <c>GET /api/library</c>, parsed with the same rules as the
/// Node API. Values present but empty behave like absent filters, matching
/// <c>URLSearchParams.get()</c>.
/// </summary>
public sealed record LibraryQuery
{
    public const int DefaultPageSize = 50;
    public const int MaxPageSize = 500;

    private static readonly string[] KnownParameters = ["framework", "status", "q", "page", "pageSize"];

    /// <summary>True when any known parameter is present, even with an empty value.</summary>
    public bool HasParameters { get; init; }

    public string? Framework { get; init; }

    public string? Status { get; init; }

    public string Query { get; init; } = "";

    public int Page { get; init; } = 1;

    public int PageSize { get; init; } = DefaultPageSize;

    public static bool TryParse(
        IQueryCollection query,
        out LibraryQuery parsed,
        out string? error)
    {
        parsed = new LibraryQuery();
        error = null;

        var hasParameters = KnownParameters.Any(query.ContainsKey);
        var framework = FirstValue(query, "framework");
        var status = FirstValue(query, "status");
        var search = FirstValue(query, "q")?.Trim().ToLowerInvariant() ?? "";

        var page = 1;
        if (query.ContainsKey("page") &&
            !TryReadPositiveInt(FirstValue(query, "page"), out page))
        {
            error = "The page query parameter must be a positive integer.";
            return false;
        }

        var pageSize = DefaultPageSize;
        if (query.ContainsKey("pageSize"))
        {
            if (!TryReadPositiveInt(FirstValue(query, "pageSize"), out pageSize))
            {
                error = "The pageSize query parameter must be a positive integer.";
                return false;
            }

            // The Node API silently caps page sizes; keep the cap but reject nonsense values.
            pageSize = Math.Min(pageSize, MaxPageSize);
        }

        parsed = new LibraryQuery
        {
            HasParameters = hasParameters,
            Framework = framework,
            Status = status,
            Query = search,
            Page = page,
            PageSize = pageSize,
        };

        return true;
    }

    private static string? FirstValue(IQueryCollection query, string key) =>
        query.TryGetValue(key, out StringValues values) && values.Count > 0 ? values[0] : null;

    private static bool TryReadPositiveInt(string? value, out int result)
    {
        result = 0;
        return int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out result) && result > 0;
    }
}
