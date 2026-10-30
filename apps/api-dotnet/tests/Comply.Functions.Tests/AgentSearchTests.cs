using System.Text.Json.Nodes;
using Comply.Functions.Agent;

namespace Comply.Functions.Tests;

public sealed class AgentSearchTests
{
    private static string Text(JsonNode? node) => node!.GetValue<string>();

    private static async Task<string> AssessmentAsync(AgentFixture fixture)
    {
        var started = await fixture.CallAsync(
            "start_assessment",
            """{"framework":"nis2","scope":"Production systems."}""");
        return Text(started["assessment_id"]);
    }

    [Fact]
    public async Task Search_ranks_the_closest_requirement_first()
    {
        using var fixture = new AgentFixture();
        var assessmentId = await AssessmentAsync(fixture);

        var search = await fixture.CallAsync(
            "search_requirements",
            $$"""{"assessmentId":"{{assessmentId}}","query":"risk analysis policies"}""");

        var items = search["items"]!.AsArray();
        Assert.NotEmpty(items);
        Assert.Equal("req-nis2-risk", Text(items[0]!["requirement_id"]));
        Assert.Contains("risk", items[0]!["matched_terms"]!.AsArray().Select(node => Text(node)));
        var score = items[0]!["score"]!.GetValue<double>();
        Assert.InRange(score, 0.05, 1.0);
        Assert.Equal(score, Math.Round(score, 3), 12);
    }

    [Fact]
    public async Task Search_folds_english_plurals()
    {
        using var fixture = new AgentFixture();
        var assessmentId = await AssessmentAsync(fixture);

        var search = await fixture.CallAsync(
            "search_requirements",
            $$"""{"assessmentId":"{{assessmentId}}","query":"policies"}""");

        var ids = search["items"]!.AsArray().Select(node => Text(node!["requirement_id"])).ToList();
        Assert.Contains("req-nis2-risk", ids);
        Assert.Equal("policy", Text(search["items"]![0]!["matched_terms"]![0]));
    }

    [Fact]
    public async Task Search_rejects_an_empty_or_ambiguous_query()
    {
        using var fixture = new AgentFixture();
        var assessmentId = await AssessmentAsync(fixture);

        var both = await Assert.ThrowsAsync<AgentException>(() => fixture.CallAsync(
            "search_requirements",
            $$"""{"assessmentId":"{{assessmentId}}","query":"risk","similarTo":"req-nis2-risk"}"""));
        var neither = await Assert.ThrowsAsync<AgentException>(() => fixture.CallAsync(
            "search_requirements",
            $$"""{"assessmentId":"{{assessmentId}}"}"""));
        var stopwords = await Assert.ThrowsAsync<AgentException>(() => fixture.CallAsync(
            "search_requirements",
            $$"""{"assessmentId":"{{assessmentId}}","query":"the and of"}"""));

        Assert.Equal("invalid_search", both.Code);
        Assert.Equal("Provide query or similarTo, not both.", both.Message);
        Assert.Equal("query_required", neither.Code);
        Assert.Equal("Provide query or similarTo to search the checklist.", neither.Message);
        Assert.Equal("query_required", stopwords.Code);
        Assert.Equal("Use at least one meaningful English term in the search.", stopwords.Message);
    }

    [Fact]
    public async Task Search_by_similarity_excludes_the_reference_requirement()
    {
        using var fixture = new AgentFixture();
        var assessmentId = await AssessmentAsync(fixture);

        var search = await fixture.CallAsync(
            "search_requirements",
            $$"""{"assessmentId":"{{assessmentId}}","similarTo":"req-nis2-risk"}""");

        var ids = search["items"]!.AsArray().Select(node => Text(node!["requirement_id"])).ToList();
        Assert.DoesNotContain("req-nis2-risk", ids);
        Assert.Equal("req-nis2-risk", Text(search["similar_to"]));
        Assert.Null(search["query"]);
    }

    [Fact]
    public async Task Search_filters_by_status_and_rejects_unknown_ones()
    {
        using var fixture = new AgentFixture();
        var assessmentId = await AssessmentAsync(fixture);
        await fixture.CallAsync(
            "mark_not_applicable",
            $$"""{"assessmentId":"{{assessmentId}}","requirementId":"req-nis2-risk","reason":"No suppliers."}""");

        var open = await fixture.CallAsync(
            "search_requirements",
            $$"""{"assessmentId":"{{assessmentId}}","query":"security","status":"open"}""");
        var unknown = await Assert.ThrowsAsync<AgentException>(() => fixture.CallAsync(
            "search_requirements",
            $$"""{"assessmentId":"{{assessmentId}}","query":"security","status":"done"}"""));

        Assert.All(open["items"]!.AsArray(), node => Assert.Equal("open", Text(node!["status"])));
        Assert.Equal("invalid_status", unknown.Code);
        Assert.Equal("Unknown requirement status.", unknown.Message);
    }

    [Fact]
    public async Task Search_honours_the_minimum_score_and_pages_results()
    {
        using var fixture = new AgentFixture();
        var assessmentId = await AssessmentAsync(fixture);

        var strict = await fixture.CallAsync(
            "search_requirements",
            $$"""{"assessmentId":"{{assessmentId}}","query":"security","minScore":1}""");
        var paged = await fixture.CallAsync(
            "search_requirements",
            $$"""{"assessmentId":"{{assessmentId}}","query":"security","pageSize":1}""");

        Assert.Empty(strict["items"]!.AsArray());
        Assert.Equal(0, strict["total"]!.GetValue<int>());
        Assert.True(paged["page_info"]!["has_next_page"]!.GetValue<bool>());
        Assert.Single(paged["items"]!.AsArray());
    }

    [Fact]
    public async Task Search_limits_matched_terms_to_five()
    {
        using var fixture = new AgentFixture();
        var assessmentId = await AssessmentAsync(fixture);

        var search = await fixture.CallAsync(
            "search_requirements",
            $$"""{"assessmentId":"{{assessmentId}}","query":"incident handling processes detect report respond security incidents","pageSize":1}""");

        Assert.True(search["items"]![0]!["matched_terms"]!.AsArray().Count <= 5);
    }
}

public sealed class AgentTextTests
{
    [Fact]
    public void Tokenize_lowercases_folds_accents_and_drops_stopwords()
    {
        Assert.Equal(
            new[] { "securite", "policy" },
            AgentText.Tokenize("Sécurité, the Policy!"));
    }

    [Theory]
    [InlineData("policies", "policy")]
    [InlineData("assessments", "assessment")]
    [InlineData("processes", "process")]
    [InlineData("status", "status")]
    [InlineData("access", "access")]
    [InlineData("analysis", "analysis")]
    [InlineData("risk", "risk")]
    public void Stem_folds_english_plurals(string term, string expected)
    {
        Assert.Equal(expected, AgentText.Stem(term));
    }

    [Fact]
    public void Search_text_counts_the_title_twice()
    {
        Assert.Equal(
            "A.1 Title Title Body Conclusion",
            AgentText.SearchText("A.1", "Title", "Body", "Conclusion"));
    }

    [Fact]
    public void Js_round_matches_math_round()
    {
        Assert.Equal(2, AgentText.JsRound(1.5));
        Assert.Equal(3, AgentText.JsRound(2.5));
        Assert.Equal(0, AgentText.JsRound(0.4));
        Assert.Equal(0, AgentText.JsRound(-0.5));
    }

    [Fact]
    public void Clamp_uses_the_minimum_for_nan()
    {
        Assert.Equal(1, AgentText.Clamp(double.NaN, 1, 100));
        Assert.Equal(1, AgentText.Clamp(null, 1, 100));
        Assert.Equal(100, AgentText.Clamp(1000, 1, 100));
        Assert.Equal(25, AgentText.Clamp(24.6, 1, 100));
    }
}
