# Model de date

## Principii

- Un document per agregat, cu `docType` ca discriminator în container.
- `tenantId` apare în fiecare document și în cheia de partiție.
- Concurrency optimistă prin `revision` și ETag.
- ID-uri ULID, ordonate temporal, utile pentru paginare în Cosmos.
- Câmpurile sensibile au `payload` criptat și `keyId`; restul rămân interogabile.
- Ștergerea e logică (`deletedAt`), cu job de purjare după retenție.

## Containere

| Container     | Cheie de partiție | Documente                                           |
| ------------- | ----------------- | --------------------------------------------------- |
| `tenants`     | `/tenantId`       | tenant, user, agent, claim                          |
| `assessments` | `/tenantId`       | assessment                                          |
| `items`       | `/tenantId`       | item, comment, review, input_request, finding       |
| `evidence`    | `/tenantId`       | evidence                                            |
| `audit`       | `/tenantId`       | audit events                                        |
| `content`     | `/frameworkId`    | framework, requirement, question, mapping, manifest |
| `counters`    | `/id`             | idempotență, secvențe, TTL scurt                    |

## Entități de tenant

```ts
Tenant {
  id: string                  // ULID
  tenantId: string            // = id
  docType: "tenant"
  name: string
  cui: string
  contact: { name: string; email: string; phone?: string }
  createdAt: string           // ISO 8601 UTC
  status: "active" | "suspended" | "closed"
  plan: "free" | "team" | "enterprise"
  sealedMode: boolean
  crypto: {
    kekId: string
    keyVersion: number
    provider: "internal" | "customer_kms"
  }
  settings: {
    locale: "ro" | "en"
    timezone: string
    retentionDays: number
    evidenceStorage: "hash_only" | "encrypted"
  }
  trustPage?: {
    enabled: boolean
    domain: string
    visibility: "public" | "nda"
    logoUrl?: string            // imagine încărcată de tenant, afișată singură în header
  }
}

User {
  id: string
  tenantId: string
  docType: "user"
  oid: string                 // subject din IdP
  email: string
  name: string
  roles: ("owner" | "admin" | "reviewer" | "contributor" | "auditor")[]
  status: "active" | "invited" | "disabled"
  createdAt: string
  lastSeenAt?: string
}

Agent {
  id: string
  tenantId: string
  docType: "agent"
  name: string
  clientId: string
  scopes: string[]
  createdBy: string
  createdAt: string
  status: "active" | "revoked"
  lastUsedAt?: string
  model?: { vendor: string; name: string; version: string }
}

TrustClaim {
  id: string
  tenantId: string
  docType: "claim"
  category: "infrastructure" | "organizational" | "product" | "procedures" | "data_privacy"
  title: string
  body: string
  visibility: "public" | "nda" | "private"
  evidenceIds: string[]
  approvedBy: string
  approvedAt: string
}

TrustResource {
  id: string
  tenantId: string
  docType: "trust_resource"
  category: "documents" | "privacy"
  title: string
  description: string
  gated: boolean             // true = acces la cerere
  updatedAt: string
}

Subprocessor {
  id: string
  tenantId: string
  docType: "subprocessor"
  name: string
  purpose: string
  region: string
}

TrustUpdate {
  id: string
  tenantId: string
  docType: "trust_update"
  title: string
  body: string
  tag: "general" | "security" | "subprocessors" | "privacy"
  publishedAt: string
}

ComplianceProfile {
  id: string
  tenantId: string
  docType: "compliance_profile"
  frameworkId: "nis2" | "iso27001" | "ai-act"
  status: "aligned" | "in_progress" | "not_started"
  note: string
  since: string
}
```

`TrustResource`, `Subprocessor`, `TrustUpdate` și `ComplianceProfile` alimentează taburile publice. Textul lor este conținut editorial al tenantului; maparea pe criterii se face prin pipeline-ul de conținut, fără a schimba schema de prezentare.

## Assessment

```ts
Assessment {
  id: string
  tenantId: string
  docType: "assessment"
  frameworkId: "nis2" | "iso27001" | "ai-act"
  frameworkVersion: string
  contentBundleHash: string     // fixează conținutul folosit
  period: { from: string; to: string }
  scope: {
    entityType?: string
    sector?: string
    systems: string[]
    locations: string[]
    exclusions: { id: string; reason: string }[]
  }
  status: "draft" | "in_progress" | "in_review" | "complete" | "archived"
  revision: number
  createdBy: string
  createdAt: string
  updatedAt: string
  stats: {
    total: number
    accepted: number
    proposed: number
    gaps: number
    expired: number
    notApplicable: number
  }
}
```

## Elemente de checklist

```ts
Item {
  id: string
  tenantId: string
  docType: "item"
  assessmentId: string
  requirementId: string
  requirementHash: string       // detectează schimbarea cerinței
  questionId: string
  status: ItemStatus
  ownerId?: string
  conclusion?: {
    text?: string               // mod controlat
    payload?: EncryptedEnvelope // mod sigilat
    by: string
    at: string
    requirementVersion: string
  }
  evidenceIds: string[]
  validUntil?: string
  staleReason?: "requirement_changed" | "evidence_expired" | "scope_changed"
  lease?: { agentId: string; expiresAt: string }
  revision: number
  updatedAt: string
}

type ItemStatus =
  | "not_started"
  | "in_progress"
  | "proposed"
  | "in_review"
  | "accepted"
  | "rejected"
  | "not_applicable"

EncryptedEnvelope {
  alg: "A256GCM"
  keyId: string
  nonce: string
  ciphertext: string
}
```

## Dovezi

```ts
Evidence {
  id: string
  tenantId: string
  docType: "evidence"
  assessmentId: string
  itemId: string
  type: "api_report" | "document" | "attestation" | "screenshot" | "log_export"
  source: {
    system: string              // "azure" | "entra" | "github" | "aws" | "manual"
    checkId: string
    query?: string
    toolVersion: string
  }
  hash: string                  // SHA-256
  size?: number
  period?: { from: string; to: string }
  collectedAt: string
  storage: "hash_only" | "blob"
  blob?: { path: string; encrypted: boolean; keyId?: string; alg?: string }
  submittedBy: { agentId?: string; userId?: string }
  signature?: { alg: "HMAC-SHA256" | "Ed25519"; keyId: string; value: string }
  reviewStatus: "pending" | "accepted" | "rejected"
  body?: string                 // text lizibil pentru viewer; absent la hash_only
}
```

Read model-ul din UI (`domain/compliance/evidence-artifact.ts`) păstrează câmpurile necesare planșei și viewer-ului: `id`, `organizationId`, `boardId`, `itemId`, `title`, `type`, `source`, `collectedAt`, `submittedBy`, `hash`, `reviewStatus`, `body`. `body` este textul deschis în modal; în producție poate fi înlocuit cu un URL semnat către blob fără a schimba componenta.

## Activitate pe element

```ts
Comment {
  id: string
  tenantId: string
  docType: "comment"
  assessmentId: string
  itemId: string
  author: { type: "user" | "agent"; id: string }
  at: string
  body?: string
  payload?: EncryptedEnvelope
  visibility: "internal" | "reviewer"
}

Review {
  id: string
  tenantId: string
  docType: "review"
  assessmentId: string
  itemId: string
  reviewerId: string
  decision: "accepted" | "rejected" | "changes_requested"
  reason?: string
  at: string
  revisionBefore: number
  revisionAfter: number
}

InputRequest {
  id: string
  tenantId: string
  docType: "input_request"
  assessmentId: string
  itemId: string
  kind: "access_grant" | "document" | "attestation" | "decision"
  why: string                   // cerința acoperită
  format?: string
  dueAt?: string
  status: "open" | "fulfilled" | "waived" | "expired"
  fulfilledBy?: string
}

Finding {
  id: string
  tenantId: string
  docType: "finding"
  assessmentId: string
  itemId: string
  severity: "low" | "medium" | "high" | "critical"
  description: string
  remediation?: string
  ownerId?: string
  dueAt?: string
  status: "open" | "in_progress" | "closed" | "risk_accepted"
  createdAt: string
  closedAt?: string
}
```

## Jurnal de audit

```ts
AuditEvent {
  id: string
  tenantId: string
  docType: "audit"
  seq: number                   // monoton per tenant
  at: string
  actor: {
    type: "user" | "agent" | "system"
    id: string
    agentId?: string
    model?: string
  }
  action: string                // "item.accepted", "evidence.submitted"
  target: { type: string; id: string }
  requestId: string
  ip?: string
  meta?: Record<string, unknown>  // fără conținut sensibil
  hashPrev: string
  hashSelf: string
}
```

`hashSelf = SHA-256(hashPrev ‖ JSON canonic eveniment)`. Verificarea lanțului se face la export și la cerere.

## Bibliotecă de cerințe (UI)

Read model pentru ecranul `/workspace/sources`, înainte de promovarea în fișierele canonice din `content/`.

```ts
ContentSource {
  id: string
  frameworkId: "nis2" | "iso27001" | "ai-act"
  title: string
  publisher: string
  version: string
  kind: "pdf" | "docx" | "html" | "markdown" | "text"
  license: "public" | "proprietary"
  importedAt: string
  lastReviewedAt: string | null
}

ContentRequirement {
  id: string
  sourceId: string
  frameworkId: "nis2" | "iso27001" | "ai-act"
  ref: string                  // "Art. 21(2)(a)", "A.5.1"
  title: string
  text: string                 // textul sursă la ingest; revizuit înainte de publicare
  theme: TrustCategory         // infrastructure | organizational | product | procedures | data_privacy
  status: "draft" | "in_review" | "published"
  reviewer: string | null
  reviewedAt: string | null
  createdAt: string
}
```

Statusul sursei se derivă din cerințele ei: `published` când toate sunt publicate, `in_review` când există cerințe publicate sau în review, altfel `draft`.

### Document capturat

Pipeline-ul păstrează textul descărcat, ca recenzorul să poată compara cerința cu sursa.

```ts
SourceDocument {
  id: string                   // "doc-ai-act-2024-1689"
  sourceId: string
  frameworkId: "nis2" | "ai-act"
  title: string
  url: string                  // indexul folosit de conector
  officialUrl?: string         // EUR-Lex, pentru verificare
  publisher?: string
  license?: "public" | "proprietary"
  fetchedAt: string
  sha256: string
  bytes: number
  pages: SourceDocumentPage[]
}

SourceDocumentPage {
  ref: string                  // "Art. 13"
  title: string
  url: string
  text: string
}
```

Metadatele intră în `data/library.json`; paginile stau în `data/documents/<id>.json`. Seed-ul
din `src/server/api/seed/` are aceeași structură și este citit când `data/` nu există.

## Sesiuni

Autentificarea folosește tokenuri semnate HMAC, fără tabelă de sesiuni.

```ts
MagicLinkPayload {
  kind: "magic"
  email: string
  exp: number                  // 15 minute
}

SessionPayload {
  kind: "session"
  email: string
  exp: number                  // 8 ore
}
```

Cheia vine din `COMPLY_AUTH_SECRET`. Dacă lipsește, API-ul generează una la pornire, iar
sesiunile nu supraviețuiesc restartului. Linkul se trimite prin
`COMPLY_MAIL_WEBHOOK_URL`; în dezvoltare răspunsul include tokenul.

## Conținut

```ts
Framework {
  id: string                    // "nis2/2024.1.0"
  frameworkId: string
  version: string
  docType: "framework"
  title: string
  effectiveFrom: string
  source: string
  license: "public" | "proprietary"
  hash: string
}

Requirement {
  id: string
  frameworkId: string
  version: string
  docType: "requirement"
  ref: string                   // "21-2-h"
  title: string
  text: string                  // formulare proprie pentru ISO/SOC 2
  theme: string
  sourceRef?: string
}

Question {
  id: string
  frameworkId: string
  version: string
  docType: "question"
  requirementRef: string
  question: string
  evidenceType: "api" | "document" | "attestation"
  cadence: "continuous" | "monthly" | "quarterly" | "annual" | "per_event"
  verifier?: string
  threshold?: string
}

Mapping {
  id: string
  docType: "mapping"
  from: { frameworkId: string; ref: string }
  to: { frameworkId: string; ref: string }[]
  rationale: string
}

Manifest {
  id: string
  docType: "manifest"
  frameworkId: string
  version: string
  hash: string
  signature: { alg: string; keyId: string; value: string }
  publishedAt: string
}
```

## Relații

```
Tenant 1─n Assessment
Assessment 1─n Item
Item 1─n Evidence
Item 1─n Comment
Item 1─n Review
Item 1─n InputRequest
Item 0─n Finding
Assessment ─n Requirement (prin Item)
Requirement 1─n Question
Requirement n─n Requirement (prin Mapping)
```

## Ce se criptează

| Câmp                                       | Mod controlat           | Mod sigilat           |
| ------------------------------------------ | ----------------------- | --------------------- |
| `Tenant.name`, `cui`, `contact`            | clar                    | clar                  |
| `Assessment.scope`, `stats`                | clar                    | clar                  |
| `Item.status`, `staleReason`, `validUntil` | clar                    | clar                  |
| `Item.conclusion.text`                     | clar, criptat la repaus | `payload`             |
| `Comment.body`                             | clar, criptat la repaus | `payload`             |
| `Finding.description`                      | clar                    | `payload`             |
| `Evidence.hash`, `source`, `collectedAt`   | clar                    | clar                  |
| `Evidence.blob`                            | criptat                 | criptat, cheie client |
| `AuditEvent`                               | clar                    | clar                  |

## Note Cosmos

- Toate interogările includ `tenantId`, impus în repository, niciodată din request.
- Indexuri compuse: `items(assessmentId, status)`, `evidence(itemId)`, `audit(seq)`.
- Comentariile sunt documente separate, ca să nu atingi limita de 2 MB pe item.
- TTL pe `counters` pentru idempotență, 24 de ore.
- `revision` crește la fiecare scriere; conflictul întoarce 409 cu starea curentă.
- Exporturile și pachetele de audit stau în Blob, cu ștergere după 30 de zile.
- Ștergerea tenantului marchează documentele, apoi un job le purjează după retenție.
