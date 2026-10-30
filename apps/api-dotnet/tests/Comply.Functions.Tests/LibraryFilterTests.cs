using Comply.Functions.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.WebUtilities;

namespace Comply.Functions.Tests;

public sealed class LibraryFilterTests
{
    private static LibraryQuery Parse(string queryString)
    {
        var collection = new QueryCollection(QueryHelpers.ParseQuery(queryString));
        Assert.True(LibraryQuery.TryParse(collection, out var query, out var error), error);
        return query;
    }

    [Fact]
    public void Returns_the_whole_library_when_no_query_parameters_are_present()
    {
        var response = LibraryFilter.Apply(Fixtures.Library(), Parse(""));

        Assert.Equal(4, response.Requirements.Count);
        Assert.Equal(2, response.Sources.Count);
        Assert.Equal(4, response.Total);
        Assert.Equal(1, response.Page);
        Assert.Equal(4, response.PageSize);
        Assert.Equal("2026-10-30T00:00:00.000Z", response.UpdatedAt);
    }

    [Fact]
    public void Filters_requirements_and_sources_by_framework()
    {
        var response = LibraryFilter.Apply(Fixtures.Library(), Parse("?framework=nis2"));

        Assert.Equal(2, response.Requirements.Count);
        Assert.All(response.Requirements, item => Assert.Equal("nis2", item.FrameworkId));
        Assert.Equal(Fixtures.Nis2SourceId, Assert.Single(response.Sources).Id);
        Assert.Equal(2, response.Total);
        Assert.Equal(1, response.Page);
        Assert.Equal(50, response.PageSize);
    }

    [Fact]
    public void Filters_requirements_by_status()
    {
        var response = LibraryFilter.Apply(Fixtures.Library(), Parse("?status=published"));

        Assert.Equal(2, response.Requirements.Count);
        Assert.All(response.Requirements, item => Assert.Equal("published", item.Status));
        Assert.Equal(2, response.Sources.Count);
    }

    [Theory]
    [InlineData("?q=transparency")]
    [InlineData("?q=TRANSPARENCY")]
    [InlineData("?q=%20transparency%20")]
    public void Searches_ref_title_and_text_case_insensitively(string queryString)
    {
        var response = LibraryFilter.Apply(Fixtures.Library(), Parse(queryString));

        Assert.Equal("req-ai-2", Assert.Single(response.Requirements).Id);
    }

    [Fact]
    public void Searches_references()
    {
        var response = LibraryFilter.Apply(Fixtures.Library(), Parse("?framework=ai-act&q=art."));

        Assert.Equal(2, response.Requirements.Count);
    }

    [Fact]
    public void Returns_an_empty_page_when_paging_past_the_end()
    {
        var response = LibraryFilter.Apply(Fixtures.Library(), Parse("?page=9&pageSize=2"));

        Assert.Empty(response.Requirements);
        Assert.Equal(4, response.Total);
        Assert.Equal(9, response.Page);
        Assert.Equal(2, response.PageSize);
    }

    [Fact]
    public void Pages_through_the_filtered_set()
    {
        var response = LibraryFilter.Apply(Fixtures.Library(), Parse("?framework=nis2&page=2&pageSize=1"));

        Assert.Equal("req-nis-2", Assert.Single(response.Requirements).Id);
        Assert.Equal(2, response.Total);
    }

    [Fact]
    public void Caps_page_size_at_the_node_limit()
    {
        var response = LibraryFilter.Apply(Fixtures.Library(), Parse("?pageSize=1000"));

        Assert.Equal(LibraryQuery.MaxPageSize, response.PageSize);
        Assert.Equal(4, response.Total);
    }

    [Fact]
    public void Treats_empty_filter_values_as_absent_filters()
    {
        var response = LibraryFilter.Apply(Fixtures.Library(), Parse("?framework=&status=&q="));

        Assert.Equal(4, response.Requirements.Count);
        Assert.Equal(2, response.Sources.Count);
        Assert.Equal(50, response.PageSize);
    }

    [Theory]
    [InlineData("?page=0", "page")]
    [InlineData("?page=-2", "page")]
    [InlineData("?page=abc", "page")]
    [InlineData("?page=", "page")]
    [InlineData("?pageSize=0", "pageSize")]
    [InlineData("?pageSize=abc", "pageSize")]
    public void Rejects_invalid_paging_values(string queryString, string parameter)
    {
        var collection = new QueryCollection(QueryHelpers.ParseQuery(queryString));

        var parsed = LibraryQuery.TryParse(collection, out _, out var error);

        Assert.False(parsed);
        Assert.Contains(parameter, error);
    }
}
