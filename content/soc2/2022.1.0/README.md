# SOC 2 Trust Services Criteria

Curated starter checklist covering the Security common criteria (CC1–CC9),
Availability (A1), Processing Integrity (PI1), Confidentiality (C1), and Privacy
(P1–P8). It has 61 criteria and is intended as a practical starting point, not a
complete audit programme.

## Licensing

The AICPA Trust Services Criteria are licensed material. This folder contains only
short criterion titles, official references, and original summaries written by the
Comply content team. It does not contain AICPA text. Every entry is marked
`review.reformulated = true` and stays in `draft` until a named reviewer approves
it.

Customers must obtain the criteria from the AICPA. The source document is not
stored in this repository.

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
`src-soc2-2022`. Existing AI Act and NIS2 entries are preserved in each file; only
the curated SOC 2 source is replaced.

The content-ingest validator still expects `requirements/<id>.json` files for
bundles. SOC 2 content is therefore validated by the checklist builder, which
checks required fields, unique references, text length, and the
`reformulated` flag; it is not exported through `tools/content-ingest/cli.mjs`.
