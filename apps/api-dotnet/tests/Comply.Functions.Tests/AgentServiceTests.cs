using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Comply.Functions.Agent;

namespace Comply.Functions.Tests;

public sealed class AgentServiceTests
{
    private static string Text(JsonNode? node) => node!.GetValue<string>();

    private static async Task<JsonObject> StartAsync(AgentFixture fixture, string json = """{"framework":"nis2","scope":"Production systems."}""") =>
        await fixture.CallAsync("start_assessment", json);

    [Fact]
    public async Task Start_covers_the_full_framework_pool_and_opens_the_collect_phase()
    {
        using var fixture = new AgentFixture();

        var started = await StartAsync(fixture);

        Assert.Equal("NIS2 assessment", Text(started["name"]));
        Assert.Equal("nis2", Text(started["framework"]));
        Assert.Equal("collect", Text(started["phase"]));
        Assert.Equal("collect", Text(started["status"]));
        Assert.Equal("Production systems.", Text(started["scope"]));
        Assert.Equal(1, started["revision"]!.GetValue<int>());
        Assert.Equal("2026-01-01", Text(started["period"]!["from"]));
        Assert.Equal("2026-12-31", Text(started["period"]!["to"]));
        Assert.Equal(5, started["progress"]!["total"]!.GetValue<int>());
        Assert.Equal(5, started["progress"]!["open"]!.GetValue<int>());
        Assert.Equal(0, started["progress"]!["percent"]!.GetValue<int>());
        Assert.Equal("created", Text(started["events"]![0]!["type"]));
        Assert.Equal(
            "Assessment created from 5 available requirements.",
            Text(started["events"]![0]!["message"]));
        Assert.Equal("get_requirement", Text(started["next_actions"]![0]!["tool"]));
        Assert.Equal("any", Text(started["language_policy"]!["userLanguage"]));
        Assert.Equal("en", Text(started["language_policy"]!["publishLanguage"]));
        Assert.Empty(started["blocked_by"]!.AsArray());
        Assert.StartsWith("asm-", Text(started["assessment_id"]));
        Assert.Equal(8, Text(started["assessment_id"])["asm-".Length..].Length);
    }

    [Fact]
    public async Task Start_without_a_scope_starts_at_the_scope_phase()
    {
        using var fixture = new AgentFixture();

        var started = await fixture.CallAsync("start_assessment", """{"framework":"nis2"}""");

        Assert.Equal("scope", Text(started["phase"]));
        Assert.Equal("set_scope", Text(started["next_actions"]![0]!["tool"]));
        Assert.Equal("scope", Text(started["blocked_by"]![0]));
    }

    [Fact]
    public async Task Start_rejects_an_unknown_framework()
    {
        using var fixture = new AgentFixture();

        var error = await Assert.ThrowsAsync<AgentException>(
            () => fixture.CallAsync("start_assessment", """{"framework":"gdpr"}"""));

        Assert.Equal("invalid_framework", error.Code);
        Assert.Equal("Choose a framework: nis2, iso27001, ai-act, soc2.", error.Message);
    }

    [Fact]
    public async Task Start_reports_an_empty_library()
    {
        using var fixture = new AgentFixture();
        // soc2 has no requirements in the fixture library.
        var error = await Assert.ThrowsAsync<AgentException>(
            () => fixture.CallAsync("start_assessment", """{"framework":"soc2"}"""));

        Assert.Equal("empty_library", error.Code);
        Assert.Equal(
            "No requirements are available for soc2. Refresh the sources first.",
            error.Message);
    }

    [Fact]
    public async Task Start_respects_an_explicit_limit()
    {
        using var fixture = new AgentFixture();

        var started = await fixture.CallAsync(
            "start_assessment",
            """{"framework":"nis2","scope":"Production.","limit":2}""");

        Assert.Equal(2, started["progress"]!["total"]!.GetValue<int>());
        Assert.Equal(
            "Assessment created from 5 available requirements.",
            Text(started["events"]![0]!["message"]));
    }

    [Theory]
    [InlineData("nis2", "extracted")]
    [InlineData("iso27001", "published")]
    public async Task Start_derives_the_content_status_from_the_library(string framework, string expected)
    {
        using var fixture = new AgentFixture();

        var started = await fixture.CallAsync(
            "start_assessment",
            $$"""{"framework":"{{framework}}","scope":"Production."}""");

        Assert.Equal(expected, Text(started["content_status"]));
    }

    [Fact]
    public async Task Start_validates_the_period()
    {
        using var fixture = new AgentFixture();

        var invalid = await Assert.ThrowsAsync<AgentException>(() => fixture.CallAsync(
            "start_assessment",
            """{"framework":"nis2","periodFrom":"30-10-2026"}"""));
        var reversed = await Assert.ThrowsAsync<AgentException>(() => fixture.CallAsync(
            "start_assessment",
            """{"framework":"nis2","periodFrom":"2026-06-01","periodTo":"2026-01-01"}"""));

        Assert.Equal("invalid_date", invalid.Code);
        Assert.Equal("periodFrom must be an ISO date (YYYY-MM-DD).", invalid.Message);
        Assert.Equal("invalid_period", reversed.Code);
        Assert.Equal("periodFrom must be before periodTo.", reversed.Message);
    }

    [Fact]
    public async Task Set_scope_requires_scope_text_and_moves_to_collect()
    {
        using var fixture = new AgentFixture();
        var started = await fixture.CallAsync("start_assessment", """{"framework":"nis2"}""");
        var assessmentId = Text(started["assessment_id"]);

        var error = await Assert.ThrowsAsync<AgentException>(() => fixture.CallAsync(
            "set_scope",
            $$"""{"assessmentId":"{{assessmentId}}","scope":"   "}"""));

        Assert.Equal("scope_required", error.Code);
        Assert.Equal("Describe the systems, locations, and period in scope.", error.Message);

        var updated = await fixture.CallAsync(
            "set_scope",
            $$"""{"assessmentId":"{{assessmentId}}","scope":"Berlin data centres.","periodFrom":"2025-01-01","periodTo":"2025-12-31"}""");

        Assert.Equal("collect", Text(updated["phase"]));
        Assert.Equal("Berlin data centres.", Text(updated["scope"]));
        Assert.Equal("2025-01-01", Text(updated["period"]!["from"]));
        Assert.Equal(2, updated["revision"]!.GetValue<int>());
        Assert.Equal("scope_set", Text(updated["events"]!.AsArray()[^1]!["type"]));
        Assert.Equal("Scope confirmed in English.", Text(updated["events"]!.AsArray()[^1]!["message"]));
    }

    [Fact]
    public async Task State_returns_progress_blockers_and_next_actions()
    {
        using var fixture = new AgentFixture();
        var started = await StartAsync(fixture);

        var state = await fixture.CallAsync(
            "get_assessment_state",
            $$"""{"assessmentId":"{{Text(started["assessment_id"])}}"}""");

        Assert.Equal("collect", Text(state["phase"]));
        Assert.Equal(5, state["progress"]!["total"]!.GetValue<int>());
        Assert.Equal("get_requirement", Text(state["next_actions"]![0]!["tool"]));
        Assert.Equal("en", Text(state["language_policy"]!["publishLanguage"]));
        Assert.Single(state["events"]!.AsArray());
    }

    [Fact]
    public async Task Detail_lists_items_with_source_theme_and_content_status()
    {
        using var fixture = new AgentFixture();
        var started = await StartAsync(fixture);

        var detail = await fixture.CallAsync(
            "get_assessment_state",
            $$"""{"assessmentId":"{{Text(started["assessment_id"])}}"}""");
        var board = await fixture.Agent.DetailAsync(
            (await fixture.OrganizationAsync()).Id,
            Text(started["assessment_id"]));

        Assert.Equal(5, board["total"]!.GetValue<int>());
        Assert.Equal(5, board["items"]!.AsArray().Count);
        var item = board["items"]![0]!;
        Assert.Equal("req-nis2-risk", Text(item["requirement_id"]));
        Assert.Equal("src-nis2-test", Text(item["sourceId"]));
        Assert.Equal("governance", Text(item["theme"]));
        Assert.Equal("extracted", Text(item["contentStatus"]));
        Assert.Equal("open", Text(item["status"]));
        Assert.Empty(item["evidence"]!.AsArray());
        Assert.Null(item["conclusion"]);
        Assert.Null(item["completed_at"]);
        Assert.Equal("collect", Text(detail["phase"]));
    }

    [Fact]
    public async Task Assessments_are_isolated_by_tenant()
    {
        using var fixture = new AgentFixture();
        var started = await StartAsync(fixture);
        var other = await fixture.OtherOrganizationAsync();

        var error = await Assert.ThrowsAsync<AgentException>(() => fixture.CallAsync(
            "get_assessment_state",
            $$"""{"assessmentId":"{{Text(started["assessment_id"])}}"}""",
            other));

        Assert.Equal("not_found", error.Code);
        Assert.Equal("Assessment not found for this tenant.", error.Message);
        Assert.Empty(await fixture.Agent.ListSummariesAsync(other.Id));
    }

    [Fact]
    public async Task List_orders_assessments_by_newest_update()
    {
        using var fixture = new AgentFixture();
        var first = await StartAsync(fixture);
        fixture.Time.Advance(TimeSpan.FromMinutes(5));
        var second = await fixture.CallAsync(
            "start_assessment",
            """{"framework":"iso27001","scope":"AI systems."}""");

        var list = await fixture.Agent.ListSummariesAsync((await fixture.OrganizationAsync()).Id);

        Assert.Equal(2, list.Count);
        Assert.Equal(Text(second["assessment_id"]), Text(list[0]!["assessment_id"]));
        Assert.Equal(Text(first["assessment_id"]), Text(list[1]!["assessment_id"]));
        Assert.Equal(1, list[0]!["progress"]!["total"]!.GetValue<int>());
    }

    [Fact]
    public async Task List_assessments_paginates_with_page_info()
    {
        using var fixture = new AgentFixture();
        for (var index = 0; index < 3; index++)
        {
            await StartAsync(fixture);
            fixture.Time.Advance(TimeSpan.FromMinutes(1));
        }

        var page = await fixture.CallAsync("list_assessments", """{"page":2,"pageSize":2}""");

        Assert.Equal(3, page["total"]!.GetValue<int>());
        Assert.Equal(2, page["page"]!.GetValue<int>());
        Assert.Equal(2, page["pageSize"]!.GetValue<int>());
        Assert.Single(page["assessments"]!.AsArray());
        Assert.False(page["page_info"]!["has_next_page"]!.GetValue<bool>());
        Assert.True(page["page_info"]!["has_previous_page"]!.GetValue<bool>());
        Assert.Equal(1, page["page_info"]!["previous_page"]!.GetValue<int>());
        Assert.Equal("start_assessment", Text(page["next_actions"]![0]!["tool"]));
    }

    [Fact]
    public async Task Brief_returns_five_prioritized_requirements()
    {
        using var fixture = new AgentFixture();
        var started = await StartAsync(fixture);

        var brief = await fixture.CallAsync(
            "get_brief",
            $$"""{"assessmentId":"{{Text(started["assessment_id"])}}"}""");

        Assert.Equal(5, brief["brief"]!.AsArray().Count);
        var first = brief["brief"]![0]!;
        Assert.Equal("req-nis2-risk", Text(first["requirementId"]));
        Assert.Equal("submit_evidence", Text(first["tool"]));
        Assert.Equal(0, first["evidenceCount"]!.GetValue<int>());
        Assert.Contains("How does the organization meet Art. 21(2)(a)", Text(first["question"]));
        Assert.Equal("get_requirement", Text(brief["next_actions"]![0]!["tool"]));
        Assert.Equal("req-nis2-risk", Text(brief["next_actions"]![0]!["arguments"]!["requirementId"]));
    }

    [Fact]
    public async Task List_requirements_filters_by_status_and_query()
    {
        using var fixture = new AgentFixture();
        var started = await StartAsync(fixture);
        var assessmentId = Text(started["assessment_id"]);

        var byStatus = await fixture.CallAsync(
            "list_requirements",
            $$"""{"assessmentId":"{{assessmentId}}","status":"open","pageSize":2}""");
        var byQuery = await fixture.CallAsync(
            "list_requirements",
            $$"""{"assessmentId":"{{assessmentId}}","query":"cryptography"}""");

        Assert.Equal(5, byStatus["total"]!.GetValue<int>());
        Assert.Equal(2, byStatus["items"]!.AsArray().Count);
        Assert.Equal("open", Text(byStatus["filters"]!["status"]));
        Assert.True(byStatus["page_info"]!["has_next_page"]!.GetValue<bool>());
        Assert.Equal(1, byQuery["total"]!.GetValue<int>());
        Assert.Equal("req-nis2-crypto", Text(byQuery["items"]![0]!["requirement_id"]));
    }

    [Fact]
    public async Task Progress_groups_by_theme_and_lists_remaining_requirements()
    {
        using var fixture = new AgentFixture();
        var started = await StartAsync(fixture);

        var progress = await fixture.CallAsync(
            "get_progress",
            $$"""{"assessmentId":"{{Text(started["assessment_id"])}}"}""");

        Assert.Equal(5, progress["progress"]!["total"]!.GetValue<int>());
        Assert.Equal(5, progress["by_status"]!["open"]!.GetValue<int>());
        Assert.Equal(0, progress["by_status"]!["completed"]!.GetValue<int>());
        Assert.Equal(5, progress["remaining"]!.AsArray().Count);
        var governing = progress["by_theme"]!.AsArray().Single(node => Text(node!["theme"]) == "governance")!;
        Assert.Equal(1, governing["total"]!.GetValue<int>());
        Assert.Equal(0, governing["percent"]!.GetValue<int>());
        Assert.Equal(
            new[] { "governance", "operations", "people", "supply_chain" },
            progress["by_theme"]!.AsArray().Select(node => Text(node!["theme"])).ToArray());
    }

    [Fact]
    public async Task Requirement_returns_guidance_and_the_next_tool()
    {
        using var fixture = new AgentFixture();
        var started = await StartAsync(fixture);

        var requirement = await fixture.CallAsync(
            "get_requirement",
            $$"""{"assessmentId":"{{Text(started["assessment_id"])}}","requirementId":"req-nis2-supply"}""");

        Assert.Equal("req-nis2-supply", Text(requirement["requirement"]!["requirement_id"]));
        Assert.Equal("supply_chain", Text(requirement["requirement"]!["theme"]));
        Assert.True(requirement["guidance"]!["evidenceRequired"]!.GetValue<bool>());
        Assert.Equal("submit_evidence", Text(requirement["next_actions"]![0]!["tool"]));
        Assert.Equal("Ask for the evidence, then call submit_evidence.", Text(requirement["guidance"]!["next"]));
    }

    [Fact]
    public async Task Unknown_requirements_report_the_requirement_id()
    {
        using var fixture = new AgentFixture();
        var started = await StartAsync(fixture);

        var error = await Assert.ThrowsAsync<AgentException>(() => fixture.CallAsync(
            "get_requirement",
            $$"""{"assessmentId":"{{Text(started["assessment_id"])}}","requirementId":"req-nope"}"""));

        Assert.Equal("requirement_not_found", error.Code);
        Assert.Equal("Requirement req-nope is not in this assessment.", error.Message);
    }

    [Fact]
    public async Task Submit_evidence_records_the_node_hash()
    {
        using var fixture = new AgentFixture();
        var started = await StartAsync(fixture);
        var assessmentId = Text(started["assessment_id"]);

        var submitted = await fixture.CallAsync(
            "submit_evidence",
            $$"""
            {"assessmentId":"{{assessmentId}}","requirementId":"req-nis2-risk","title":"Risk register",
             "type":"document","source":"SharePoint","summary":"The risk register is approved annually.",
             "citation":"https://sharepoint.example/risk","collectedAt":"2026-10-30T12:00:00.000Z"}
            """);

        var evidence = submitted["evidence"]!;
        var expected = "sha256:" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
            $"{assessmentId}:req-nis2-risk:Risk register:The risk register is approved annually.:2026-10-30T12:00:00.000Z"))).ToLowerInvariant();

        Assert.StartsWith("ev-", Text(evidence["id"]));
        Assert.Equal("Risk register", Text(evidence["title"]));
        Assert.Equal("document", Text(evidence["type"]));
        Assert.Equal("SharePoint", Text(evidence["source"]));
        Assert.Equal("https://sharepoint.example/risk", Text(evidence["citation"]));
        Assert.Equal("2026-10-30T12:00:00.000Z", Text(evidence["collectedAt"]));
        Assert.Equal(expected, Text(evidence["hash"]));
        Assert.Equal("evidence_collected", Text(submitted["requirement"]!["status"]));
        Assert.Equal(1, submitted["requirement"]!["evidence_count"]!.GetValue<int>());
        Assert.Equal(1, submitted["progress"]!["evidence_collected"]!.GetValue<int>());
        Assert.Equal("complete_requirement", Text(submitted["next_actions"]![0]!["tool"]));
        Assert.Equal(2, submitted["revision"]!.GetValue<int>());
        Assert.Equal("evidence_submitted", Text(submitted["events"]!.AsArray()[^1]!["type"]));
        Assert.Equal("Art. 21(2)(a): evidence submitted.", Text(submitted["events"]!.AsArray()[^1]!["message"]));
    }

    [Fact]
    public async Task Submit_evidence_requires_a_scope()
    {
        using var fixture = new AgentFixture();
        var started = await fixture.CallAsync("start_assessment", """{"framework":"nis2"}""");

        var error = await Assert.ThrowsAsync<AgentException>(() => fixture.CallAsync(
            "submit_evidence",
            $$"""
            {"assessmentId":"{{Text(started["assessment_id"])}}","requirementId":"req-nis2-risk",
             "title":"Risk register","source":"SharePoint","summary":"Approved."}
            """));

        Assert.Equal("scope_required", error.Code);
        Assert.Equal("Confirm the assessment scope first with set_scope.", error.Message);
    }

    [Theory]
    [InlineData("", "SharePoint", "Approved.", "Give the evidence a short English title.")]
    [InlineData("Risk", " ", "Approved.", "Name where the evidence comes from.")]
    [InlineData("Risk", "SharePoint", "", "Summarize the evidence in English, with the result it shows.")]
    public async Task Submit_evidence_requires_title_source_and_summary(
        string title,
        string source,
        string summary,
        string message)
    {
        using var fixture = new AgentFixture();
        var started = await StartAsync(fixture);
        var args = new JsonObject
        {
            ["assessmentId"] = Text(started["assessment_id"]),
            ["requirementId"] = "req-nis2-risk",
            ["title"] = title,
            ["source"] = source,
            ["summary"] = summary,
        };

        var error = await Assert.ThrowsAsync<AgentException>(
            () => fixture.CallAsync("submit_evidence", args));

        Assert.Equal("field_required", error.Code);
        Assert.Equal(message, error.Message);
    }

    [Fact]
    public async Task Submit_evidence_rejects_unknown_types_and_timestamps()
    {
        using var fixture = new AgentFixture();
        var started = await StartAsync(fixture);
        var assessmentId = Text(started["assessment_id"]);

        var type = await Assert.ThrowsAsync<AgentException>(() => fixture.CallAsync(
            "submit_evidence",
            $$"""
            {"assessmentId":"{{assessmentId}}","requirementId":"req-nis2-risk","title":"Risk",
             "source":"SharePoint","summary":"Approved.","type":"screenshot_old"}
            """));
        var timestamp = await Assert.ThrowsAsync<AgentException>(() => fixture.CallAsync(
            "submit_evidence",
            $$"""
            {"assessmentId":"{{assessmentId}}","requirementId":"req-nis2-risk","title":"Risk",
             "source":"SharePoint","summary":"Approved.","collectedAt":"last tuesday"}
            """));

        Assert.Equal("invalid_evidence_type", type.Code);
        Assert.Equal(
            "Evidence type must be one of: document, screenshot, log_export, api_report, attestation.",
            type.Message);
        Assert.Equal("invalid_date", timestamp.Code);
    }

    [Fact]
    public async Task Submit_evidence_rejects_a_completed_requirement()
    {
        using var fixture = new AgentFixture();
        var assessmentId = await CompleteFirstAsync(fixture);

        var error = await Assert.ThrowsAsync<AgentException>(() => fixture.CallAsync(
            "submit_evidence",
            $$"""
            {"assessmentId":"{{assessmentId}}","requirementId":"req-nis2-risk","title":"Risk",
             "source":"SharePoint","summary":"Approved."}
            """));

        Assert.Equal("already_complete", error.Code);
        Assert.Equal("This requirement is already complete.", error.Message);
    }

    [Fact]
    public async Task Complete_requires_evidence_and_an_english_conclusion()
    {
        using var fixture = new AgentFixture();
        var started = await StartAsync(fixture);
        var assessmentId = Text(started["assessment_id"]);

        var missing = await Assert.ThrowsAsync<AgentException>(() => fixture.CallAsync(
            "complete_requirement",
            $$"""{"assessmentId":"{{assessmentId}}","requirementId":"req-nis2-risk","conclusion":"Done."}"""));

        await SubmitAsync(fixture, assessmentId, "req-nis2-risk");

        var language = await Assert.ThrowsAsync<AgentException>(() => fixture.CallAsync(
            "complete_requirement",
            $$"""{"assessmentId":"{{assessmentId}}","requirementId":"req-nis2-risk","conclusion":"Fertig.","language":"de"}"""));

        Assert.Equal("evidence_required", missing.Code);
        Assert.Equal(
            "Acceptance requires at least one piece of evidence. Call submit_evidence first.",
            missing.Message);
        Assert.Equal("language_required", language.Code);
        Assert.Equal(
            "Conclusions are published in English. Rewrite the conclusion in English.",
            language.Message);
    }

    [Fact]
    public async Task Complete_moves_the_assessment_to_review_when_every_requirement_is_closed()
    {
        using var fixture = new AgentFixture();
        var started = await fixture.CallAsync(
            "start_assessment",
            """{"framework":"iso27001","scope":"AI systems."}""");
        var assessmentId = Text(started["assessment_id"]);
        await SubmitAsync(fixture, assessmentId, "req-iso-a5");

        var completed = await fixture.CallAsync(
            "complete_requirement",
            $$"""{"assessmentId":"{{assessmentId}}","requirementId":"req-iso-a5","conclusion":"The policy is approved.","language":"EN"}""");

        Assert.Equal("completed", Text(completed["requirement"]!["status"]));
        Assert.Equal("2026-10-30T12:00:00.000Z", Text(completed["requirement"]!["completed_at"]));
        Assert.Equal("review", Text(completed["phase"]));
        Assert.Equal(100, completed["progress"]!["percent"]!.GetValue<int>());
        Assert.Equal("ready_for_review", Text(completed["events"]!.AsArray()[^1]!["type"]));
        Assert.Equal("review_assessment", Text(completed["next_actions"]![0]!["tool"]));
    }

    [Fact]
    public async Task Mark_not_applicable_needs_a_reason_and_counts_as_closed()
    {
        using var fixture = new AgentFixture();
        var started = await StartAsync(fixture);
        var assessmentId = Text(started["assessment_id"]);

        var missing = await Assert.ThrowsAsync<AgentException>(() => fixture.CallAsync(
            "mark_not_applicable",
            $$"""{"assessmentId":"{{assessmentId}}","requirementId":"req-nis2-risk","reason":"  "}"""));

        var marked = await fixture.CallAsync(
            "mark_not_applicable",
            $$"""{"assessmentId":"{{assessmentId}}","requirementId":"req-nis2-risk","reason":"No suppliers in scope."}""");

        Assert.Equal("field_required", missing.Code);
        Assert.Equal("not_applicable", Text(marked["requirement"]!["status"]));
        Assert.Equal("No suppliers in scope.", Text(marked["requirement"]!["conclusion"]));
        Assert.Equal(1, marked["progress"]!["not_applicable"]!.GetValue<int>());
        Assert.Equal(20, marked["progress"]!["percent"]!.GetValue<int>());
        Assert.Equal("collect", Text(marked["phase"]));
    }

    [Fact]
    public async Task Review_reports_every_open_requirement()
    {
        using var fixture = new AgentFixture();
        var started = await StartAsync(fixture);

        var error = await Assert.ThrowsAsync<AgentException>(() => fixture.CallAsync(
            "review_assessment",
            $$"""{"assessmentId":"{{Text(started["assessment_id"])}}"}"""));

        Assert.Equal("requirements_open", error.Code);
        Assert.Equal("5 requirements still need evidence or a conclusion.", error.Message);
        var details = Assert.IsType<JsonArray>(error.Details);
        Assert.Equal(5, details.Count);
        Assert.Equal("req-nis2-risk", Text(details[0]!["requirementId"]));
    }

    [Fact]
    public async Task Review_moves_the_assessment_to_export()
    {
        using var fixture = new AgentFixture();
        var assessmentId = await CloseEveryRequirementAsync(fixture);

        var review = await fixture.CallAsync(
            "review_assessment",
            $$"""{"assessmentId":"{{assessmentId}}"}""");

        Assert.Equal("export", Text(review["phase"]));
        Assert.Equal(100, review["summary"]!["percent"]!.GetValue<int>());
        Assert.Equal(
            "Every requirement has evidence or a not-applicable reason. The package is ready to export.",
            Text(review["summary"]!["message"]));
        Assert.Equal("2026-10-30T12:00:00.000Z", Text(review["summary"]!["reviewed_at"]));
        Assert.Equal("export_assessment", Text(review["next_actions"]![0]!["tool"]));
    }

    [Fact]
    public async Task Export_requires_a_review()
    {
        using var fixture = new AgentFixture();
        var started = await StartAsync(fixture);

        var error = await Assert.ThrowsAsync<AgentException>(() => fixture.CallAsync(
            "export_assessment",
            $$"""{"assessmentId":"{{Text(started["assessment_id"])}}"}"""));

        Assert.Equal("review_required", error.Code);
        Assert.Equal("Review the assessment before exporting it.", error.Message);
    }

    [Fact]
    public async Task Export_returns_the_node_package_format()
    {
        using var fixture = new AgentFixture();
        var assessmentId = await CloseEveryRequirementAsync(fixture);
        await fixture.CallAsync("review_assessment", $$"""{"assessmentId":"{{assessmentId}}"}""");

        var exported = await fixture.CallAsync(
            "export_assessment",
            $$"""{"assessmentId":"{{assessmentId}}"}""");

        var manifest = exported["manifest"]!;
        Assert.Equal("comply.agent-package/v1", Text(manifest["format"]));
        Assert.Equal("2026-10-30T12:00:00.000Z", Text(manifest["generatedAt"]));
        Assert.Equal("en", Text(manifest["language"]));
        Assert.Equal("NIS2 assessment", Text(manifest["assessment"]!["name"]));
        Assert.Equal(5, manifest["counts"]!["total"]!.GetValue<int>());
        Assert.Equal("complete", Text(exported["phase"]));

        var requirements = exported["requirements"]!.AsArray();
        Assert.Equal(5, requirements.Count);
        var first = requirements[0]!;
        Assert.Equal("Art. 21(2)(a)", Text(first["ref"]));
        Assert.Equal("completed", Text(first["status"]));
        Assert.Equal("The policy is approved.", Text(first["conclusion"]));
        var evidence = first["evidence"]![0]!;
        Assert.Equal("Risk register", Text(evidence["title"]));
        Assert.Equal("https://sharepoint.example/risk", Text(evidence["citation"]));
        Assert.StartsWith("sha256:", Text(evidence["hash"]));

        var payload = new JsonObject
        {
            ["manifest"] = manifest.DeepClone(),
            ["requirements"] = exported["requirements"]!.DeepClone(),
        };
        ((JsonObject)payload["manifest"]!).Remove("sha256");
        var digest = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
            payload.ToJsonString(new System.Text.Json.JsonSerializerOptions
            {
                Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
            })))).ToLowerInvariant();

        Assert.Equal(digest, Text(manifest["sha256"]));
        // Pinned from a replay of apps/api-node/lib/agent.mjs over the same fixture data.
        Assert.Equal(
            "65cb0731c4162c15101b932155f6f215d1db893e40f7d98f70f1c8ce3453b89d",
            Text(manifest["sha256"]));
        Assert.Equal("start_assessment", Text(exported["next_actions"]![0]!["tool"]));
    }

    [Fact]
    public async Task The_guide_matches_the_node_workflow()
    {
        using var fixture = new AgentFixture();

        var guide = await fixture.CallAsync("get_agent_guide", "{}");

        Assert.Equal(6, guide["workflow"]!.AsArray().Count);
        Assert.Equal("intent", Text(guide["workflow"]![0]!["step"]));
        Assert.Equal("start_assessment", Text(guide["workflow"]![0]!["tool"]));
        Assert.Equal(
            new[] { "scope", "collect", "review", "export", "complete" },
            guide["phases"]!.AsArray().Select(node => Text(node)).ToArray());
        Assert.Equal("any", Text(guide["language_policy"]!["userLanguage"]));
        Assert.Equal("en", Text(guide["language_policy"]!["publishLanguage"]));
        Assert.Equal(7, guide["rules"]!.AsArray().Count);
        Assert.StartsWith("Start a NIS2 assessment for the systems I name.", Text(guide["start_prompt"]));
    }

    [Fact]
    public async Task Unknown_tools_are_rejected()
    {
        using var fixture = new AgentFixture();

        var error = await Assert.ThrowsAsync<AgentException>(
            () => fixture.CallAsync("delete_everything", "{}"));

        Assert.Equal("unknown_tool", error.Code);
        Assert.Equal("Unknown tool: delete_everything.", error.Message);
    }

    private static async Task<string> CompleteFirstAsync(AgentFixture fixture)
    {
        var started = await StartAsync(fixture);
        var assessmentId = Text(started["assessment_id"]);
        await SubmitAsync(fixture, assessmentId, "req-nis2-risk");
        await fixture.CallAsync(
            "complete_requirement",
            $$"""{"assessmentId":"{{assessmentId}}","requirementId":"req-nis2-risk","conclusion":"The policy is approved."}""");
        return assessmentId;
    }

    private static async Task<string> CloseEveryRequirementAsync(AgentFixture fixture)
    {
        var started = await StartAsync(fixture);
        var assessmentId = Text(started["assessment_id"]);
        await SubmitAsync(fixture, assessmentId, "req-nis2-risk");
        await fixture.CallAsync(
            "complete_requirement",
            $$"""{"assessmentId":"{{assessmentId}}","requirementId":"req-nis2-risk","conclusion":"The policy is approved."}""");

        foreach (var requirement in new[]
                 {
                     "req-nis2-incident", "req-nis2-supply", "req-nis2-training", "req-nis2-crypto",
                 })
        {
            await fixture.CallAsync(
                "mark_not_applicable",
                $$"""{"assessmentId":"{{assessmentId}}","requirementId":"{{requirement}}","reason":"Not applicable to this scope."}""");
        }

        return assessmentId;
    }

    private static Task<JsonObject> SubmitAsync(AgentFixture fixture, string assessmentId, string requirementId) =>
        fixture.CallAsync(
            "submit_evidence",
            $$"""
            {"assessmentId":"{{assessmentId}}","requirementId":"{{requirementId}}","title":"Risk register",
             "type":"document","source":"SharePoint","summary":"The risk register is approved annually.",
             "citation":"https://sharepoint.example/risk","collectedAt":"2026-10-30T12:00:00.000Z"}
            """);
}
