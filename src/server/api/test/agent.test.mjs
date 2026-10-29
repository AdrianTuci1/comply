import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { AgentError, AgentRegistry, MCP_TOOLS } from "../lib/agent.mjs";

function fakeStore() {
  return {
    snapshot: () => ({
      sources: [],
      documents: [],
      requirements: [
        {
          id: "req-1",
          sourceId: "src-1",
          frameworkId: "nis2",
          ref: "Art. 21(2)(a)",
          title: "Risk analysis policies",
          text: "Approve and review risk analysis policies.",
          theme: "organizational",
          status: "published",
        },
        {
          id: "req-2",
          sourceId: "src-1",
          frameworkId: "nis2",
          ref: "Art. 21(2)(b)",
          title: "Incident management",
          text: "Detect, report, and respond to incidents.",
          theme: "procedures",
          status: "published",
        },
      ],
    }),
  };
}

function registry() {
  let tick = 0;
  return new AgentRegistry({
    store: fakeStore(),
    now: () => new Date(Date.parse("2026-10-29T10:00:00Z") + tick++ * 1000),
    idFactory: () => `id-${tick++}`,
  });
}

test("guides scope, evidence, review, and export", () => {
  const agents = registry();
  const start = agents.call("nordwind", "start_assessment", {
    framework: "nis2",
    limit: 2,
  });

  assert.equal(start.phase, "scope");
  assert.deepEqual(start.blocked_by, ["scope"]);
  assert.equal(start.next_actions[0].tool, "set_scope");
  assert.equal(start.language_policy.publishLanguage, "en");

  assert.throws(
    () =>
      agents.call("nordwind", "submit_evidence", {
        assessmentId: start.assessment_id,
        requirementId: "req-1",
        title: "Policy",
        source: "SharePoint",
        summary: "Approved policy.",
      }),
    (error) => error instanceof AgentError && error.code === "scope_required",
  );

  const scoped = agents.call("nordwind", "set_scope", {
    assessmentId: start.assessment_id,
    scope: "Production Azure subscription.",
    periodFrom: "2026-01-01",
    periodTo: "2026-12-31",
  });
  assert.equal(scoped.phase, "collect");
  assert.equal(scoped.next_actions[0].tool, "get_requirement");

  const brief = agents.call("nordwind", "get_brief", {
    assessmentId: start.assessment_id,
  });
  assert.equal(brief.brief.length, 2);
  assert.match(brief.brief[0].question, /Ask for the control/);

  assert.throws(
    () =>
      agents.call("nordwind", "complete_requirement", {
        assessmentId: start.assessment_id,
        requirementId: "req-1",
        conclusion: "The policy is approved.",
      }),
    (error) =>
      error instanceof AgentError && error.code === "evidence_required",
  );

  const evidence = agents.call("nordwind", "submit_evidence", {
    assessmentId: start.assessment_id,
    requirementId: "req-1",
    title: "Access control policy",
    type: "document",
    source: "SharePoint",
    summary: "The approved policy covers all production systems.",
    citation: "https://sharepoint.example/policy",
  });
  assert.equal(evidence.requirement.status, "evidence_collected");
  assert.match(evidence.evidence.hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(evidence.next_actions[0].tool, "complete_requirement");

  assert.throws(
    () =>
      agents.call("nordwind", "complete_requirement", {
        assessmentId: start.assessment_id,
        requirementId: "req-1",
        conclusion: "Politica este aprobată.",
        language: "ro",
      }),
    (error) =>
      error instanceof AgentError && error.code === "language_required",
  );

  const first = agents.call("nordwind", "complete_requirement", {
    assessmentId: start.assessment_id,
    requirementId: "req-1",
    conclusion: "The access control policy is approved and reviewed annually.",
    language: "en",
  });
  assert.equal(first.progress.completed, 1);
  assert.equal(first.progress.percent, 50);
  assert.equal(first.next_actions[0].tool, "get_requirement");

  agents.call("nordwind", "mark_not_applicable", {
    assessmentId: start.assessment_id,
    requirementId: "req-2",
    reason: "No incidents were recorded in the assessment period.",
  });

  const review = agents.call("nordwind", "review_assessment", {
    assessmentId: start.assessment_id,
  });
  assert.equal(review.phase, "export");
  assert.equal(review.summary.total, 2);

  const exported = agents.call("nordwind", "export_assessment", {
    assessmentId: start.assessment_id,
  });
  assert.equal(exported.phase, "complete");
  assert.equal(exported.manifest.format, "comply.agent-package/v1");
  assert.match(exported.manifest.sha256, /^[0-9a-f]{64}$/);
  assert.equal(exported.requirements[0].conclusion.length > 0, true);
});

test("includes every managed requirement by default, including extracted ones", () => {
  const requirements = ["Art. 1", "Art. 2", "Art. 3"].map((ref, index) => ({
    id: `req-${index}`,
    sourceId: "src-1",
    frameworkId: "nis2",
    ref,
    title: `Requirement ${index + 1}`,
    text: `Managed text ${index + 1}.`,
    theme: "organizational",
    status: index === 2 ? "draft" : "published",
  }));
  const agents = new AgentRegistry({
    store: { snapshot: () => ({ sources: [], documents: [], requirements }) },
  });

  const start = agents.call("nordwind", "start_assessment", {
    framework: "nis2",
    scope: "Production systems.",
  });

  assert.equal(start.progress.total, 3);
});

test("keeps the brief within five items and blocks review while requirements are open", () => {
  const agents = registry();
  const start = agents.call("nordwind", "start_assessment", {
    framework: "nis2",
    scope: "All production systems.",
    limit: 2,
  });

  const brief = agents.call("nordwind", "get_brief", {
    assessmentId: start.assessment_id,
  });
  assert.ok(brief.brief.length <= 5);

  assert.throws(
    () =>
      agents.call("nordwind", "review_assessment", {
        assessmentId: start.assessment_id,
      }),
    (error) =>
      error instanceof AgentError && error.code === "requirements_open",
  );
});

test("restores assessments and evidence after a restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "comply-agent-"));
  const dataFile = join(directory, "agents.json");

  try {
    const first = new AgentRegistry({ store: fakeStore(), dataFile });
    await first.init();
    const start = first.call("nordwind", "start_assessment", {
      framework: "nis2",
      scope: "Production systems.",
      limit: 1,
    });
    first.call("nordwind", "submit_evidence", {
      assessmentId: start.assessment_id,
      requirementId: "req-1",
      title: "Access control policy",
      source: "SharePoint",
      summary: "The approved policy covers all production systems.",
    });
    first.call("nordwind", "complete_requirement", {
      assessmentId: start.assessment_id,
      requirementId: "req-1",
      conclusion: "The policy is approved and reviewed annually.",
    });
    await first.flush();

    const second = new AgentRegistry({ store: fakeStore(), dataFile });
    await second.init();
    const restored = second.detail("nordwind", start.assessment_id);
    assert.equal(restored.items[0].status, "completed");
    assert.equal(restored.items[0].evidence.length, 1);
    assert.equal(restored.progress.percent, 100);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("paginates assessments and checklist pages", () => {
  const agents = registry();
  const first = agents.call("nordwind", "start_assessment", {
    framework: "nis2",
    scope: "Production systems.",
    limit: 2,
  });
  agents.call("nordwind", "start_assessment", {
    framework: "nis2",
    scope: "Corporate systems.",
    limit: 2,
  });

  const assessments = agents.call("nordwind", "list_assessments", {
    page: 1,
    pageSize: 1,
  });
  assert.equal(assessments.assessments.length, 1);
  assert.equal(assessments.total, 2);
  assert.equal(assessments.page_info.total_pages, 2);
  assert.equal(assessments.page_info.has_next_page, true);
  assert.equal(assessments.page_info.next_page, 2);

  const pageOne = agents.call("nordwind", "list_requirements", {
    assessmentId: first.assessment_id,
    page: 1,
    pageSize: 1,
  });
  assert.equal(pageOne.items.length, 1);
  assert.equal(pageOne.total, 2);
  assert.equal(pageOne.page_info.total_pages, 2);
  assert.equal(pageOne.page_info.next_page, 2);
  assert.equal(pageOne.page_info.has_previous_page, false);

  const pageTwo = agents.call("nordwind", "list_requirements", {
    assessmentId: first.assessment_id,
    page: 2,
    pageSize: 1,
  });
  assert.notEqual(
    pageTwo.items[0].requirement_id,
    pageOne.items[0].requirement_id,
  );
  assert.equal(pageTwo.page_info.has_next_page, false);
  assert.equal(pageTwo.page_info.previous_page, 1);
});

test("ranks requirements by similarity and reports progress", () => {
  const requirements = [
    {
      id: "req-risk",
      sourceId: "src-1",
      frameworkId: "nis2",
      ref: "Art. 1",
      title: "Risk analysis policies",
      text: "Approve and review risk analysis policies every year.",
      theme: "organizational",
      status: "published",
    },
    {
      id: "req-incident",
      sourceId: "src-1",
      frameworkId: "nis2",
      ref: "Art. 2",
      title: "Incident management",
      text: "Detect, report, and respond to security incidents.",
      theme: "procedures",
      status: "published",
    },
    {
      id: "req-risk-review",
      sourceId: "src-1",
      frameworkId: "nis2",
      ref: "Art. 3",
      title: "Annual risk review",
      text: "Review the risk analysis policy at management level.",
      theme: "organizational",
      status: "published",
    },
  ];
  const agents = new AgentRegistry({
    store: { snapshot: () => ({ sources: [], documents: [], requirements }) },
    idFactory: (() => {
      let tick = 0;
      return () => `search-${tick++}`;
    })(),
  });
  const start = agents.call("nordwind", "start_assessment", {
    framework: "nis2",
    scope: "Production systems.",
  });

  const search = agents.call("nordwind", "search_requirements", {
    assessmentId: start.assessment_id,
    query: "risk analysis policy",
  });
  assert.equal(search.items[0].requirement_id, "req-risk");
  assert.equal(search.items[0].score > 0, true);
  assert.ok(search.items[0].matched_terms.includes("risk"));
  assert.ok(
    search.items.every((item) => item.requirement_id !== "req-incident"),
  );
  assert.equal(search.page_info.total_items, search.total);

  const similar = agents.call("nordwind", "search_requirements", {
    assessmentId: start.assessment_id,
    similarTo: "req-risk",
    pageSize: 1,
  });
  assert.equal(similar.similar_to, "req-risk");
  assert.equal(similar.items[0].requirement_id, "req-risk-review");
  assert.equal(similar.page_info.has_next_page, false);

  agents.call("nordwind", "submit_evidence", {
    assessmentId: start.assessment_id,
    requirementId: "req-risk",
    title: "Risk policy",
    source: "SharePoint",
    summary: "The risk analysis policy is approved and reviewed annually.",
  });
  agents.call("nordwind", "complete_requirement", {
    assessmentId: start.assessment_id,
    requirementId: "req-risk",
    conclusion: "The risk analysis policy is approved and reviewed annually.",
  });

  const progress = agents.call("nordwind", "get_progress", {
    assessmentId: start.assessment_id,
  });
  assert.equal(progress.progress.total, 3);
  assert.equal(progress.progress.completed, 1);
  assert.equal(progress.by_status.completed, 1);
  assert.equal(progress.by_status.open, 2);
  assert.equal(
    progress.by_theme.find((theme) => theme.theme === "organizational")
      .completed,
    1,
  );
  assert.equal(progress.remaining.length, 2);
  assert.equal(progress.next_actions[0].tool, "get_requirement");
});

test("keeps the MCP contract in sync with the tool registry", async () => {
  const contract = JSON.parse(
    await readFile(
      new URL("../../../../contracts/mcp/tools.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(MCP_TOOLS, contract.tools);
});

test("isolates assessments by tenant", () => {
  const agents = registry();
  const start = agents.call("nordwind", "start_assessment", {
    framework: "nis2",
    scope: "Production systems.",
    limit: 2,
  });

  assert.deepEqual(agents.list("helios"), []);
  assert.throws(
    () =>
      agents.call("helios", "get_assessment_state", {
        assessmentId: start.assessment_id,
      }),
    (error) => error instanceof AgentError && error.code === "not_found",
  );
});
