import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const FRAMEWORKS = ["nis2", "iso27001", "ai-act"];
const EVIDENCE_TYPES = [
  "document",
  "screenshot",
  "log_export",
  "api_report",
  "attestation",
];
const OPEN_STATUSES = new Set(["open", "evidence_collected"]);

const LANGUAGE_POLICY = {
  userLanguage: "any",
  publishLanguage: "en",
  instruction:
    "Reply to the user in the language they use. Write every scope, evidence summary, conclusion, and export in English.",
};

const WORKFLOW = [
  {
    step: "intent",
    tool: "start_assessment",
    guidance:
      "Ask which framework and which part of the organization to assess. Translate the answer into a short English scope.",
  },
  {
    step: "scope",
    tool: "set_scope",
    guidance:
      "Confirm systems, locations, and period. The scope and period are published in English.",
  },
  {
    step: "sources",
    tool: "get_brief",
    guidance:
      "Read the five prioritized requirements. Explain them to the user in their own language.",
  },
  {
    step: "execution",
    tool: "submit_evidence",
    guidance:
      "For each requirement, ask where the evidence lives. Record the English summary and a citation.",
  },
  {
    step: "review",
    tool: "review_assessment",
    guidance:
      "Show the user the completed and open requirements before the review step.",
  },
  {
    step: "export",
    tool: "export_assessment",
    guidance:
      "Generate the audit package. It contains only English conclusions and evidence summaries.",
  },
];

export class AgentError extends Error {
  constructor(message, { code = "invalid_request", details = null } = {}) {
    super(message);
    this.name = "AgentError";
    this.code = code;
    this.details = details;
  }
}

export class AgentRegistry {
  constructor({
    store,
    now = () => new Date(),
    idFactory = randomUUID,
    dataFile = null,
  } = {}) {
    if (!store) throw new Error("A content store is required.");
    this.store = store;
    this.now = now;
    this.idFactory = idFactory;
    this.dataFile = dataFile;
    this.assessments = new Map();
    this.writeQueue = Promise.resolve();
  }

  /** Loads persisted assessments. Without a data file the registry stays in memory. */
  async init() {
    if (!this.dataFile) return this;
    const data = await readJson(this.dataFile);
    const saved = Array.isArray(data?.assessments) ? data.assessments : [];
    for (const assessment of saved) {
      if (isAssessment(assessment))
        this.assessments.set(assessment.id, assessment);
    }
    return this;
  }

  /** Resolves after every queued write has reached disk. */
  async flush() {
    await this.writeQueue;
  }

  list(tenantId) {
    return [...this.assessments.values()]
      .filter((assessment) => assessment.tenantId === tenantId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((assessment) => summary(assessment));
  }

  listAssessments(tenantId, args = {}) {
    const all = this.list(tenantId);
    const page = Math.max(1, Number.parseInt(args.page ?? "1", 10) || 1);
    const pageSize = clamp(
      Number.parseInt(args.pageSize ?? "25", 10) || 25,
      1,
      100,
    );
    return {
      assessments: all.slice((page - 1) * pageSize, page * pageSize),
      total: all.length,
      page,
      pageSize,
      page_info: pageInfo(all.length, page, pageSize),
      next_actions: [
        action(
          "start_assessment",
          "Start a new guided assessment for another framework or scope.",
        ),
      ],
      language_policy: LANGUAGE_POLICY,
    };
  }

  get(tenantId, assessmentId) {
    const assessment = this.assessments.get(assessmentId);
    if (!assessment || assessment.tenantId !== tenantId) {
      throw new AgentError("Assessment not found for this tenant.", {
        code: "not_found",
      });
    }
    return assessment;
  }

  /** Full assessment with every requirement and its evidence, for the board view. */
  detail(tenantId, assessmentId) {
    const assessment = this.get(tenantId, assessmentId);
    return {
      ...state(assessment),
      items: assessment.requirements.map((item) => ({
        ...requirementSummary(item),
        sourceId: item.sourceId,
        theme: item.theme,
        contentStatus: item.contentStatus,
        evidence: item.evidence,
      })),
      total: assessment.requirements.length,
    };
  }

  call(tenantId, tool, args = {}) {
    switch (tool) {
      case "get_agent_guide":
        return guide();
      case "start_assessment":
        return this.start(tenantId, args);
      case "list_assessments":
        return this.listAssessments(tenantId, args);
      case "get_assessment_state":
        return state(this.get(tenantId, args.assessmentId));
      case "set_scope":
        return this.setScope(tenantId, args);
      case "get_brief":
        return this.brief(tenantId, args);
      case "list_requirements":
        return this.listRequirements(tenantId, args);
      case "search_requirements":
        return this.searchRequirements(tenantId, args);
      case "get_requirement":
        return this.requirement(tenantId, args);
      case "get_progress":
        return this.progress(tenantId, args);
      case "submit_evidence":
        return this.submitEvidence(tenantId, args);
      case "complete_requirement":
        return this.completeRequirement(tenantId, args);
      case "mark_not_applicable":
        return this.markNotApplicable(tenantId, args);
      case "review_assessment":
        return this.review(tenantId, args);
      case "export_assessment":
        return this.exportPackage(tenantId, args);
      default:
        throw new AgentError(`Unknown tool: ${tool}.`, {
          code: "unknown_tool",
        });
    }
  }

  start(tenantId, args) {
    const framework = String(args.framework ?? "");
    if (!FRAMEWORKS.includes(framework)) {
      throw new AgentError(`Choose a framework: ${FRAMEWORKS.join(", ")}.`, {
        code: "invalid_framework",
      });
    }

    const library = this.store.snapshot();
    const pool = library.requirements.filter(
      (requirement) => requirement.frameworkId === framework,
    );
    if (pool.length === 0) {
      throw new AgentError(
        `No requirements are available for ${framework}. Refresh the sources first.`,
        { code: "empty_library" },
      );
    }

    // Managed content is delivered as a full framework checklist. An explicit
    // limit remains available for a focused sample.
    const limit =
      args.limit === undefined
        ? pool.length
        : clamp(Number(args.limit), 1, pool.length);
    const requirements = pool.slice(0, limit).map((requirement) => ({
      id: requirement.id,
      ref: requirement.ref,
      title: requirement.title,
      description: requirement.text,
      sourceId: requirement.sourceId,
      theme: requirement.theme,
      contentStatus: requirement.status,
      status: "open",
      evidence: [],
      conclusion: null,
      completedAt: null,
    }));

    const contentStatus = pool.every(
      (requirement) => requirement.status === "published",
    )
      ? "published"
      : "extracted";
    const timestamp = this.now().toISOString();
    const period = periodOf(args, timestamp);
    const assessment = {
      id: `asm-${this.idFactory().slice(0, 8)}`,
      tenantId,
      framework,
      name: String(
        args.name ?? `${frameworkLabel(framework)} assessment`,
      ).trim(),
      scope: String(args.scope ?? "").trim(),
      periodFrom: period.from,
      periodTo: period.to,
      contentStatus,
      language: "en",
      phase: String(args.scope ?? "").trim() ? "collect" : "scope",
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      reviewedAt: null,
      exportedAt: null,
      requirements,
      events: [
        {
          at: timestamp,
          revision: 1,
          type: "created",
          message: `Assessment created from ${pool.length} available requirements.`,
        },
      ],
    };
    this.assessments.set(assessment.id, assessment);
    this.persist();
    return state(assessment);
  }

  setScope(tenantId, args) {
    const assessment = this.get(tenantId, args.assessmentId);
    const scope = String(args.scope ?? "").trim();
    if (!scope) {
      throw new AgentError(
        "Describe the systems, locations, and period in scope.",
        {
          code: "scope_required",
        },
      );
    }

    const period = periodOf(args, assessment.createdAt);
    assessment.scope = scope;
    assessment.periodFrom = period.from;
    assessment.periodTo = period.to;
    if (assessment.phase === "scope") assessment.phase = "collect";
    this.touch(assessment, "scope_set", "Scope confirmed in English.");
    this.persist();
    return state(assessment);
  }

  brief(tenantId, args) {
    const assessment = this.get(tenantId, args.assessmentId);
    const open = assessment.requirements.filter((item) =>
      OPEN_STATUSES.has(item.status),
    );
    const actions = open.slice(0, 5).map((item) => ({
      requirementId: item.id,
      ref: item.ref,
      title: item.title,
      description: item.description,
      status: item.status,
      question: questionFor(item),
      evidenceCount: item.evidence.length,
      tool:
        item.status === "evidence_collected"
          ? "complete_requirement"
          : "submit_evidence",
    }));

    return {
      ...base(assessment),
      brief: actions,
      progress: progressOf(assessment),
      blocked_by: assessment.phase === "scope" ? ["scope"] : [],
      next_actions:
        assessment.phase === "scope"
          ? [
              action("set_scope", "Confirm the assessment scope in English.", {
                assessmentId: assessment.id,
                scope: "Systems, locations, and boundaries in English.",
              }),
            ]
          : actions.length > 0
            ? [
                action(
                  "get_requirement",
                  "Open the first prioritized requirement and ask the user about the evidence.",
                  {
                    assessmentId: assessment.id,
                    requirementId: actions[0].requirementId,
                  },
                ),
              ]
            : nextForPhase(assessment),
      language_policy: LANGUAGE_POLICY,
    };
  }

  listRequirements(tenantId, args) {
    const assessment = this.get(tenantId, args.assessmentId);
    const status = args.status ? String(args.status) : null;
    const query = String(args.query ?? "")
      .trim()
      .toLowerCase();
    const page = Math.max(1, Number.parseInt(args.page ?? "1", 10) || 1);
    const pageSize = clamp(
      Number.parseInt(args.pageSize ?? "25", 10) || 25,
      1,
      100,
    );

    const filtered = assessment.requirements.filter((item) => {
      const matchesStatus = !status || item.status === status;
      const matchesQuery =
        !query ||
        [item.ref, item.title, item.description, item.conclusion]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query));
      return matchesStatus && matchesQuery;
    });
    const items = filtered
      .slice((page - 1) * pageSize, page * pageSize)
      .map((item) => requirementSummary(item));

    return {
      ...base(assessment),
      items,
      total: filtered.length,
      page,
      pageSize,
      page_info: pageInfo(filtered.length, page, pageSize),
      filters: { status, query: query || null },
      progress: progressOf(assessment),
      next_actions: nextForPhase(assessment),
      language_policy: LANGUAGE_POLICY,
    };
  }

  searchRequirements(tenantId, args) {
    const assessment = this.get(tenantId, args.assessmentId);
    const query = String(args.query ?? "").trim();
    const similarTo = String(args.similarTo ?? "").trim();
    if (query && similarTo) {
      throw new AgentError("Provide query or similarTo, not both.", {
        code: "invalid_search",
      });
    }
    if (!query && !similarTo) {
      throw new AgentError(
        "Provide query or similarTo to search the checklist.",
        { code: "query_required" },
      );
    }

    let target = null;
    let text = query;
    if (similarTo) {
      target = requireItem(assessment, similarTo);
      text = [target.ref, target.title, target.description, target.conclusion]
        .filter(Boolean)
        .join(" ");
    }
    const queryTerms = tokenize(text);
    if (queryTerms.length === 0) {
      throw new AgentError(
        "Use at least one meaningful English term in the search.",
        { code: "query_required" },
      );
    }

    const documents = assessment.requirements.map((item) => ({
      item,
      terms: tokenize(searchText(item)),
    }));
    const documentFrequency = new Map();
    for (const document of documents) {
      for (const term of new Set(document.terms)) {
        documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
      }
    }
    const idf = (term) =>
      Math.log(
        (documents.length + 1) / ((documentFrequency.get(term) ?? 0) + 1),
      ) + 1;
    const queryVector = weightedVector(queryTerms, idf);

    const status = args.status ? String(args.status) : null;
    if (
      status &&
      !["open", "evidence_collected", "completed", "not_applicable"].includes(
        status,
      )
    ) {
      throw new AgentError("Unknown requirement status.", {
        code: "invalid_status",
      });
    }
    const minScore = Math.min(
      1,
      Math.max(0, Number(args.minScore ?? 0.05) || 0),
    );

    const matches = documents
      .map((document) => {
        const score = cosine(queryVector, weightedVector(document.terms, idf));
        return {
          item: document.item,
          score: Math.round(score * 1000) / 1000,
          terms: [...new Set(queryTerms)].filter((term) =>
            document.terms.includes(term),
          ),
        };
      })
      .filter(
        (match) =>
          match.score >= minScore &&
          match.item.id !== target?.id &&
          (!status || match.item.status === status),
      )
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.item.ref.localeCompare(right.item.ref),
      );

    const page = Math.max(1, Number.parseInt(args.page ?? "1", 10) || 1);
    const pageSize = clamp(
      Number.parseInt(args.pageSize ?? "25", 10) || 25,
      1,
      100,
    );
    const items = matches
      .slice((page - 1) * pageSize, page * pageSize)
      .map((match) => ({
        ...requirementSummary(match.item),
        score: match.score,
        matched_terms: match.terms.slice(0, 5),
      }));

    return {
      ...base(assessment),
      query: query || null,
      similar_to: similarTo || null,
      items,
      total: matches.length,
      page,
      pageSize,
      page_info: pageInfo(matches.length, page, pageSize),
      progress: progressOf(assessment),
      next_actions: nextForPhase(assessment),
      language_policy: LANGUAGE_POLICY,
    };
  }

  progress(tenantId, args) {
    const assessment = this.get(tenantId, args.assessmentId);
    const byTheme = new Map();
    for (const item of assessment.requirements) {
      const theme = item.theme || "unclassified";
      const bucket = byTheme.get(theme) ?? {
        theme,
        total: 0,
        completed: 0,
        not_applicable: 0,
        evidence_collected: 0,
        open: 0,
      };
      bucket.total += 1;
      bucket[item.status] += 1;
      byTheme.set(theme, bucket);
    }
    const themes = [...byTheme.values()]
      .map((bucket) => ({
        ...bucket,
        percent:
          bucket.total === 0
            ? 0
            : Math.round(
                ((bucket.completed + bucket.not_applicable) / bucket.total) *
                  100,
              ),
      }))
      .sort((left, right) => left.theme.localeCompare(right.theme));
    const remaining = assessment.requirements
      .filter((item) => OPEN_STATUSES.has(item.status))
      .slice(0, 5)
      .map((item) => ({
        requirement_id: item.id,
        ref: item.ref,
        title: item.title,
        status: item.status,
        evidence_count: item.evidence.length,
      }));

    return {
      ...base(assessment),
      progress: progressOf(assessment),
      by_status: {
        open: assessment.requirements.filter((item) => item.status === "open")
          .length,
        evidence_collected: assessment.requirements.filter(
          (item) => item.status === "evidence_collected",
        ).length,
        completed: assessment.requirements.filter(
          (item) => item.status === "completed",
        ).length,
        not_applicable: assessment.requirements.filter(
          (item) => item.status === "not_applicable",
        ).length,
      },
      by_theme: themes,
      remaining,
      next_actions: nextForPhase(assessment),
      language_policy: LANGUAGE_POLICY,
    };
  }

  requirement(tenantId, args) {
    const assessment = this.get(tenantId, args.assessmentId);
    const item = requireItem(assessment, args.requirementId);
    return {
      ...base(assessment),
      requirement: {
        ...requirementSummary(item),
        sourceId: item.sourceId,
        theme: item.theme,
        contentStatus: item.contentStatus,
        evidence: item.evidence,
      },
      guidance: {
        question: questionFor(item),
        language:
          "Ask in the user's language. Record the evidence summary in English.",
        evidenceRequired: true,
        next:
          item.status === "completed"
            ? "The requirement is complete. Open the next item from get_brief."
            : "Ask for the evidence, then call submit_evidence.",
      },
      progress: progressOf(assessment),
      next_actions: nextForItem(assessment, item),
      language_policy: LANGUAGE_POLICY,
    };
  }

  submitEvidence(tenantId, args) {
    const assessment = this.get(tenantId, args.assessmentId);
    requireScope(assessment);
    const item = requireItem(assessment, args.requirementId);
    if (item.status === "completed") {
      throw new AgentError("This requirement is already complete.", {
        code: "already_complete",
      });
    }

    const title = required(
      args.title,
      "Give the evidence a short English title.",
    );
    const source = required(args.source, "Name where the evidence comes from.");
    const summary = required(
      args.summary,
      "Summarize the evidence in English, with the result it shows.",
    );
    const type = String(args.type ?? "document");
    if (!EVIDENCE_TYPES.includes(type)) {
      throw new AgentError(
        `Evidence type must be one of: ${EVIDENCE_TYPES.join(", ")}.`,
        {
          code: "invalid_evidence_type",
        },
      );
    }

    const collectedAt = String(args.collectedAt ?? this.now().toISOString());
    const evidence = {
      id: `ev-${this.idFactory().slice(0, 8)}`,
      title,
      type,
      source,
      summary,
      citation: String(args.citation ?? "").trim() || null,
      collectedAt,
      hash: `sha256:${createHash("sha256")
        .update(
          `${assessment.id}:${item.id}:${title}:${summary}:${collectedAt}`,
        )
        .digest("hex")}`,
    };
    item.evidence.push(evidence);
    item.status = "evidence_collected";
    this.touch(
      assessment,
      "evidence_submitted",
      `${item.ref}: evidence submitted.`,
    );
    this.persist();

    return {
      ...base(assessment),
      evidence,
      requirement: requirementSummary(item),
      progress: progressOf(assessment),
      next_actions: [
        action(
          "complete_requirement",
          "Write the English conclusion and close this requirement.",
          {
            assessmentId: assessment.id,
            requirementId: item.id,
            conclusion:
              "One or two sentences in English, grounded in the evidence.",
          },
        ),
        action(
          "submit_evidence",
          "Add another artifact if the first one does not cover the full requirement.",
          { assessmentId: assessment.id, requirementId: item.id },
        ),
      ],
      language_policy: LANGUAGE_POLICY,
    };
  }

  completeRequirement(tenantId, args) {
    const assessment = this.get(tenantId, args.assessmentId);
    requireScope(assessment);
    const item = requireItem(assessment, args.requirementId);
    if (item.evidence.length === 0) {
      throw new AgentError(
        "Acceptance requires at least one piece of evidence. Call submit_evidence first.",
        { code: "evidence_required" },
      );
    }
    if (args.language && String(args.language).toLowerCase() !== "en") {
      throw new AgentError(
        "Conclusions are published in English. Rewrite the conclusion in English.",
        { code: "language_required" },
      );
    }
    const conclusion = required(
      args.conclusion,
      "Write the conclusion in English, grounded in the evidence.",
    );

    item.conclusion = conclusion;
    item.status = "completed";
    item.completedAt = this.now().toISOString();
    this.touch(assessment, "requirement_completed", `${item.ref}: completed.`);

    if (
      assessment.requirements.every((entry) => !OPEN_STATUSES.has(entry.status))
    ) {
      assessment.phase = "review";
      this.touch(
        assessment,
        "ready_for_review",
        "All requirements are complete.",
      );
    }
    this.persist();

    return {
      ...base(assessment),
      requirement: requirementSummary(item),
      progress: progressOf(assessment),
      next_actions: nextForPhase(assessment),
      language_policy: LANGUAGE_POLICY,
    };
  }

  markNotApplicable(tenantId, args) {
    const assessment = this.get(tenantId, args.assessmentId);
    requireScope(assessment);
    const item = requireItem(assessment, args.requirementId);
    const reason = required(
      args.reason,
      "Explain in English why the requirement does not apply.",
    );

    item.conclusion = reason;
    item.status = "not_applicable";
    item.completedAt = this.now().toISOString();
    this.touch(
      assessment,
      "requirement_not_applicable",
      `${item.ref}: not applicable.`,
    );

    if (
      assessment.requirements.every((entry) => !OPEN_STATUSES.has(entry.status))
    ) {
      assessment.phase = "review";
    }
    this.persist();

    return {
      ...base(assessment),
      requirement: requirementSummary(item),
      progress: progressOf(assessment),
      next_actions: nextForPhase(assessment),
      language_policy: LANGUAGE_POLICY,
    };
  }

  review(tenantId, args) {
    const assessment = this.get(tenantId, args.assessmentId);
    requireScope(assessment);
    const open = assessment.requirements.filter((item) =>
      OPEN_STATUSES.has(item.status),
    );
    if (open.length > 0) {
      throw new AgentError(
        `${open.length} requirements still need evidence or a conclusion.`,
        {
          code: "requirements_open",
          details: open.slice(0, 10).map((item) => ({
            requirementId: item.id,
            ref: item.ref,
            status: item.status,
          })),
        },
      );
    }

    assessment.phase = "export";
    assessment.reviewedAt = this.now().toISOString();
    this.touch(assessment, "reviewed", "Assessment reviewed.");
    this.persist();
    return {
      ...base(assessment),
      summary: reviewSummary(assessment),
      progress: progressOf(assessment),
      next_actions: [
        action("export_assessment", "Generate the English audit package.", {
          assessmentId: assessment.id,
        }),
      ],
      language_policy: LANGUAGE_POLICY,
    };
  }

  exportPackage(tenantId, args) {
    const assessment = this.get(tenantId, args.assessmentId);
    if (!assessment.reviewedAt) {
      throw new AgentError("Review the assessment before exporting it.", {
        code: "review_required",
      });
    }

    assessment.phase = "complete";
    assessment.exportedAt = this.now().toISOString();
    this.touch(assessment, "exported", "Audit package generated.");
    this.persist();

    const requirements = assessment.requirements.map((item) => ({
      ref: item.ref,
      title: item.title,
      description: item.description,
      status: item.status,
      conclusion: item.conclusion,
      evidence: item.evidence.map((evidence) => ({
        title: evidence.title,
        type: evidence.type,
        source: evidence.source,
        summary: evidence.summary,
        citation: evidence.citation,
        collectedAt: evidence.collectedAt,
        hash: evidence.hash,
      })),
    }));
    const manifest = {
      format: "comply.agent-package/v1",
      generatedAt: assessment.exportedAt,
      language: "en",
      assessment: {
        id: assessment.id,
        name: assessment.name,
        framework: assessment.framework,
        scope: assessment.scope,
        periodFrom: assessment.periodFrom,
        periodTo: assessment.periodTo,
      },
      counts: progressOf(assessment),
    };
    const digest = createHash("sha256")
      .update(JSON.stringify({ manifest, requirements }))
      .digest("hex");

    return {
      ...base(assessment),
      manifest: { ...manifest, sha256: digest },
      requirements,
      progress: progressOf(assessment),
      next_actions: [
        action(
          "start_assessment",
          "Start another assessment or share the exported package with the auditor.",
        ),
      ],
      language_policy: LANGUAGE_POLICY,
    };
  }

  persist() {
    if (!this.dataFile) return;
    const payload = {
      version: 1,
      updatedAt: this.now().toISOString(),
      assessments: [...this.assessments.values()],
    };
    const task = () => writeJson(this.dataFile, payload);
    this.writeQueue = this.writeQueue
      .then(task, task)
      .catch((error) => console.error("Agent state save failed:", error));
  }

  touch(assessment, type, message) {
    assessment.revision += 1;
    assessment.updatedAt = this.now().toISOString();
    assessment.events.push({
      at: assessment.updatedAt,
      revision: assessment.revision,
      type,
      message,
    });
    if (assessment.events.length > 100) {
      assessment.events.splice(0, assessment.events.length - 100);
    }
  }
}

export const MCP_TOOLS = [
  {
    name: "get_agent_guide",
    title: "Get the guided assessment workflow",
    description:
      "Return the step-by-step journey and the language policy. Call this once when the user asks how the audit works. The agent speaks the user's language and publishes in English.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "start_assessment",
    title: "Start a guided assessment",
    description:
      "Create an assessment for one framework. If scope is omitted, the journey starts at the scope step. Returns progress, blockers, and next actions.",
    inputSchema: {
      type: "object",
      properties: {
        framework: { type: "string", enum: FRAMEWORKS },
        name: { type: "string", description: "Short English title." },
        scope: {
          type: "string",
          description: "Systems, locations, and boundaries in English.",
        },
        periodFrom: { type: "string", description: "ISO date, YYYY-MM-DD." },
        periodTo: { type: "string", description: "ISO date, YYYY-MM-DD." },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 2000,
          description:
            "How many requirements to include. Defaults to every requirement in the framework.",
        },
      },
      required: ["framework"],
      additionalProperties: false,
    },
  },
  {
    name: "list_assessments",
    title: "List assessments",
    description:
      "List the assessments of the current tenant, newest first, with pagination metadata.",
    inputSchema: {
      type: "object",
      properties: {
        page: { type: "integer", minimum: 1 },
        pageSize: { type: "integer", minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_assessment_state",
    title: "Get assessment state",
    description:
      "Read the phase, progress, blockers, and next actions. Call it after every user answer so the guidance stays current.",
    inputSchema: {
      type: "object",
      properties: { assessmentId: { type: "string" } },
      required: ["assessmentId"],
      additionalProperties: false,
    },
  },
  {
    name: "set_scope",
    title: "Confirm scope",
    description:
      "Store the English scope, systems, locations, and assessment period.",
    inputSchema: {
      type: "object",
      properties: {
        assessmentId: { type: "string" },
        scope: { type: "string" },
        periodFrom: { type: "string" },
        periodTo: { type: "string" },
      },
      required: ["assessmentId", "scope"],
      additionalProperties: false,
    },
  },
  {
    name: "get_brief",
    title: "Get the prioritized brief",
    description:
      "Return up to five requirements to work on, each with an English question to ask the user.",
    inputSchema: {
      type: "object",
      properties: { assessmentId: { type: "string" } },
      required: ["assessmentId"],
      additionalProperties: false,
    },
  },
  {
    name: "list_requirements",
    title: "List requirements",
    description:
      "Paginate the assessment checklist. Filter by status or search reference, title, description, and conclusion. Returns page_info with total_pages, next_page, and previous_page.",
    inputSchema: {
      type: "object",
      properties: {
        assessmentId: { type: "string" },
        status: {
          type: "string",
          enum: ["open", "evidence_collected", "completed", "not_applicable"],
        },
        query: { type: "string" },
        page: { type: "integer", minimum: 1 },
        pageSize: { type: "integer", minimum: 1, maximum: 100 },
      },
      required: ["assessmentId"],
      additionalProperties: false,
    },
  },
  {
    name: "search_requirements",
    title: "Search requirements by similarity",
    description:
      "Rank the assessment checklist by lexical similarity to an English query or to another requirement. Use it to find related controls, duplicates, or requirements that one artifact may cover. Translate the user's terms into English first.",
    inputSchema: {
      type: "object",
      properties: {
        assessmentId: { type: "string" },
        query: {
          type: "string",
          description:
            "English terms to search for, for example incident response.",
        },
        similarTo: {
          type: "string",
          description:
            "Requirement id to use as the reference text instead of a query.",
        },
        status: {
          type: "string",
          enum: ["open", "evidence_collected", "completed", "not_applicable"],
        },
        minScore: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description: "Minimum cosine similarity, default 0.05.",
        },
        page: { type: "integer", minimum: 1 },
        pageSize: { type: "integer", minimum: 1, maximum: 100 },
      },
      required: ["assessmentId"],
      additionalProperties: false,
    },
  },
  {
    name: "get_progress",
    title: "Track assessment progress",
    description:
      "Return completion counts by status and theme, the next open requirements, recent events, and the next action. Use it to report progress without fetching the full checklist.",
    inputSchema: {
      type: "object",
      properties: { assessmentId: { type: "string" } },
      required: ["assessmentId"],
      additionalProperties: false,
    },
  },
  {
    name: "get_requirement",
    title: "Get one requirement",
    description:
      "Return the requirement text, evidence already collected, and the question to ask the user.",
    inputSchema: {
      type: "object",
      properties: {
        assessmentId: { type: "string" },
        requirementId: { type: "string" },
      },
      required: ["assessmentId", "requirementId"],
      additionalProperties: false,
    },
  },
  {
    name: "submit_evidence",
    title: "Submit evidence",
    description:
      "Attach an artifact to a requirement. The summary must be in English and must state what the artifact shows. Never send credentials or raw secrets.",
    inputSchema: {
      type: "object",
      properties: {
        assessmentId: { type: "string" },
        requirementId: { type: "string" },
        title: { type: "string", description: "Short English title." },
        type: { type: "string", enum: EVIDENCE_TYPES },
        source: {
          type: "string",
          description: "System, team, or document the evidence comes from.",
        },
        summary: {
          type: "string",
          description: "English summary of the result shown by the evidence.",
        },
        citation: {
          type: "string",
          description:
            "URL, ticket, document id, or location the auditor can verify.",
        },
        collectedAt: { type: "string", description: "ISO timestamp." },
      },
      required: ["assessmentId", "requirementId", "title", "source", "summary"],
      additionalProperties: false,
    },
  },
  {
    name: "complete_requirement",
    title: "Complete a requirement",
    description:
      "Record the English conclusion and close the requirement. At least one evidence artifact is required.",
    inputSchema: {
      type: "object",
      properties: {
        assessmentId: { type: "string" },
        requirementId: { type: "string" },
        conclusion: {
          type: "string",
          description: "One or two English sentences grounded in the evidence.",
        },
        language: { type: "string", enum: ["en"] },
      },
      required: ["assessmentId", "requirementId", "conclusion"],
      additionalProperties: false,
    },
  },
  {
    name: "mark_not_applicable",
    title: "Mark a requirement not applicable",
    description:
      "Close a requirement that does not apply, with an English reason the auditor can review.",
    inputSchema: {
      type: "object",
      properties: {
        assessmentId: { type: "string" },
        requirementId: { type: "string" },
        reason: { type: "string" },
      },
      required: ["assessmentId", "requirementId", "reason"],
      additionalProperties: false,
    },
  },
  {
    name: "review_assessment",
    title: "Review the assessment",
    description:
      "Check that every requirement is complete and move the assessment to export.",
    inputSchema: {
      type: "object",
      properties: { assessmentId: { type: "string" } },
      required: ["assessmentId"],
      additionalProperties: false,
    },
  },
  {
    name: "export_assessment",
    title: "Export the audit package",
    description:
      "Return the English audit package with manifest, citations, hashes, and conclusions. The assessment must be reviewed first.",
    inputSchema: {
      type: "object",
      properties: { assessmentId: { type: "string" } },
      required: ["assessmentId"],
      additionalProperties: false,
    },
  },
];

export function mcpServerInfo() {
  return {
    name: "comply",
    version: "1.0.0",
    instructions:
      "Comply guides a compliance assessment. Speak to the user in their language. Publish all scope, evidence, conclusions, and exports in English. Call get_assessment_state after each answer and follow next_actions.",
  };
}

function guide() {
  return {
    workflow: WORKFLOW,
    phases: ["scope", "collect", "review", "export", "complete"],
    language_policy: LANGUAGE_POLICY,
    rules: [
      "Ask one question at a time and explain why it matters.",
      "Translate the user's answer into an English scope, evidence summary, and conclusion.",
      "Never invent evidence. A requirement needs at least one artifact before it can close.",
      "After every tool call, tell the user the new progress and the next step.",
      "Use search_requirements to find related controls or requirements that one artifact may cover.",
      "Use get_progress when the user asks for a status update; do not fetch the full checklist.",
      "Do not send credentials, tokens, or raw personal data in evidence.",
    ],
    start_prompt:
      "Start a NIS2 assessment for the systems I name. Ask me for the scope, then guide me through the evidence one requirement at a time.",
  };
}

function state(assessment) {
  return {
    ...base(assessment),
    scope: assessment.scope,
    content_status: assessment.contentStatus,
    progress: progressOf(assessment),
    blocked_by: blockers(assessment),
    next_actions: nextForPhase(assessment),
    language_policy: LANGUAGE_POLICY,
  };
}

function base(assessment) {
  return {
    assessment_id: assessment.id,
    name: assessment.name,
    framework: assessment.framework,
    status: assessment.phase,
    phase: assessment.phase,
    scope: assessment.scope,
    period: { from: assessment.periodFrom, to: assessment.periodTo },
    revision: assessment.revision,
    updated_at: assessment.updatedAt,
    content_status: assessment.contentStatus,
    language: assessment.language,
    events: assessment.events.slice(-10),
  };
}

function summary(assessment) {
  return {
    assessment_id: assessment.id,
    name: assessment.name,
    framework: assessment.framework,
    phase: assessment.phase,
    scope: assessment.scope,
    period: { from: assessment.periodFrom, to: assessment.periodTo },
    progress: progressOf(assessment),
    updated_at: assessment.updatedAt,
  };
}

function progressOf(assessment) {
  const total = assessment.requirements.length;
  const completed = assessment.requirements.filter(
    (item) => item.status === "completed",
  ).length;
  const notApplicable = assessment.requirements.filter(
    (item) => item.status === "not_applicable",
  ).length;
  const evidenceCollected = assessment.requirements.filter(
    (item) => item.status === "evidence_collected",
  ).length;
  const open = assessment.requirements.filter(
    (item) => item.status === "open",
  ).length;
  const evidence = assessment.requirements.reduce(
    (sum, item) => sum + item.evidence.length,
    0,
  );
  const closed = completed + notApplicable;
  return {
    total,
    completed,
    not_applicable: notApplicable,
    evidence_collected: evidenceCollected,
    open,
    evidence,
    percent: total === 0 ? 0 : Math.round((closed / total) * 100),
  };
}

function blockers(assessment) {
  if (assessment.phase === "scope" && !assessment.scope) return ["scope"];
  const open = assessment.requirements.filter((item) =>
    OPEN_STATUSES.has(item.status),
  );
  return open.length > 0 && assessment.phase === "review"
    ? ["requirements_open"]
    : [];
}

function reviewSummary(assessment) {
  const summary = progressOf(assessment);
  return {
    ...summary,
    reviewed_at: assessment.reviewedAt,
    message:
      "Every requirement has evidence or a not-applicable reason. The package is ready to export.",
  };
}

function requirementSummary(item) {
  return {
    requirement_id: item.id,
    ref: item.ref,
    title: item.title,
    description: item.description,
    status: item.status,
    evidence_count: item.evidence.length,
    conclusion: item.conclusion,
    completed_at: item.completedAt,
  };
}

function nextForItem(assessment, item) {
  if (item.status === "completed") {
    const next = assessment.requirements.find((entry) =>
      OPEN_STATUSES.has(entry.status),
    );
    return next
      ? [
          action("get_requirement", "Open the next requirement.", {
            assessmentId: assessment.id,
            requirementId: next.id,
          }),
        ]
      : [action("review_assessment", "All requirements are complete.")];
  }
  if (item.status === "evidence_collected") {
    return [
      action("complete_requirement", "Write the English conclusion.", {
        assessmentId: assessment.id,
        requirementId: item.id,
      }),
    ];
  }
  return [
    action("submit_evidence", "Record the artifact the user describes.", {
      assessmentId: assessment.id,
      requirementId: item.id,
    }),
  ];
}

function requireItem(assessment, requirementId) {
  const item = assessment.requirements.find(
    (entry) => entry.id === requirementId,
  );
  if (!item) {
    throw new AgentError(
      `Requirement ${requirementId} is not in this assessment.`,
      {
        code: "requirement_not_found",
      },
    );
  }
  return item;
}

function requireScope(assessment) {
  if (!assessment.scope) {
    throw new AgentError("Confirm the assessment scope first with set_scope.", {
      code: "scope_required",
      details: { assessmentId: assessment.id },
    });
  }
}

function required(value, message) {
  const text = String(value ?? "").trim();
  if (!text) {
    throw new AgentError(message, { code: "field_required" });
  }
  return text;
}

function periodOf(args, fallbackIso) {
  const year = new Date(fallbackIso).getUTCFullYear();
  const from = normalizeDate(args.periodFrom ?? `${year}-01-01`, "periodFrom");
  const to = normalizeDate(args.periodTo ?? `${year}-12-31`, "periodTo");
  if (from > to) {
    throw new AgentError("periodFrom must be before periodTo.", {
      code: "invalid_period",
    });
  }
  return { from, to };
}

function normalizeDate(value, field) {
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text))) {
    throw new AgentError(`${field} must be an ISO date (YYYY-MM-DD).`, {
      code: "invalid_date",
    });
  }
  return text;
}

function questionFor(item) {
  return `How does the organization meet ${item.ref} — ${item.title}? Ask for the control in place, the systems or locations it covers, where the evidence is stored, and how an auditor can verify it. Write the evidence summary and conclusion in English.`;
}

function nextForPhase(assessment) {
  switch (assessment.phase) {
    case "scope":
      return [
        action("set_scope", "Confirm the assessment scope in English.", {
          assessmentId: assessment.id,
          scope: "Systems, locations, and boundaries in English.",
        }),
      ];
    case "collect": {
      const first = assessment.requirements.find((item) =>
        OPEN_STATUSES.has(item.status),
      );
      return first
        ? [
            action(
              "get_requirement",
              "Open the next requirement and ask the user for evidence.",
              { assessmentId: assessment.id, requirementId: first.id },
            ),
          ]
        : [
            action(
              "review_assessment",
              "Move the completed assessment to review.",
              {
                assessmentId: assessment.id,
              },
            ),
          ];
    }
    case "review":
      return [
        action(
          "review_assessment",
          "Confirm the review and prepare the export.",
          {
            assessmentId: assessment.id,
          },
        ),
      ];
    case "export":
      return [
        action("export_assessment", "Generate the English audit package.", {
          assessmentId: assessment.id,
        }),
      ];
    default:
      return [];
  }
}

function action(tool, description, args = {}) {
  return { tool, description, arguments: args };
}

function pageInfo(total, page, pageSize) {
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  return {
    page,
    page_size: pageSize,
    total_items: total,
    total_pages: totalPages,
    has_next_page: page < totalPages,
    has_previous_page: page > 1,
    next_page: page < totalPages ? page + 1 : null,
    previous_page: page > 1 ? page - 1 : null,
  };
}

const SEARCH_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "have",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "this",
  "to",
  "was",
  "were",
  "with",
]);

function tokenize(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 2 && !SEARCH_STOPWORDS.has(term))
    .map(stem);
}

// Folds common English plural forms so "policy" matches "policies".
function stem(term) {
  if (term.length > 4 && term.endsWith("ies")) {
    return `${term.slice(0, -3)}y`;
  }
  if (term.length > 4 && /(?:ses|xes|zes|ches|shes)$/.test(term)) {
    return term.slice(0, -2);
  }
  if (term.length > 3 && term.endsWith("s") && !/(?:ss|us|sis)$/.test(term)) {
    return term.slice(0, -1);
  }
  return term;
}

function searchText(item) {
  return [item.ref, item.title, item.title, item.description, item.conclusion]
    .filter(Boolean)
    .join(" ");
}

function weightedVector(terms, idf) {
  const counts = new Map();
  for (const term of terms) {
    counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  const vector = new Map();
  let norm = 0;
  for (const [term, count] of counts) {
    const weight = (count / terms.length) * idf(term);
    vector.set(term, weight);
    norm += weight * weight;
  }
  const length = Math.sqrt(norm);
  if (length === 0) return vector;
  for (const [term, weight] of vector) {
    vector.set(term, weight / length);
  }
  return vector;
}

function cosine(left, right) {
  let score = 0;
  const [small, large] =
    left.size <= right.size ? [left, right] : [right, left];
  for (const [term, weight] of small) {
    score += weight * (large.get(term) ?? 0);
  }
  return score;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function frameworkLabel(framework) {
  switch (framework) {
    case "nis2":
      return "NIS2";
    case "iso27001":
      return "ISO/IEC 27001";
    case "ai-act":
      return "EU AI Act";
    default:
      return "Compliance";
  }
}

function isAssessment(value) {
  return (
    value &&
    typeof value.id === "string" &&
    typeof value.tenantId === "string" &&
    FRAMEWORKS.includes(value.framework) &&
    Array.isArray(value.requirements) &&
    Array.isArray(value.events) &&
    value.requirements.every(
      (item) =>
        typeof item.id === "string" &&
        typeof item.ref === "string" &&
        Array.isArray(item.evidence),
    )
  );
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}
