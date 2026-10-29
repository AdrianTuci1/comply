# MCP tools — guided assessment

Comply exposes an MCP server over Streamable HTTP at `/mcp`. The agent connects with an
API key, starts an assessment, and follows the `next_actions` returned by every tool
call. The server keeps the assessment state; the agent does not need memory between
calls.

## Language policy

The user can speak any language. The agent replies in that language and writes the
canonical answers in English:

- `scope` is stored in English.
- Evidence `summary` is stored in English.
- Requirement `conclusion` is stored in English.
- The exported package is English.

Each response includes:

```json
{
  "language_policy": {
    "userLanguage": "any",
    "publishLanguage": "en",
    "instruction": "Reply to the user in the language they use. Write every scope, evidence summary, conclusion, and export in English."
  }
}
```

## Connect

```json
{
  "mcpServers": {
    "comply": {
      "type": "http",
      "url": "http://localhost:8080/mcp",
      "headers": {
        "Authorization": "Bearer sk_mcp_nordwind_<64 hex characters>"
      }
    }
  }
}
```

The key created in **Settings → MCP access and API keys** carries the tenant in its
`sk_mcp_<tenant>_…` prefix. The API derives the tenant from the key, rejects a key whose
tenant does not match the request, and accepts no other tenant header. A key is valid
only for the tenant that created it.

## Guided journey

| Phase     | Agent does                                             | Tool                   |
| --------- | ------------------------------------------------------ | ---------------------- |
| `scope`   | Ask which systems, locations, and period are covered   | `set_scope`            |
| `collect` | Explain the next requirement and ask for evidence      | `get_brief`            |
| `collect` | Record the artifact, English summary, and citation     | `submit_evidence`      |
| `collect` | Write the English conclusion and close the requirement | `complete_requirement` |
| `review`  | Confirm that every requirement is closed               | `review_assessment`    |
| `export`  | Produce the package with hashes and citations          | `export_assessment`    |

`start_assessment` accepts `scope` directly when the user already named it. Without a
scope, the response is `phase: "scope"` and `blocked_by: ["scope"]`. By default the
assessment covers every managed requirement for the framework, including requirements
still marked `draft` internally; pass `limit` only for a focused sample.

## Response shape

Every tool returns the phase, `progress`, `next_actions`, and `revision`; tools that can
block also return `blocked_by`.

```json
{
  "assessment_id": "asm-1a2b3c4d",
  "phase": "collect",
  "scope": "Production Azure subscription and corporate identity provider.",
  "progress": {
    "total": 20,
    "completed": 4,
    "not_applicable": 1,
    "evidence_collected": 2,
    "open": 13,
    "evidence": 6,
    "percent": 25
  },
  "blocked_by": [],
  "next_actions": [
    {
      "tool": "get_requirement",
      "description": "Open the next requirement and ask the user for evidence.",
      "arguments": {
        "assessmentId": "asm-1a2b3c4d",
        "requirementId": "req-..."
      }
    }
  ],
  "revision": 9
}
```

The agent should call `get_assessment_state` after each user answer and then follow
`next_actions[0]`. Every mutation increments `revision`, so a harness can detect a stale
view.

## State and boards

Assessments are written to `data/agents.json` after every mutation and loaded when the
API starts. A restart keeps the scope, requirements, evidence, conclusions, hashes, and
timeline.

The same assessments appear in **Workspace → Assessment boards** under **Agent boards**.
Each card shows the phase, progress, evidence count, and open requirements. The board
view at `/workspace/boards/agent/:id` lists every requirement with its description,
English conclusion, evidence records, and the next action the agent will take. The
dashboard reads this state through:

- `GET /api/agent/boards`
- `GET /api/agent/boards/:id`
- `GET /api/agent/assessments/:id` (full requirements and evidence)

## Tools

| Tool                   | Purpose                                                      |
| ---------------------- | ------------------------------------------------------------ |
| `get_agent_guide`      | Workflow, rules, and language policy                         |
| `start_assessment`     | Create an assessment for `nis2`, `iso27001`, or `ai-act`     |
| `list_assessments`     | Reconnect to a previous run                                  |
| `get_assessment_state` | Phase, progress, blockers, next actions                      |
| `set_scope`            | English scope and period                                     |
| `get_brief`            | Up to five prioritized requirements and questions            |
| `list_requirements`    | Paginated checklist with filters                             |
| `search_requirements`  | Similarity search by query or by another requirement         |
| `get_progress`         | Status and theme progress, remaining work, and next action   |
| `get_requirement`      | Requirement text, existing evidence, and the question to ask |
| `submit_evidence`      | Artifact with English summary, citation, and SHA-256         |
| `complete_requirement` | English conclusion; requires at least one artifact           |
| `mark_not_applicable`  | English reason for an out-of-scope requirement               |
| `review_assessment`    | Blocked while any requirement is open                        |
| `export_assessment`    | English package with manifest hash                           |

## Pagination, search, and progress

`list_assessments` and `list_requirements` accept `page` (from 1) and `pageSize` (1–100,
default 25). Both return `page_info`:

```json
{
  "page": 2,
  "page_size": 25,
  "total_items": 63,
  "total_pages": 3,
  "has_next_page": true,
  "has_previous_page": true,
  "next_page": 3,
  "previous_page": 1
}
```

`list_assessments` returns the tenant's newest assessments first, so an agent can
reconnect to a previous run. `list_requirements` also accepts `status` and a substring
`query` over the reference, title, description, and conclusion.

`search_requirements` ranks the checklist by lexical similarity. Pass either `query`
(English terms) or `similarTo` (a requirement id), never both. Optional `status` and
`minScore` (0–1, default 0.05) narrow the result. Each item adds `score` and
`matched_terms`; the response is paginated like the checklist.

```json
{
  "similar_to": "req-risk",
  "items": [
    {
      "requirement_id": "req-risk-review",
      "ref": "Art. 3",
      "title": "Annual risk review",
      "status": "open",
      "score": 0.71,
      "matched_terms": ["risk", "analysis", "policy"]
    }
  ],
  "page_info": { "page": 1, "total_items": 1, "total_pages": 1 }
}
```

The ranking uses term frequency and inverse document frequency (TF-IDF) with cosine
similarity over English text. Common plural forms are folded, so `policy` matches
`policies`. It is a lexical ranking: it finds shared wording and related controls, and
does not require an embedding model or external service.

`get_progress` returns the same `progress` object used by every tool, plus a breakdown
by status and theme, the next open requirements, recent events, and the next action.
Use it when the user asks how the assessment is going, instead of fetching the full
checklist.

```json
{
  "progress": { "total": 20, "completed": 8, "open": 10, "percent": 45 },
  "by_status": {
    "open": 10,
    "evidence_collected": 2,
    "completed": 8,
    "not_applicable": 0
  },
  "by_theme": [
    {
      "theme": "organizational",
      "total": 6,
      "completed": 3,
      "open": 3,
      "percent": 50
    }
  ],
  "remaining": [
    { "ref": "Art. 5", "title": "Access control", "status": "open" }
  ],
  "next_actions": [
    { "tool": "get_requirement", "arguments": { "requirementId": "req-..." } }
  ]
}
```

## Guardrails

- A requirement cannot be accepted without evidence.
- A conclusion marked with a language other than `en` is rejected.
- `review_assessment` fails while requirements are open and lists them.
- `export_assessment` requires a review.
- Assessments are isolated by tenant.
- Evidence must not contain credentials or raw personal data. Store a citation to the
  customer system instead.

## Example exchange

1. User: “Vreau un audit NIS2 pentru infrastructura de producție.”
2. Agent calls `start_assessment({ framework: "nis2" })`.
3. Agent asks in Romanian for systems, locations, and period.
4. Agent calls `set_scope` with the English translation.
5. Agent calls `get_brief`, explains the first requirement in Romanian, and asks where
   the evidence is stored.
6. Agent calls `submit_evidence` with an English summary and the link to the policy.
7. Agent calls `complete_requirement` with the English conclusion.
8. Agent reports: “4 din 20 cerințe închise, 25%.” The same progress is visible in
   **Workspace → Agent guide**.

## Local check

```bash
curl -s -X POST http://127.0.0.1:4300/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```
