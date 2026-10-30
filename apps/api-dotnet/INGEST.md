# Content ingest (.NET)

Port of the Node ingest pipeline in `apps/api-node/lib/ingest/` (plus `html.mjs` and the
`applyIngest` part of `store.mjs`). It fetches the public NIS2 and AI Act mirrors, extracts one
requirement per numbered paragraph or lettered measure, captures a document snapshot with SHA-256,
and writes `library.json` plus `documents/<id>.json` under `COMPLY_DATA_DIR`.

## Layout

| File | Port of | Purpose |
| --- | --- | --- |
| `src/Comply.Functions/Ingest/HtmlText.cs` | `lib/html.mjs` | entity decoding, tag stripping, paragraph/normalisation helpers, `shortTitle`, `slugify`, class extraction/removal |
| `Ingest/IngestFetch.cs` | `lib/ingest/fetch.mjs` | `ITextFetcher`, `HttpTextFetcher` (UA, 30s attempts, 429/5xx retry with linear backoff), `MapLimitAsync` |
| `Ingest/IngestThemes.cs` | `lib/ingest/themes.mjs` | NIS2 keyword rules, AI Act article ranges |
| `Ingest/IngestSources.cs` | `lib/ingest/index.mjs` | source/document ids and index URLs |
| `Ingest/Nis2Ingest.cs` | `lib/ingest/nis2.mjs` | discovery + `ParseArticle` + `IngestAsync` |
| `Ingest/AiActIngest.cs` | `lib/ingest/ai-act.mjs` | discovery + `ParseArticle` + `IngestAsync` |
| `Ingest/IngestPipeline.cs` | `lib/ingest/index.mjs` | handler registry (`ai-act`, then `nis2`) and final ref dedupe |
| `Ingest/IngestStore.cs` | `lib/store.mjs applyIngest` | atomic apply, per-framework ref dedupe, document file, blob extension point |
| `Ingest/IngestCoordinator.cs` | `lib/api.mjs` ingest section | in-memory jobs, background runs, refresh schedule |
| `Ingest/IngestJobs.cs` | `lib/api.mjs` | job/schedule DTOs and `IngestScheduleOptions` |
| `Ingest/IngestSchedulerService.cs` | startup hook | optional `IHostedService` that calls `Start()` |

Both parsers expose pure functions (`DiscoverArticles`, `ParseArticle`) that take HTML strings, so
tests never need the network; `IngestAsync` takes an `IngestOptions` with an injectable
`ITextFetcher`.

## Behaviour kept identical to Node

- Article refs: `Art. N`, `Art. N(1)`, `Art. N(1)(a)`; requirement ids `req-nis2-<slug(ref)>` /
  `req-ai-act-<slug(ref)>`, status `draft`, `reviewer`/`reviewedAt` null, `createdAt` = fetch time.
- NIS2: heading `<b>Article N, Title</b>`, stop markers (`Understanding Article`, `Note:`,
  `Articles, Directive (EU)`), numbered items, lettered items (parent = last number), intro
  paragraph >= 30 chars, item length thresholds (20 for numbers/intro, 8 for letters), fallback to
  one `Art. N` requirement.
- AI Act: `<h1|h2 class="…item-heading…">`, `para depth-N` blocks, `para-label`, `para-text`,
  inline `term-tip` removal, depth 0 numbered refs, depth 1 lettered refs (first wins), fallback to
  `Art. N`, title cleanup of `Article N:` prefixes.
- Document text joins: `Article N, Title\n\n…` (NIS2) and `Article N: Title\n\n…` (AI Act);
  `sha256` is the lowercase hex of the UTF-8 text and `bytes` its UTF-8 length.
- Timestamps are ISO-8601 UTC with milliseconds (`2026-10-30T12:00:00.000Z`).
- Apply: replace source, drop that source's requirements, dedupe by lowercased `ref` **within the
  framework**, append new requirements, upsert document metadata (without `pages`), write
  `documents/<id>.json` then `library.json` through a `.tmp` file + rename, then refresh the
  in-memory snapshot.
- Jobs: `id` (UUID), `framework`, `frameworks`, `status` (`running`/`succeeded`/`failed`),
  `startedAt`, `finishedAt`, `logs` (max 200, oldest dropped), `result`, `error`; list newest first.
- `POST /api/ingest` reuses an active job whose frameworks intersect the request.

## Environment variables

| Variable | Default | Effect |
| --- | --- | --- |
| `COMPLY_DATA_DIR` | `/home/data` on Azure, else `<repo>/data` | Where `library.json` and `documents/` are written |
| `COMPLY_INGEST_INTERVAL_HOURS` | `168` | Refresh interval. `<= 0` or non-numeric disables the schedule; floor is one minute |
| `COMPLY_INGEST_STARTUP_DELAY_SECONDS` | `30` | Delay before the first scheduled run |
| `COMPLY_INGEST_ON_START` | enabled | `0` skips the startup run and waits one full interval |

## Wiring

`Program.cs` registers `IngestStore`, `IngestPipeline` as `IIngestRunner`, `IngestCoordinator`
and `IngestSchedulerService`; the coordinator is injected into `ContentApi`, which owns the
`/api/ingest*` routes and reports unknown methods with `405`.

Response shapes (camelCase, produced by `JsonDefaults.Serializer`):

- `GET /api/ingest` → `200 {"jobs":[job,...]}` (newest first)
- `GET /api/ingest/schedule` → `200 {"schedule":{enabled,intervalHours,lastRunAt,lastFinishedAt,lastTrigger,lastStatus,lastError,lastResult,nextRunAt,running}}`
- `POST /api/ingest` → `202 {"job":job}`, or `400 {"error":"Unknown framework: iso27001."}`
- `GET /api/ingest/{id}` → `200 {"job":job}`, or `404 {"error":"Job not found."}`
- `job` = `{id,framework,frameworks,status,startedAt,finishedAt,logs:[{at,message}],result:[{framework,sourceId,requirements,pages}],error}`

## Extension point

`IngestStore` accepts an optional `IIngestBlobSink`; after the local writes it mirrors
`documents/<id>.json` and `library.json` (Node writes to Blob Storage when configured). A failing
sink is ignored, like the Node `.catch(warn)`. No Azure Blob implementation is included yet.

## Tests

```bash
docker run --rm -v "$PWD":/src -w /src/apps/api-dotnet \
  mcr.microsoft.com/dotnet/sdk:8.0 dotnet test --filter "FullyQualifiedName~Comply.Functions.Tests.Ingest"
```

All ingest tests are offline: parsers take HTML fixtures, `IngestAsync` takes a fake `ITextFetcher`,
and the coordinator uses fake runners plus a `TimeProvider` with manual timers.

## Known deviations

- `InvariantGlobalization` makes `string.Normalize(FormD)` a no-op, so `slugify` folds Latin-1 and
  Latin Extended-A letters through a table; with ICU available the full NFD path is used.
- The .NET job runner supports cancellation: a host shutdown marks the running job `failed` with
  the cancellation message (Node simply loses the job).
- Requirement refs that are null are treated as `""` during dedupe instead of throwing.
