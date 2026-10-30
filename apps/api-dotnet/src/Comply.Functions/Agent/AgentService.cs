using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Comply.Functions.Data;
using Comply.Functions.Models;
using Comply.Functions.Services;
using Microsoft.Extensions.Logging;

namespace Comply.Functions.Agent;

/// <summary>
/// The guided assessment domain, ported from <c>apps/api-node/lib/agent.mjs</c>. Every tool
/// method is tenant scoped, persists immediately, and returns the same JSON object the Node agent
/// returns (including property order, which the export manifest digest depends on).
/// </summary>
public sealed partial class AgentService
{
    public static readonly IReadOnlyList<string> Frameworks = ["nis2", "iso27001", "ai-act", "soc2"];

    public static readonly IReadOnlyList<string> EvidenceTypes =
        ["document", "screenshot", "log_export", "api_report", "attestation"];

    public static readonly IReadOnlyList<string> RequirementStatusesAll =
    [
        Data.RequirementStatuses.Open,
        Data.RequirementStatuses.EvidenceCollected,
        Data.RequirementStatuses.Completed,
        Data.RequirementStatuses.NotApplicable,
    ];

    private static readonly JsonSerializerOptions CompactJson = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    private readonly IComplyStore _comply;
    private readonly LibraryStore _store;
    private readonly TimeProvider _time;
    private readonly Func<string> _idFactory;
    private readonly ILogger<AgentService>? _logger;

    public AgentService(
        IComplyStore comply,
        LibraryStore store,
        TimeProvider time,
        Func<string>? idFactory = null,
        ILogger<AgentService>? logger = null)
    {
        _comply = comply;
        _store = store;
        _time = time;
        _idFactory = idFactory ?? (() => Guid.NewGuid().ToString("N"));
        _logger = logger;
    }

    public async Task<JsonObject> CallAsync(
        string organizationId,
        string tool,
        ToolArguments args,
        CancellationToken cancellationToken = default)
    {
        switch (tool)
        {
            case "get_agent_guide":
                return AgentJson.Guide();
            case "start_assessment":
                return await StartAsync(organizationId, args, cancellationToken);
            case "list_assessments":
                return await ListAssessmentsAsync(organizationId, args, cancellationToken);
            case "get_assessment_state":
                return AgentJson.State(await LoadViewAsync(organizationId, args.Text("assessmentId"), cancellationToken));
            case "set_scope":
                return await SetScopeAsync(organizationId, args, cancellationToken);
            case "get_brief":
                return await BriefAsync(organizationId, args, cancellationToken);
            case "list_requirements":
                return await ListRequirementsAsync(organizationId, args, cancellationToken);
            case "search_requirements":
                return await SearchRequirementsAsync(organizationId, args, cancellationToken);
            case "get_requirement":
                return await RequirementAsync(organizationId, args, cancellationToken);
            case "get_progress":
                return await ProgressAsync(organizationId, args, cancellationToken);
            case "submit_evidence":
                return await SubmitEvidenceAsync(organizationId, args, cancellationToken);
            case "complete_requirement":
                return await CompleteRequirementAsync(organizationId, args, cancellationToken);
            case "mark_not_applicable":
                return await MarkNotApplicableAsync(organizationId, args, cancellationToken);
            case "review_assessment":
                return await ReviewAsync(organizationId, args, cancellationToken);
            case "export_assessment":
                return await ExportAsync(organizationId, args, cancellationToken);
            default:
                throw new AgentException($"Unknown tool: {tool}.", "unknown_tool");
        }
    }

    /// <summary>Board summaries, newest update first.</summary>
    public async Task<JsonArray> ListSummariesAsync(string organizationId, CancellationToken cancellationToken = default)
    {
        var rows = await QuerySummariesAsync(organizationId, cancellationToken);
        return Summaries(rows);
    }

    /// <summary>Board summaries with the optional page/pageSize query the HTTP list accepts.</summary>
    public async Task<(JsonArray Items, int Total)> ListSummariesPageAsync(
        string organizationId,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default)
    {
        var rows = await QuerySummariesAsync(organizationId, cancellationToken);
        return (Summaries(Slice(rows, page, pageSize)), rows.Count);
    }

    public async Task<JsonObject> DetailAsync(
        string organizationId,
        string? assessmentId,
        CancellationToken cancellationToken = default) =>
        AgentJson.Detail(await LoadViewAsync(organizationId, assessmentId, cancellationToken));

    public async Task<JsonObject> StartAsync(
        string organizationId,
        ToolArguments args,
        CancellationToken cancellationToken = default)
    {
        var framework = args.Text("framework") ?? "";
        if (!Frameworks.Contains(framework, StringComparer.Ordinal))
        {
            throw new AgentException(
                $"Choose a framework: {string.Join(", ", Frameworks)}.",
                "invalid_framework");
        }

        var library = await _store.GetAsync(cancellationToken);
        var pool = library.Requirements
            .Where(requirement => string.Equals(requirement.FrameworkId, framework, StringComparison.Ordinal))
            .DistinctBy(requirement => requirement.Id ?? "")
            .ToList();

        if (pool.Count == 0)
        {
            throw new AgentException(
                $"No requirements are available for {framework}. Refresh the sources first.",
                "empty_library");
        }

        // Managed content is delivered as a full framework checklist; an explicit limit remains
        // available for a focused sample.
        var limit = args.Contains("limit")
            ? AgentText.Clamp(args.Number("limit"), 1, pool.Count)
            : pool.Count;

        var contentStatus = pool.All(requirement => requirement.Status == ContentStatuses.Published)
            ? ContentStatuses.Published
            : ContentStatuses.Extracted;

        var now = _time.GetUtcNow();
        var (periodFrom, periodTo) = PeriodOf(args, now);
        var scope = (args.Text("scope") ?? "").Trim();
        var name = (args.Text("name") ?? $"{AgentJson.FrameworkLabel(framework)} assessment").Trim();

        var assessment = new Assessment
        {
            Id = $"asm-{IdSuffix()}",
            OrganizationId = organizationId,
            Framework = framework,
            Name = name,
            Scope = scope,
            PeriodFrom = Date(periodFrom),
            PeriodTo = Date(periodTo),
            Phase = scope.Length > 0 ? AssessmentPhases.Collect : AssessmentPhases.Scope,
            Revision = 1,
            ContentStatus = contentStatus,
            Language = "en",
            CreatedAt = now,
            UpdatedAt = now,
        };

        for (var index = 0; index < limit; index++)
        {
            var requirement = pool[index];
            assessment.Requirements.Add(new AssessmentRequirement
            {
                Id = $"ar-{Guid.NewGuid():N}",
                AssessmentId = assessment.Id,
                LibraryRequirementId = requirement.Id ?? "",
                Ref = requirement.Ref ?? "",
                Title = requirement.Title ?? "",
                Description = requirement.Text,
                SourceId = requirement.SourceId,
                Theme = requirement.Theme,
                Status = Data.RequirementStatuses.Open,
                Position = index,
            });
        }

        assessment.Events.Add(new AssessmentEvent
        {
            Id = $"ase-{Guid.NewGuid():N}",
            AssessmentId = assessment.Id,
            Revision = 1,
            Type = "created",
            Message = $"Assessment created from {pool.Count} available requirements.",
            CreatedAt = now,
        });

        await _comply.AddAssessmentAsync(assessment, cancellationToken);
        return AgentJson.State(View(assessment));
    }

    public async Task<JsonObject> SetScopeAsync(
        string organizationId,
        ToolArguments args,
        CancellationToken cancellationToken = default)
    {
        var assessment = await LoadAsync(organizationId, args.Text("assessmentId"), cancellationToken);

        var scope = (args.Text("scope") ?? "").Trim();
        if (scope.Length == 0)
        {
            throw new AgentException("Describe the systems, locations, and period in scope.", "scope_required");
        }

        var (periodFrom, periodTo) = PeriodOf(args, assessment.CreatedAt);
        assessment.Scope = scope;
        assessment.PeriodFrom = Date(periodFrom);
        assessment.PeriodTo = Date(periodTo);
        if (assessment.Phase == AssessmentPhases.Scope) assessment.Phase = AssessmentPhases.Collect;
        Touch(assessment, "scope_set", "Scope confirmed in English.", _time.GetUtcNow());
        await _comply.SaveAssessmentAsync(assessment, cancellationToken);
        return AgentJson.State(View(assessment));
    }

    public async Task<JsonObject> BriefAsync(
        string organizationId,
        ToolArguments args,
        CancellationToken cancellationToken = default)
    {
        var view = await LoadViewAsync(organizationId, args.Text("assessmentId"), cancellationToken);
        var open = view.Items.Where(item => AgentJson.IsOpen(item.Status)).ToList();

        var brief = new JsonArray();
        foreach (var item in open.Take(5))
        {
            brief.Add(new JsonObject
            {
                ["requirementId"] = item.Id,
                ["ref"] = item.Ref,
                ["title"] = item.Title,
                ["description"] = item.Description is null ? null : JsonValue.Create(item.Description),
                ["status"] = item.Status,
                ["question"] = AgentJson.QuestionFor(item),
                ["evidenceCount"] = item.Evidence.Count,
                ["tool"] = item.Status == Data.RequirementStatuses.EvidenceCollected
                    ? "complete_requirement"
                    : "submit_evidence",
            });
        }

        var response = AgentJson.Base(view);
        response["brief"] = brief;
        response["progress"] = AgentJson.Progress(view);
        response["blocked_by"] = view.Phase == AssessmentPhases.Scope ? new JsonArray("scope") : [];
        response["next_actions"] = view.Phase != AssessmentPhases.Scope && brief.Count > 0
            ?
            [
                AgentJson.Action(
                    "get_requirement",
                    "Open the first prioritized requirement and ask the user about the evidence.",
                    new JsonObject
                    {
                        ["assessmentId"] = view.Id,
                        ["requirementId"] = open[0].Id,
                    }),
            ]
            : AgentJson.NextForPhase(view);
        response["language_policy"] = AgentJson.LanguagePolicy();
        return response;
    }

    public async Task<JsonObject> ListRequirementsAsync(
        string organizationId,
        ToolArguments args,
        CancellationToken cancellationToken = default)
    {
        var view = await LoadViewAsync(organizationId, args.Text("assessmentId"), cancellationToken);

        var status = args.Text("status");
        if (string.IsNullOrEmpty(status)) status = null;
        var query = (args.Text("query") ?? "").Trim().ToLowerInvariant();
        var page = PageNumber(args.ParseInt("page"));
        var pageSize = PageSize(args.ParseInt("pageSize"));

        var filtered = view.Items
            .Where(item => status is null || item.Status == status)
            .Where(item => query.Length == 0
                || new[] { item.Ref, item.Title, item.Description, item.Conclusion }
                    .Any(value => value is not null && value.ToLowerInvariant().Contains(query, StringComparison.Ordinal)))
            .ToList();

        var items = new JsonArray();
        foreach (var item in Slice(filtered, page, pageSize))
        {
            items.Add(AgentJson.RequirementSummary(item));
        }

        var response = AgentJson.Base(view);
        response["items"] = items;
        response["total"] = filtered.Count;
        response["page"] = page;
        response["pageSize"] = pageSize;
        response["page_info"] = AgentJson.PageInfo(filtered.Count, page, pageSize);
        response["filters"] = new JsonObject
        {
            ["status"] = status,
            ["query"] = query.Length == 0 ? null : JsonValue.Create(query),
        };
        response["progress"] = AgentJson.Progress(view);
        response["next_actions"] = AgentJson.NextForPhase(view);
        response["language_policy"] = AgentJson.LanguagePolicy();
        return response;
    }

    public async Task<JsonObject> SearchRequirementsAsync(
        string organizationId,
        ToolArguments args,
        CancellationToken cancellationToken = default)
    {
        var view = await LoadViewAsync(organizationId, args.Text("assessmentId"), cancellationToken);

        var query = (args.Text("query") ?? "").Trim();
        var similarTo = (args.Text("similarTo") ?? "").Trim();
        if (query.Length > 0 && similarTo.Length > 0)
        {
            throw new AgentException("Provide query or similarTo, not both.", "invalid_search");
        }

        if (query.Length == 0 && similarTo.Length == 0)
        {
            throw new AgentException(
                "Provide query or similarTo to search the checklist.",
                "query_required");
        }

        ItemView? target = null;
        var text = query;
        if (similarTo.Length > 0)
        {
            target = RequireItem(view, similarTo);
            text = string.Join(
                " ",
                new[] { target.Ref, target.Title, target.Description, target.Conclusion }
                    .Where(value => !string.IsNullOrEmpty(value)));
        }

        var queryTerms = AgentText.Tokenize(text);
        if (queryTerms.Count == 0)
        {
            throw new AgentException(
                "Use at least one meaningful English term in the search.",
                "query_required");
        }

        var documents = view.Items
            .Select(item => new Document(
                item,
                AgentText.Tokenize(AgentText.SearchText(item.Ref, item.Title, item.Description, item.Conclusion))))
            .ToList();

        var documentFrequency = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var document in documents)
        {
            foreach (var term in document.Terms.Distinct(StringComparer.Ordinal))
            {
                documentFrequency[term] = documentFrequency.GetValueOrDefault(term) + 1;
            }
        }

        double Idf(string term) =>
            Math.Log((documents.Count + 1.0) / (documentFrequency.GetValueOrDefault(term) + 1.0)) + 1;

        var queryVector = AgentText.WeightedVector(queryTerms, Idf);

        var status = args.Text("status");
        if (!string.IsNullOrEmpty(status) && !RequirementStatusesAll.Contains(status, StringComparer.Ordinal))
        {
            throw new AgentException("Unknown requirement status.", "invalid_status");
        }

        var minScore = 0.05;
        if (args.Contains("minScore"))
        {
            minScore = args.Number("minScore") is { } provided && provided != 0
                ? Math.Min(1, Math.Max(0, provided))
                : 0;
        }

        var matches = new List<Match>();
        foreach (var document in documents)
        {
            var score = AgentText.Cosine(queryVector, AgentText.WeightedVector(document.Terms, Idf));
            var rounded = AgentText.JsRound(score * 1000) / 1000d;
            if (rounded < minScore) continue;
            if (target is not null && document.Item.Id == target.Id) continue;
            if (!string.IsNullOrEmpty(status) && document.Item.Status != status) continue;

            var terms = queryTerms
                .Distinct(StringComparer.Ordinal)
                .Where(term => document.Terms.Contains(term, StringComparer.Ordinal))
                .ToList();
            matches.Add(new Match(document.Item, rounded, terms));
        }

        matches.Sort((left, right) =>
        {
            var byScore = right.Score.CompareTo(left.Score);
            return byScore != 0 ? byScore : string.CompareOrdinal(left.Item.Ref, right.Item.Ref);
        });

        var page = PageNumber(args.ParseInt("page"));
        var pageSize = PageSize(args.ParseInt("pageSize"));

        var items = new JsonArray();
        foreach (var match in Slice(matches, page, pageSize))
        {
            var entry = AgentJson.RequirementSummary(match.Item);
            entry["score"] = match.Score;
            var terms = new JsonArray();
            foreach (var term in match.Terms.Take(5)) terms.Add(term);
            entry["matched_terms"] = terms;
            items.Add(entry);
        }

        var response = AgentJson.Base(view);
        response["query"] = query.Length == 0 ? null : JsonValue.Create(query);
        response["similar_to"] = similarTo.Length == 0 ? null : JsonValue.Create(similarTo);
        response["items"] = items;
        response["total"] = matches.Count;
        response["page"] = page;
        response["pageSize"] = pageSize;
        response["page_info"] = AgentJson.PageInfo(matches.Count, page, pageSize);
        response["progress"] = AgentJson.Progress(view);
        response["next_actions"] = AgentJson.NextForPhase(view);
        response["language_policy"] = AgentJson.LanguagePolicy();
        return response;
    }

    public async Task<JsonObject> ProgressAsync(
        string organizationId,
        ToolArguments args,
        CancellationToken cancellationToken = default)
    {
        var view = await LoadViewAsync(organizationId, args.Text("assessmentId"), cancellationToken);

        var themes = view.Items
            .GroupBy(item => string.IsNullOrEmpty(item.Theme) ? "unclassified" : item.Theme, StringComparer.Ordinal)
            .Select(group =>
            {
                var total = group.Count();
                var completed = group.Count(item => item.Status == Data.RequirementStatuses.Completed);
                var notApplicable = group.Count(item => item.Status == Data.RequirementStatuses.NotApplicable);
                return new JsonObject
                {
                    ["theme"] = group.Key,
                    ["total"] = total,
                    ["completed"] = completed,
                    ["not_applicable"] = notApplicable,
                    ["evidence_collected"] = group.Count(item => item.Status == Data.RequirementStatuses.EvidenceCollected),
                    ["open"] = group.Count(item => item.Status == Data.RequirementStatuses.Open),
                    ["percent"] = total == 0
                        ? 0
                        : AgentText.JsRound((double)(completed + notApplicable) / total * 100),
                };
            })
            .OrderBy(node => node["theme"]!.GetValue<string>(), StringComparer.Ordinal)
            .ToList();

        var byTheme = new JsonArray();
        foreach (var theme in themes) byTheme.Add(theme);

        var remaining = new JsonArray();
        foreach (var item in view.Items.Where(item => AgentJson.IsOpen(item.Status)).Take(5))
        {
            remaining.Add(new JsonObject
            {
                ["requirement_id"] = item.Id,
                ["ref"] = item.Ref,
                ["title"] = item.Title,
                ["status"] = item.Status,
                ["evidence_count"] = item.Evidence.Count,
            });
        }

        var response = AgentJson.Base(view);
        response["progress"] = AgentJson.Progress(view);
        response["by_status"] = new JsonObject
        {
            ["open"] = view.Items.Count(item => item.Status == Data.RequirementStatuses.Open),
            ["evidence_collected"] = view.Items.Count(item => item.Status == Data.RequirementStatuses.EvidenceCollected),
            ["completed"] = view.Items.Count(item => item.Status == Data.RequirementStatuses.Completed),
            ["not_applicable"] = view.Items.Count(item => item.Status == Data.RequirementStatuses.NotApplicable),
        };
        response["by_theme"] = byTheme;
        response["remaining"] = remaining;
        response["next_actions"] = AgentJson.NextForPhase(view);
        response["language_policy"] = AgentJson.LanguagePolicy();
        return response;
    }

    public async Task<JsonObject> RequirementAsync(
        string organizationId,
        ToolArguments args,
        CancellationToken cancellationToken = default)
    {
        var view = await LoadViewAsync(organizationId, args.Text("assessmentId"), cancellationToken);
        var item = RequireItem(view, args.Text("requirementId"));

        var response = AgentJson.Base(view);
        response["requirement"] = AgentJson.RequirementDetail(item, view.ContentStatus);
        response["guidance"] = new JsonObject
        {
            ["question"] = AgentJson.QuestionFor(item),
            ["language"] = "Ask in the user's language. Record the evidence summary in English.",
            ["evidenceRequired"] = true,
            ["next"] = item.Status == Data.RequirementStatuses.Completed
                ? "The requirement is complete. Open the next item from get_brief."
                : "Ask for the evidence, then call submit_evidence.",
        };
        response["progress"] = AgentJson.Progress(view);
        response["next_actions"] = AgentJson.NextForItem(view, item);
        response["language_policy"] = AgentJson.LanguagePolicy();
        return response;
    }

    public async Task<JsonObject> SubmitEvidenceAsync(
        string organizationId,
        ToolArguments args,
        CancellationToken cancellationToken = default)
    {
        var assessment = await LoadAsync(organizationId, args.Text("assessmentId"), cancellationToken);
        RequireScope(assessment);
        var item = RequireItem(assessment, args.Text("requirementId"));
        if (item.Status == Data.RequirementStatuses.Completed)
        {
            throw new AgentException("This requirement is already complete.", "already_complete");
        }

        var title = Required(args.Text("title"), "Give the evidence a short English title.");
        var source = Required(args.Text("source"), "Name where the evidence comes from.");
        var summary = Required(
            args.Text("summary"),
            "Summarize the evidence in English, with the result it shows.");

        var type = args.Text("type") ?? "document";
        if (!EvidenceTypes.Contains(type, StringComparer.Ordinal))
        {
            throw new AgentException(
                $"Evidence type must be one of: {string.Join(", ", EvidenceTypes)}.",
                "invalid_evidence_type");
        }

        var collectedAtRaw = args.Text("collectedAt") ?? AgentJson.Timestamp(_time.GetUtcNow());
        var collectedAt = ParseTimestamp(collectedAtRaw);
        var citation = (args.Text("citation") ?? "").Trim();

        var evidence = new Evidence
        {
            Id = $"ev-{IdSuffix()}",
            AssessmentRequirementId = item.Id,
            Title = title,
            Type = type,
            Source = source,
            Summary = summary,
            Citation = citation.Length == 0 ? null : citation,
            CreatedAt = collectedAt,
            Hash = EvidenceHash(assessment.Id, item.LibraryRequirementId, title, summary, collectedAtRaw),
        };

        item.Evidence.Add(evidence);
        item.Status = Data.RequirementStatuses.EvidenceCollected;
        Touch(assessment, "evidence_submitted", $"{item.Ref}: evidence submitted.", _time.GetUtcNow());
        await _comply.SaveAssessmentAsync(assessment, cancellationToken);

        var view = View(assessment);
        var response = AgentJson.Base(view);
        response["evidence"] = AgentJson.Evidence(View(evidence));
        response["requirement"] = AgentJson.RequirementSummary(
            view.Items.Single(entry => entry.Id == item.LibraryRequirementId));
        response["progress"] = AgentJson.Progress(view);
        response["next_actions"] = new JsonArray(
            AgentJson.Action(
                "complete_requirement",
                "Write the English conclusion and close this requirement.",
                new JsonObject
                {
                    ["assessmentId"] = view.Id,
                    ["requirementId"] = item.LibraryRequirementId,
                    ["conclusion"] = "One or two sentences in English, grounded in the evidence.",
                }),
            AgentJson.Action(
                "submit_evidence",
                "Add another artifact if the first one does not cover the full requirement.",
                new JsonObject
                {
                    ["assessmentId"] = view.Id,
                    ["requirementId"] = item.LibraryRequirementId,
                }));
        response["language_policy"] = AgentJson.LanguagePolicy();
        return response;
    }

    public async Task<JsonObject> CompleteRequirementAsync(
        string organizationId,
        ToolArguments args,
        CancellationToken cancellationToken = default)
    {
        var assessment = await LoadAsync(organizationId, args.Text("assessmentId"), cancellationToken);
        RequireScope(assessment);
        var item = RequireItem(assessment, args.Text("requirementId"));

        if (item.Evidence.Count == 0)
        {
            throw new AgentException(
                "Acceptance requires at least one piece of evidence. Call submit_evidence first.",
                "evidence_required");
        }

        var language = args.Text("language");
        if (!string.IsNullOrEmpty(language) && !string.Equals(language, "en", StringComparison.OrdinalIgnoreCase))
        {
            throw new AgentException(
                "Conclusions are published in English. Rewrite the conclusion in English.",
                "language_required");
        }

        var conclusion = Required(
            args.Text("conclusion"),
            "Write the conclusion in English, grounded in the evidence.");

        var now = _time.GetUtcNow();
        item.Conclusion = conclusion;
        item.Status = Data.RequirementStatuses.Completed;
        item.CompletedAt = now;
        Touch(assessment, "requirement_completed", $"{item.Ref}: completed.", now);

        if (assessment.Requirements.All(entry => !AgentJson.IsOpen(entry.Status)))
        {
            assessment.Phase = AssessmentPhases.Review;
            Touch(assessment, "ready_for_review", "All requirements are complete.", now);
        }

        await _comply.SaveAssessmentAsync(assessment, cancellationToken);
        var view = View(assessment);
        return RequirementResponse(view, item.LibraryRequirementId);
    }

    public async Task<JsonObject> MarkNotApplicableAsync(
        string organizationId,
        ToolArguments args,
        CancellationToken cancellationToken = default)
    {
        var assessment = await LoadAsync(organizationId, args.Text("assessmentId"), cancellationToken);
        RequireScope(assessment);
        var item = RequireItem(assessment, args.Text("requirementId"));

        var reason = Required(
            args.Text("reason"),
            "Explain in English why the requirement does not apply.");

        var now = _time.GetUtcNow();
        item.Conclusion = reason;
        item.Status = Data.RequirementStatuses.NotApplicable;
        item.CompletedAt = now;
        Touch(assessment, "requirement_not_applicable", $"{item.Ref}: not applicable.", now);

        if (assessment.Requirements.All(entry => !AgentJson.IsOpen(entry.Status)))
        {
            assessment.Phase = AssessmentPhases.Review;
        }

        await _comply.SaveAssessmentAsync(assessment, cancellationToken);
        var view = View(assessment);
        return RequirementResponse(view, item.LibraryRequirementId);
    }

    public async Task<JsonObject> ReviewAsync(
        string organizationId,
        ToolArguments args,
        CancellationToken cancellationToken = default)
    {
        var assessment = await LoadAsync(organizationId, args.Text("assessmentId"), cancellationToken);
        RequireScope(assessment);

        var open = assessment.Requirements
            .Where(item => AgentJson.IsOpen(item.Status))
            .OrderBy(item => item.Position)
            .ToList();
        if (open.Count > 0)
        {
            var details = new JsonArray();
            foreach (var item in open.Take(10))
            {
                details.Add(new JsonObject
                {
                    ["requirementId"] = item.LibraryRequirementId,
                    ["ref"] = item.Ref,
                    ["status"] = item.Status,
                });
            }

            throw new AgentException(
                $"{open.Count} requirements still need evidence or a conclusion.",
                "requirements_open",
                details);
        }

        assessment.Phase = AssessmentPhases.Export;
        assessment.ReviewedAt = _time.GetUtcNow();
        Touch(assessment, "reviewed", "Assessment reviewed.", assessment.ReviewedAt.Value);
        await _comply.SaveAssessmentAsync(assessment, cancellationToken);

        var view = View(assessment);
        var response = AgentJson.Base(view);
        response["summary"] = AgentJson.ReviewSummary(view);
        response["progress"] = AgentJson.Progress(view);
        response["next_actions"] = new JsonArray(
            AgentJson.Action("export_assessment", "Generate the English audit package.", new JsonObject
            {
                ["assessmentId"] = view.Id,
            }));
        response["language_policy"] = AgentJson.LanguagePolicy();
        return response;
    }

    public async Task<JsonObject> ExportAsync(
        string organizationId,
        ToolArguments args,
        CancellationToken cancellationToken = default)
    {
        var assessment = await LoadAsync(organizationId, args.Text("assessmentId"), cancellationToken);
        if (assessment.ReviewedAt is null)
        {
            throw new AgentException("Review the assessment before exporting it.", "review_required");
        }

        var now = _time.GetUtcNow();
        assessment.Phase = AssessmentPhases.Complete;
        assessment.ExportedAt = now;
        Touch(assessment, "exported", "Audit package generated.", now);
        await _comply.SaveAssessmentAsync(assessment, cancellationToken);

        var view = View(assessment);
        var requirements = new JsonArray();
        foreach (var item in view.Items)
        {
            var evidence = new JsonArray();
            foreach (var entry in item.Evidence)
            {
                evidence.Add(new JsonObject
                {
                    ["title"] = entry.Title,
                    ["type"] = entry.Type,
                    ["source"] = Nullable(entry.Source),
                    ["summary"] = Nullable(entry.Summary),
                    ["citation"] = Nullable(entry.Citation),
                    ["collectedAt"] = AgentJson.Timestamp(entry.CollectedAt),
                    ["hash"] = Nullable(entry.Hash),
                });
            }

            requirements.Add(new JsonObject
            {
                ["ref"] = item.Ref,
                ["title"] = item.Title,
                ["description"] = Nullable(item.Description),
                ["status"] = item.Status,
                ["conclusion"] = Nullable(item.Conclusion),
                ["evidence"] = evidence,
            });
        }

        var manifest = new JsonObject
        {
            ["format"] = "comply.agent-package/v1",
            ["generatedAt"] = AgentJson.Timestamp(assessment.ExportedAt!.Value),
            ["language"] = "en",
            ["assessment"] = new JsonObject
            {
                ["id"] = view.Id,
                ["name"] = view.Name,
                ["framework"] = view.Framework,
                ["scope"] = view.Scope,
                ["periodFrom"] = Nullable(view.PeriodFrom),
                ["periodTo"] = Nullable(view.PeriodTo),
            },
            ["counts"] = AgentJson.Progress(view),
        };

        // The Node agent digests JSON.stringify({manifest, requirements}); keep the same
        // composition so the manifest sha256 is stable across backends.
        var payload = new JsonObject
        {
            ["manifest"] = manifest.DeepClone(),
            ["requirements"] = requirements.DeepClone(),
        };
        var digest = AgentText.Sha256Hex(payload.ToJsonString(CompactJson));
        manifest["sha256"] = digest;

        var response = AgentJson.Base(view);
        response["manifest"] = manifest;
        response["requirements"] = requirements;
        response["progress"] = AgentJson.Progress(view);
        response["next_actions"] = new JsonArray(
            AgentJson.Action(
                "start_assessment",
                "Start another assessment or share the exported package with the auditor."));
        response["language_policy"] = AgentJson.LanguagePolicy();
        return response;
    }

    public async Task<JsonObject> ListAssessmentsAsync(
        string organizationId,
        ToolArguments args,
        CancellationToken cancellationToken = default)
    {
        var rows = await QuerySummariesAsync(organizationId, cancellationToken);
        var page = PageNumber(args.ParseInt("page"));
        var pageSize = PageSize(args.ParseInt("pageSize"));

        var response = new JsonObject
        {
            ["assessments"] = Summaries(Slice(rows, page, pageSize)),
            ["total"] = rows.Count,
            ["page"] = page,
            ["pageSize"] = pageSize,
            ["page_info"] = AgentJson.PageInfo(rows.Count, page, pageSize),
            ["next_actions"] = new JsonArray(
                AgentJson.Action(
                    "start_assessment",
                    "Start a new guided assessment for another framework or scope.")),
            ["language_policy"] = AgentJson.LanguagePolicy(),
        };
        return response;
    }

    private async Task<List<SummaryRow>> QuerySummariesAsync(string organizationId, CancellationToken cancellationToken)
    {
        var assessments = await _comply.ListAssessmentsAsync(organizationId, cancellationToken);
        var rows = assessments
            .Select(item => new SummaryRow(
                item.Id,
                item.Name,
                item.Framework,
                item.Phase,
                item.Scope,
                item.PeriodFrom,
                item.PeriodTo,
                item.UpdatedAt,
                item.Requirements.Count,
                item.Requirements.Count(requirement => requirement.Status == Data.RequirementStatuses.Completed),
                item.Requirements.Count(requirement => requirement.Status == Data.RequirementStatuses.NotApplicable),
                item.Requirements.Count(requirement => requirement.Status == Data.RequirementStatuses.EvidenceCollected),
                item.Requirements.Count(requirement => requirement.Status == Data.RequirementStatuses.Open),
                item.Requirements.SelectMany(requirement => requirement.Evidence).Count()))
            .ToList();

        rows.Sort((left, right) => right.UpdatedAt.CompareTo(left.UpdatedAt));
        return rows;
    }

    private static JsonArray Summaries(IEnumerable<SummaryRow> rows)
    {
        var array = new JsonArray();
        foreach (var row in rows)
        {
            array.Add(AgentJson.Summary(
                row.Id,
                row.Name,
                row.Framework,
                row.Phase,
                row.Scope,
                row.PeriodFrom?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                row.PeriodTo?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                AgentJson.Progress(
                    row.Total,
                    row.Completed,
                    row.NotApplicable,
                    row.EvidenceCollected,
                    row.Open,
                    row.Evidence),
                row.UpdatedAt));
        }

        return array;
    }

    private JsonObject RequirementResponse(AssessmentView view, string requirementId)
    {
        var item = view.Items.Single(entry => entry.Id == requirementId);
        var response = AgentJson.Base(view);
        response["requirement"] = AgentJson.RequirementSummary(item);
        response["progress"] = AgentJson.Progress(view);
        response["next_actions"] = AgentJson.NextForPhase(view);
        response["language_policy"] = AgentJson.LanguagePolicy();
        return response;
    }

    private async Task<AssessmentView> LoadViewAsync(
        string organizationId,
        string? assessmentId,
        CancellationToken cancellationToken)
    {
        var assessment = await LoadAsync(organizationId, assessmentId, cancellationToken);
        return View(assessment);
    }

    private async Task<Assessment> LoadAsync(
        string organizationId,
        string? assessmentId,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(assessmentId))
        {
            throw new AgentException("Assessment not found for this tenant.", "not_found");
        }

        var assessment = await _comply.GetAssessmentAsync(organizationId, assessmentId, cancellationToken);
        return assessment ?? throw new AgentException("Assessment not found for this tenant.", "not_found");
    }

    private static AssessmentView View(Assessment assessment) => new()
    {
        Id = assessment.Id,
        OrganizationId = assessment.OrganizationId,
        Framework = assessment.Framework,
        Name = assessment.Name,
        Scope = assessment.Scope ?? "",
        PeriodFrom = assessment.PeriodFrom?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        PeriodTo = assessment.PeriodTo?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        ContentStatus = assessment.ContentStatus,
        Language = assessment.Language,
        Phase = assessment.Phase,
        Revision = assessment.Revision,
        CreatedAt = assessment.CreatedAt,
        UpdatedAt = assessment.UpdatedAt,
        ReviewedAt = assessment.ReviewedAt,
        ExportedAt = assessment.ExportedAt,
        Items = assessment.Requirements
            .OrderBy(item => item.Position)
            .ThenBy(item => item.Id, StringComparer.Ordinal)
            .Select(Item)
            .ToList(),
        Events = assessment.Events
            .OrderBy(item => item.Revision)
            .ThenBy(item => item.CreatedAt)
            .Select(item => new EventView
            {
                At = item.CreatedAt,
                Revision = item.Revision,
                Type = item.Type,
                Message = item.Message,
            })
            .ToList(),
    };

    private static ItemView Item(AssessmentRequirement requirement) => new()
    {
        Id = requirement.LibraryRequirementId,
        Ref = requirement.Ref,
        Title = requirement.Title,
        Description = requirement.Description,
        SourceId = requirement.SourceId,
        Theme = requirement.Theme,
        Status = requirement.Status,
        Conclusion = requirement.Conclusion,
        CompletedAt = requirement.CompletedAt,
        Evidence = requirement.Evidence
            .OrderBy(item => item.CreatedAt)
            .ThenBy(item => item.Id, StringComparer.Ordinal)
            .Select(View)
            .ToList(),
    };

    private static EvidenceView View(Evidence evidence) => new()
    {
        Id = evidence.Id,
        Title = evidence.Title,
        Type = evidence.Type,
        Source = evidence.Source,
        Summary = evidence.Summary,
        Citation = evidence.Citation,
        CollectedAt = evidence.CreatedAt,
        Hash = evidence.Hash,
    };

    private static AssessmentRequirement RequireItem(Assessment assessment, string? requirementId)
    {
        var item = assessment.Requirements.FirstOrDefault(entry => entry.LibraryRequirementId == requirementId);
        return item ?? throw new AgentException(
            $"Requirement {requirementId ?? "undefined"} is not in this assessment.",
            "requirement_not_found");
    }

    private static ItemView RequireItem(AssessmentView assessment, string? requirementId)
    {
        var item = assessment.Items.FirstOrDefault(entry => entry.Id == requirementId);
        return item ?? throw new AgentException(
            $"Requirement {requirementId ?? "undefined"} is not in this assessment.",
            "requirement_not_found");
    }

    private static void RequireScope(Assessment assessment)
    {
        if (string.IsNullOrEmpty(assessment.Scope))
        {
            throw new AgentException(
                "Confirm the assessment scope first with set_scope.",
                "scope_required");
        }
    }

    private static string Required(string? value, string message)
    {
        var text = (value ?? "").Trim();
        return text.Length == 0 ? throw new AgentException(message, "field_required") : text;
    }

    private void Touch(Assessment assessment, string type, string message, DateTimeOffset at)
    {
        assessment.Revision += 1;
        assessment.UpdatedAt = at;
        assessment.Events.Add(new AssessmentEvent
        {
            Id = $"ase-{Guid.NewGuid():N}",
            AssessmentId = assessment.Id,
            Revision = assessment.Revision,
            Type = type,
            Message = message,
            CreatedAt = at,
        });
    }

    private (string From, string To) PeriodOf(ToolArguments args, DateTimeOffset fallback)
    {
        var year = fallback.ToUniversalTime().Year;
        var from = NormalizeDate(args.Text("periodFrom") ?? $"{year:D4}-01-01", "periodFrom");
        var to = NormalizeDate(args.Text("periodTo") ?? $"{year:D4}-12-31", "periodTo");
        if (string.CompareOrdinal(from, to) > 0)
        {
            throw new AgentException("periodFrom must be before periodTo.", "invalid_period");
        }

        return (from, to);
    }

    private static string NormalizeDate(string value, string field)
    {
        if (!DatePattern().IsMatch(value)
            || !DateOnly.TryParseExact(
                value,
                "yyyy-MM-dd",
                CultureInfo.InvariantCulture,
                DateTimeStyles.None,
                out _))
        {
            throw new AgentException($"{field} must be an ISO date (YYYY-MM-DD).", "invalid_date");
        }

        return value;
    }

    private static DateTimeOffset ParseTimestamp(string value)
    {
        if (DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed))
        {
            return parsed;
        }

        throw new AgentException("collectedAt must be an ISO timestamp.", "invalid_date");
    }

    private static DateOnly Date(string value) =>
        DateOnly.ParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static string EvidenceHash(
        string assessmentId,
        string itemId,
        string title,
        string summary,
        string collectedAt) =>
        $"sha256:{AgentText.Sha256Hex($"{assessmentId}:{itemId}:{title}:{summary}:{collectedAt}")}";

    /// <summary><c>parseInt(page ?? "1", 10) || 1</c>, never below 1.</summary>
    public static int PageNumber(double? raw) =>
        raw is null ? 1 : (int)Math.Clamp(Math.Truncate(raw.Value), 1, int.MaxValue);

    /// <summary><c>parseInt(pageSize ?? "25", 10) || 25</c>, capped at 100.</summary>
    public static int PageSize(double? raw) =>
        raw is null || raw == 0 ? 25 : AgentText.Clamp(raw, 1, 100);

    private static List<T> Slice<T>(IReadOnlyList<T> items, int page, int pageSize)
    {
        var offset = (long)(page - 1) * pageSize;
        if (offset >= items.Count) return [];
        return items.Skip((int)offset).Take(pageSize).ToList();
    }

    private string IdSuffix()
    {
        var value = _idFactory() ?? "";
        return value.Length <= 8 ? value : value[..8];
    }

    private static JsonNode? Nullable(string? value) => value is null ? null : JsonValue.Create(value);

    private sealed record SummaryRow(
        string Id,
        string Name,
        string Framework,
        string Phase,
        string? Scope,
        DateOnly? PeriodFrom,
        DateOnly? PeriodTo,
        DateTimeOffset UpdatedAt,
        int Total,
        int Completed,
        int NotApplicable,
        int EvidenceCollected,
        int Open,
        int Evidence);

    private sealed record Document(ItemView Item, List<string> Terms);

    private sealed record Match(ItemView Item, double Score, List<string> Terms);

    [GeneratedRegex(@"^\d{4}-\d{2}-\d{2}$", RegexOptions.CultureInvariant)]
    private static partial Regex DatePattern();
}
