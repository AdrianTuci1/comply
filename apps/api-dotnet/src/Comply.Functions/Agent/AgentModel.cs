using System.Globalization;
using System.Text.Json.Nodes;

namespace Comply.Functions.Agent;

/// <summary>Projection of an assessment and its children used by every response builder.</summary>
internal sealed class AssessmentView
{
    public required string Id { get; init; }
    public required string OrganizationId { get; init; }
    public required string Framework { get; init; }
    public required string Name { get; init; }
    public required string Scope { get; init; }
    public required string? PeriodFrom { get; init; }
    public required string? PeriodTo { get; init; }
    public required string ContentStatus { get; init; }
    public required string Language { get; init; }
    public required string Phase { get; init; }
    public required int Revision { get; init; }
    public required DateTimeOffset CreatedAt { get; init; }
    public required DateTimeOffset UpdatedAt { get; init; }
    public DateTimeOffset? ReviewedAt { get; init; }
    public DateTimeOffset? ExportedAt { get; init; }
    public required IReadOnlyList<ItemView> Items { get; init; }
    public required IReadOnlyList<EventView> Events { get; init; }
}

internal sealed class ItemView
{
    public required string Id { get; init; }
    public required string Ref { get; init; }
    public required string Title { get; init; }
    public required string? Description { get; init; }
    public required string? SourceId { get; init; }
    public required string? Theme { get; init; }
    public required string Status { get; init; }
    public required string? Conclusion { get; init; }
    public required DateTimeOffset? CompletedAt { get; init; }
    public required IReadOnlyList<EvidenceView> Evidence { get; init; }
}

internal sealed class EvidenceView
{
    public required string Id { get; init; }
    public required string Title { get; init; }
    public required string Type { get; init; }
    public required string? Source { get; init; }
    public required string? Summary { get; init; }
    public required string? Citation { get; init; }
    public required DateTimeOffset CollectedAt { get; init; }
    public required string? Hash { get; init; }
}

internal sealed class EventView
{
    public required DateTimeOffset At { get; init; }
    public required int Revision { get; init; }
    public required string Type { get; init; }
    public required string Message { get; init; }
}

/// <summary>
/// Response builders. Every object is created fresh (a JSON node can only have one parent) and
/// keys are written in the order the Node agent emits them.
/// </summary>
internal static class AgentJson
{
    public const string EnglishInstruction =
        "Reply to the user in the language they use. Write every scope, evidence summary, conclusion, and export in English.";

    public static JsonObject LanguagePolicy() => new()
    {
        ["userLanguage"] = "any",
        ["publishLanguage"] = "en",
        ["instruction"] = EnglishInstruction,
    };

    public static JsonArray Workflow() =>
    [
        Step(
            "intent",
            "start_assessment",
            "Ask which framework and which part of the organization to assess. Translate the answer into a short English scope."),
        Step(
            "scope",
            "set_scope",
            "Confirm systems, locations, and period. The scope and period are published in English."),
        Step(
            "sources",
            "get_brief",
            "Read the five prioritized requirements. Explain them to the user in their own language."),
        Step(
            "execution",
            "submit_evidence",
            "For each requirement, ask where the evidence lives. Record the English summary and a citation."),
        Step(
            "review",
            "review_assessment",
            "Show the user the completed and open requirements before the review step."),
        Step(
            "export",
            "export_assessment",
            "Generate the audit package. It contains only English conclusions and evidence summaries."),
    ];

    public static JsonObject Guide() => new()
    {
        ["workflow"] = Workflow(),
        ["phases"] = new JsonArray("scope", "collect", "review", "export", "complete"),
        ["language_policy"] = LanguagePolicy(),
        ["rules"] = new JsonArray(
            "Ask one question at a time and explain why it matters.",
            "Translate the user's answer into an English scope, evidence summary, and conclusion.",
            "Never invent evidence. A requirement needs at least one artifact before it can close.",
            "After every tool call, tell the user the new progress and the next step.",
            "Use search_requirements to find related controls or requirements that one artifact may cover.",
            "Use get_progress when the user asks for a status update; do not fetch the full checklist.",
            "Do not send credentials, tokens, or raw personal data in evidence."),
        ["start_prompt"] =
            "Start a NIS2 assessment for the systems I name. Ask me for the scope, then guide me through the evidence one requirement at a time.",
    };

    public static JsonObject Base(AssessmentView assessment) => new()
    {
        ["assessment_id"] = assessment.Id,
        ["name"] = assessment.Name,
        ["framework"] = assessment.Framework,
        ["status"] = assessment.Phase,
        ["phase"] = assessment.Phase,
        ["scope"] = assessment.Scope,
        ["period"] = Period(assessment),
        ["revision"] = assessment.Revision,
        ["updated_at"] = Timestamp(assessment.UpdatedAt),
        ["content_status"] = assessment.ContentStatus,
        ["language"] = assessment.Language,
        ["events"] = Events(assessment),
    };

    public static JsonObject State(AssessmentView assessment)
    {
        var state = Base(assessment);
        state["progress"] = Progress(assessment);
        state["blocked_by"] = Blockers(assessment);
        state["next_actions"] = NextForPhase(assessment);
        state["language_policy"] = LanguagePolicy();
        return state;
    }

    public static JsonObject Detail(AssessmentView assessment)
    {
        var detail = State(assessment);
        var items = new JsonArray();
        foreach (var item in assessment.Items)
        {
            var entry = RequirementSummary(item);
            entry["sourceId"] = Nullable(item.SourceId);
            entry["theme"] = Nullable(item.Theme);
            entry["contentStatus"] = assessment.ContentStatus;
            entry["evidence"] = EvidenceArray(item);
            items.Add(entry);
        }

        detail["items"] = items;
        detail["total"] = assessment.Items.Count;
        return detail;
    }

    public static JsonObject Summary(AssessmentView assessment) => Summary(
        assessment.Id,
        assessment.Name,
        assessment.Framework,
        assessment.Phase,
        assessment.Scope,
        assessment.PeriodFrom,
        assessment.PeriodTo,
        Progress(assessment),
        assessment.UpdatedAt);

    public static JsonObject Summary(
        string id,
        string name,
        string framework,
        string phase,
        string? scope,
        string? periodFrom,
        string? periodTo,
        JsonObject progress,
        DateTimeOffset updatedAt) => new()
    {
        ["assessment_id"] = id,
        ["name"] = name,
        ["framework"] = framework,
        ["phase"] = phase,
        ["scope"] = scope ?? "",
        ["period"] = new JsonObject
        {
            ["from"] = Nullable(periodFrom),
            ["to"] = Nullable(periodTo),
        },
        ["progress"] = progress,
        ["updated_at"] = Timestamp(updatedAt),
    };

    public static JsonObject Progress(AssessmentView assessment) => Progress(
        assessment.Items.Count,
        assessment.Items.Count(item => item.Status == Data.RequirementStatuses.Completed),
        assessment.Items.Count(item => item.Status == Data.RequirementStatuses.NotApplicable),
        assessment.Items.Count(item => item.Status == Data.RequirementStatuses.EvidenceCollected),
        assessment.Items.Count(item => item.Status == Data.RequirementStatuses.Open),
        assessment.Items.Sum(item => item.Evidence.Count));

    public static JsonObject Progress(
        int total,
        int completed,
        int notApplicable,
        int evidenceCollected,
        int open,
        int evidence)
    {
        var closed = completed + notApplicable;
        return new JsonObject
        {
            ["total"] = total,
            ["completed"] = completed,
            ["not_applicable"] = notApplicable,
            ["evidence_collected"] = evidenceCollected,
            ["open"] = open,
            ["evidence"] = evidence,
            ["percent"] = total == 0 ? 0 : AgentText.JsRound((double)closed / total * 100),
        };
    }

    public static JsonObject RequirementSummary(ItemView item) => new()
    {
        ["requirement_id"] = item.Id,
        ["ref"] = item.Ref,
        ["title"] = item.Title,
        ["description"] = Nullable(item.Description),
        ["status"] = item.Status,
        ["evidence_count"] = item.Evidence.Count,
        ["conclusion"] = Nullable(item.Conclusion),
        ["completed_at"] = item.CompletedAt is { } completedAt
            ? JsonValue.Create(Timestamp(completedAt))
            : null,
    };

    public static JsonObject RequirementDetail(ItemView item, string contentStatus)
    {
        var detail = RequirementSummary(item);
        detail["sourceId"] = Nullable(item.SourceId);
        detail["theme"] = Nullable(item.Theme);
        detail["contentStatus"] = contentStatus;
        detail["evidence"] = EvidenceArray(item);
        return detail;
    }

    public static JsonArray EvidenceArray(ItemView item)
    {
        var array = new JsonArray();
        foreach (var evidence in item.Evidence)
        {
            array.Add(Evidence(evidence));
        }

        return array;
    }

    public static JsonObject Evidence(EvidenceView evidence) => new()
    {
        ["id"] = evidence.Id,
        ["title"] = evidence.Title,
        ["type"] = evidence.Type,
        ["source"] = Nullable(evidence.Source),
        ["summary"] = Nullable(evidence.Summary),
        ["citation"] = Nullable(evidence.Citation),
        ["collectedAt"] = Timestamp(evidence.CollectedAt),
        ["hash"] = Nullable(evidence.Hash),
    };

    public static JsonObject Action(string tool, string description, JsonObject? arguments = null) => new()
    {
        ["tool"] = tool,
        ["description"] = description,
        ["arguments"] = arguments ?? new JsonObject(),
    };

    public static JsonArray NextForPhase(AssessmentView assessment)
    {
        switch (assessment.Phase)
        {
            case Data.AssessmentPhases.Scope:
                return
                [
                    Action("set_scope", "Confirm the assessment scope in English.", new JsonObject
                    {
                        ["assessmentId"] = assessment.Id,
                        ["scope"] = "Systems, locations, and boundaries in English.",
                    }),
                ];
            case Data.AssessmentPhases.Collect:
            {
                var first = assessment.Items.FirstOrDefault(item => IsOpen(item.Status));
                return first is null
                    ?
                    [
                        Action("review_assessment", "Move the completed assessment to review.", new JsonObject
                        {
                            ["assessmentId"] = assessment.Id,
                        }),
                    ]
                    :
                    [
                        Action("get_requirement", "Open the next requirement and ask the user for evidence.", new JsonObject
                        {
                            ["assessmentId"] = assessment.Id,
                            ["requirementId"] = first.Id,
                        }),
                    ];
            }
            case Data.AssessmentPhases.Review:
                return
                [
                    Action("review_assessment", "Confirm the review and prepare the export.", new JsonObject
                    {
                        ["assessmentId"] = assessment.Id,
                    }),
                ];
            case Data.AssessmentPhases.Export:
                return
                [
                    Action("export_assessment", "Generate the English audit package.", new JsonObject
                    {
                        ["assessmentId"] = assessment.Id,
                    }),
                ];
            default:
                return [];
        }
    }

    public static JsonArray NextForItem(AssessmentView assessment, ItemView item)
    {
        switch (item.Status)
        {
            case Data.RequirementStatuses.Completed:
            {
                var next = assessment.Items.FirstOrDefault(entry => IsOpen(entry.Status));
                return next is null
                    ? [Action("review_assessment", "All requirements are complete.")]
                    :
                    [
                        Action("get_requirement", "Open the next requirement.", new JsonObject
                        {
                            ["assessmentId"] = assessment.Id,
                            ["requirementId"] = next.Id,
                        }),
                    ];
            }
            case Data.RequirementStatuses.EvidenceCollected:
                return
                [
                    Action("complete_requirement", "Write the English conclusion.", new JsonObject
                    {
                        ["assessmentId"] = assessment.Id,
                        ["requirementId"] = item.Id,
                    }),
                ];
            default:
                return
                [
                    Action("submit_evidence", "Record the artifact the user describes.", new JsonObject
                    {
                        ["assessmentId"] = assessment.Id,
                        ["requirementId"] = item.Id,
                    }),
                ];
        }
    }

    public static JsonObject PageInfo(int total, int page, int pageSize)
    {
        var totalPages = total == 0 ? 0 : (int)Math.Ceiling((double)total / pageSize);
        return new JsonObject
        {
            ["page"] = page,
            ["page_size"] = pageSize,
            ["total_items"] = total,
            ["total_pages"] = totalPages,
            ["has_next_page"] = page < totalPages,
            ["has_previous_page"] = page > 1,
            ["next_page"] = page < totalPages ? JsonValue.Create(page + 1) : null,
            ["previous_page"] = page > 1 ? JsonValue.Create(page - 1) : null,
        };
    }

    public static JsonObject ReviewSummary(AssessmentView assessment)
    {
        var summary = Progress(assessment);
        summary["reviewed_at"] = assessment.ReviewedAt is { } reviewedAt
            ? JsonValue.Create(Timestamp(reviewedAt))
            : null;
        summary["message"] =
            "Every requirement has evidence or a not-applicable reason. The package is ready to export.";
        return summary;
    }

    public static JsonArray Blockers(AssessmentView assessment)
    {
        if (assessment.Phase == Data.AssessmentPhases.Scope && assessment.Scope.Length == 0)
        {
            return ["scope"];
        }

        return assessment.Items.Any(item => IsOpen(item.Status))
            && assessment.Phase == Data.AssessmentPhases.Review
            ? ["requirements_open"]
            : [];
    }

    public static string QuestionFor(ItemView item) =>
        $"How does the organization meet {item.Ref} — {item.Title}? Ask for the control in place, the systems or locations it covers, where the evidence is stored, and how an auditor can verify it. Write the evidence summary and conclusion in English.";

    public static string FrameworkLabel(string framework) => framework switch
    {
        "nis2" => "NIS2",
        "iso27001" => "ISO/IEC 27001",
        "ai-act" => "EU AI Act",
        "soc2" => "SOC 2",
        _ => "Compliance",
    };

    public static bool IsOpen(string status) =>
        status is Data.RequirementStatuses.Open or Data.RequirementStatuses.EvidenceCollected;

    public static string Timestamp(DateTimeOffset value) =>
        value.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    private static JsonObject Period(AssessmentView assessment) => new()
    {
        ["from"] = Nullable(assessment.PeriodFrom),
        ["to"] = Nullable(assessment.PeriodTo),
    };

    private static JsonArray Events(AssessmentView assessment)
    {
        var events = new JsonArray();
        var start = Math.Max(0, assessment.Events.Count - 10);
        for (var index = start; index < assessment.Events.Count; index++)
        {
            var entry = assessment.Events[index];
            events.Add(new JsonObject
            {
                ["at"] = Timestamp(entry.At),
                ["revision"] = entry.Revision,
                ["type"] = entry.Type,
                ["message"] = entry.Message,
            });
        }

        return events;
    }

    private static JsonObject Step(string step, string tool, string guidance) => new()
    {
        ["step"] = step,
        ["tool"] = tool,
        ["guidance"] = guidance,
    };

    private static JsonNode? Nullable(string? value) => value is null ? null : JsonValue.Create(value);
}
