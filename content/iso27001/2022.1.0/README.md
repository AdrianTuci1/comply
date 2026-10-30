# ISO/IEC 27001:2022 — Annex A

Curated checklist for the 93 Annex A controls (A.5.1–A.8.34).

## Licensing

ISO/IEC 27001 is a licensed standard. This folder contains only short control
titles, official clause references, and original implementation summaries written
by the Comply content team. It does not contain standard text. Every entry is
marked `review.reformulated = true` and stays in `draft` until a named reviewer
approves it.

Customers must obtain the standard from ISO or their national standards body.
The source document is not stored in this repository.

## Data layout

The requirements live in `checklist.json` rather than one file per requirement.
The checklist is the reviewable input: each entry carries `ref`, `title`, `text`,
`theme`, `sourceRef`, `status`, and its review metadata. Run the builder to merge
it into the library served by the API:

```bash
node tools/build-library.mjs
```

The builder writes both `data/library.json` (runtime) and
`apps/api-node/seed/library.json` (shipped seed). Requirements reference
`src-iso27001-2022`. Existing AI Act and NIS2 entries are preserved in each file;
only the curated ISO source is replaced.

The content-ingest validator still expects `requirements/<id>.json` files for
bundles. Annex A content is therefore validated by the checklist builder, which
checks required fields, unique references, text length, and the
`reformulated` flag; it is not exported through `tools/content-ingest/cli.mjs`.
