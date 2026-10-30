using Comply.Functions.Models;

namespace Comply.Functions.Services;

/// <summary>
/// Applies <see cref="LibraryQuery"/> to the library and builds the paged response.
/// Behaviour mirrors <c>filterLibrary()</c> in the Node API.
/// </summary>
public static class LibraryFilter
{
    private static readonly StringComparison SearchComparison = StringComparison.OrdinalIgnoreCase;

    public static LibraryResponse Apply(ContentLibrary library, LibraryQuery query)
    {
        if (!query.HasParameters)
        {
            return new LibraryResponse(
                library.Version,
                library.UpdatedAt,
                library.Sources,
                library.Requirements,
                library.Documents,
                library.Requirements.Count,
                Page: 1,
                PageSize: library.Requirements.Count);
        }

        var sources = library.Sources;
        var requirements = library.Requirements.AsEnumerable();

        if (!string.IsNullOrEmpty(query.Framework))
        {
            sources = sources.Where(source => source.FrameworkId == query.Framework).ToList();
            requirements = requirements.Where(item => item.FrameworkId == query.Framework);
        }

        if (!string.IsNullOrEmpty(query.Status))
        {
            requirements = requirements.Where(item => item.Status == query.Status);
        }

        if (query.Query.Length > 0)
        {
            requirements = requirements.Where(item => Matches(item, query.Query));
        }

        var filtered = requirements.ToList();
        var total = filtered.Count;

        var skip = (long)(query.Page - 1) * query.PageSize;
        List<Requirement> page = skip >= total
            ? []
            : filtered.Skip((int)skip).Take(query.PageSize).ToList();

        return new LibraryResponse(
            library.Version,
            library.UpdatedAt,
            sources,
            page,
            library.Documents,
            total,
            query.Page,
            query.PageSize);
    }

    private static bool Matches(Requirement requirement, string query) =>
        Contains(requirement.Ref, query) ||
        Contains(requirement.Title, query) ||
        Contains(requirement.Text, query);

    private static bool Contains(string? value, string query) =>
        !string.IsNullOrEmpty(value) && value.Contains(query, SearchComparison);
}
