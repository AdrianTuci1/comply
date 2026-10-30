# Spec — platformă de dovezi pentru conformitate

## Scop

SaaS multi-tenant pentru verificarea conformității pe NIS2, ISO 27001 și EU AI Act. Clientul rulează propriul agent AI în infrastructura lui; platforma ține conținutul de conformitate, mașina de stări, validarea și dovezile.

Produsul nu certifică nimic. Produce dovezi verificabile, ciorne și un pachet de audit.

## Model de operare

Conectorii rulează unde sunt credențialele. Serverul nu apelează niciodată sistemele clientului și nu primește credențiale. Clientul trimite findings, comentarii și referințe de dovezi; serverul validează structura, proveniența și citările.

Trei moduri de livrare:

| Mod             | Cine rulează agentul            | Date la noi                 |
| --------------- | ------------------------------- | --------------------------- |
| SaaS            | harness-ul clientului, prin MCP | findings, comentarii, audit |
| Container local | clientul, offline               | opțional, prin sincronizare |
| Sigilat         | clientul, cu cheie proprie      | doar structură criptată     |

## Principii

- Credențialele rămân la client.
- Serverul e arbitru: validează, nu execută.
- Aplicabilitatea cerințelor se calculează determinist, cu reguli. Modelul lingvistic doar extrage și redactează.
- Fiecare răspuns are citare către un artefact real, altfel e respins.
- Conținutul e date versionate și semnate, distribuite separat de aplicație.
- Fiecare assessment fixează versiunea de conținut, ca rezultatul să fie reproductibil.

## Suprafețe

1. **Web (Angular)** — checklist, findings, comentarii, review, export.
2. **MCP** — Streamable HTTP, stare persistentă în `data/agents.json`, aceleași unelte ca UI-ul.
3. **Container local** — mod de operare pentru air-gapped și demonstrații.
4. **Conținut** — bundle-uri semnate în Blob, servite prin CDN.

## Trust center

Pagină publică, read-only, per tenant, servită pe subdomeniu propriu (`trust.<domeniu>`). Conține doar ce alege tenantul: practici de securitate, subprocesatori, politici descărcabile, data ultimei revizuiri, contact pentru chestionare.

Structura de prezentare rămâne constantă și urmează referința din `docs/reference/trust-center/`. Tenantul controlează din portal ce apare: fiecare dintre cele cinci categorii de controale poate fi redenumită sau ascunsă, iar subprocesatorii se publică individual. Pagina publică afișează doar secțiunile care au conținut publicat.

- Setările de prezentare stau în `TrustCenterSettings` (`categoryLabels`, `hiddenCategories`, `hiddenSubprocessors`) și se editează în `/portal/website`.
- Toate cerințele din bibliotecă folosesc cele cinci chei de categorie (`infrastructure`, `organizational`, `product`, `procedures`, `data_privacy`); denumirile afișate sunt doar prezentare, nu schimbă maparea.

- Topbar lipit sus, doar cu logo-ul încărcat de tenant (`logoUrl`). Nu afișează numele, inițialele, domeniul sau butoane ca text.
- Header de prezentare: imaginea mare încărcată de tenant (`headerUrl`) înlocuiește zona hero cu „Trust center / Trust, built on evidence". Fără text peste imagine. Dacă lipsește, hero-ul folosește textul implicit.
- Hero întunecat, apoi bară generală de navigare statică (nu rămâne lipită la derulare), cu acțiunile de abonare și cerere de acces la dreapta.
- Taburi: Overview, Resources, Controls, Subprocessors, Updates. Pagina publică este în engleză.
- Fiecare listă are căutare și paginare pe client. Resursele publice se deschid într-un document view în engleză, cu descărcare și deschidere în tab nou; resursele cu acces la cerere rămân în spatele formularului.
- Controalele păstrează sidebar-ul de categorii, dar afișează toate grupurile unul după altul; click pe categorie derulează la grup.

- Nicio afirmație generată automat. Fiecare claim e scris de tenant și, opțional, legat de o dovadă sau un certificat încărcat, cu emitent, dată și scop.
- Descrierile de control sunt provizorii până la maparea pe criteriile din bundle-urile de conformitate. Layout-ul și entitățile nu depind de textul final.
- „Certificat" apare doar cu documentul atașat. Altfel se folosește „aliniat cu" sau „în pregătire".
- Vizibilitate pe secțiune: public, la cerere după NDA, privat.
- Cererile de acces și abonare pregătesc un mesaj `mailto:` către contactul tenantului; pagina publică nu are backend și nu stochează date.
- Footer: „Publicat de <tenant>". Răspunderea pentru afirmații rămâne la tenant.

## Acces MCP și domeniu

Setările organizației expun accesul agenților și legarea domeniului public.

- Mod de operare `managed` sau `self_hosted`, cu endpoint-ul MCP calculat din slug ori din domeniul propriu.
- Chei API cu nume și drepturi (`read`, `evidence:write`, `admin`). Secretul complet este afișat o singură dată; se păstrează doar prefixul mascat. Cheile se pot revoca, iar lista rămâne pentru audit.
- Verificarea domeniului: înregistrare `CNAME` către `edge.comply.app` (managed) sau către ingress-ul clientului (self-hosted), plus `TXT` la `_comply.<domeniu>` cu tokenul generat. Statusurile sunt `unverified`, `pending`, `verified`.
- Pagina de publicare arată instrucțiunile DNS, tokenul, comenzile containerului în modul self-hosted și acțiunile de verificare/resetare. Demonstrația marchează verificarea local; producția interoghează DNS-ul prin resolverul Azure.
- Managed: CNAME către `edge.comply.app`; Comply servește `/t/<slug>`, emite certificatul și cache-uiește pagina.
- Self-hosted: același container servește portalul și pagina publică. `COMPLY_TRUST_HOST` plus `COMPLY_TRUST_SLUG` fac ca `/` pe domeniul de trust să redirecționeze la `/t/<slug>`; TLS se termină la ingress-ul clientului. Pagina Website afișează comanda și diferența față de managed.

## Bibliotecă de cerințe

Ecranul `/workspace/sources` expune biblioteca managed oferită de Comply. Utilizatorii nu pot adăuga surse și nu pot edita sau publica cerințe; pipeline-ul de ingest actualizează conținutul din publicațiile oficiale, automat sau manual. Biblioteca este globală, nu per tenant; planșele fixează versiunea de conținut la creare.

- Carduri pe framework cu numărul de surse și cerințe, fără acțiuni de editare.
- Tabel de surse: document, framework, versiune, licență, număr de cerințe, ultima actualizare. Selectarea unei surse filtrează cerințele.
- Tabel de cerințe: referință, titlu, text, temă, sursă, cu căutare, filtre pe framework și sursă, plus paginare.
- Nu există endpoint-uri de scriere pentru bibliotecă; `GET /api/library` este singura cale. Pipeline-ul din `content-pipeline.md` descarcă documentele publice și scrie în `data/`. `ContentLibraryRepository` are un adaptor HTTP pentru producție și unul in-memory pentru teste.
- Toate cerințele din framework intră în planșe și în assessment-ul agentului, inclusiv cele încă `draft` intern. Statusul rămâne intern; UI-ul nu îl expune ca acțiune.
- Fiecare sursă are un document capturat, cu SHA-256, data descărcării și link oficial. Modalul „Document” afișează articolele și textul extras, ca utilizatorul să compare cerința cu sursa.
- ISO/IEC 27001 nu se descarcă: operatorul instanței încarcă standardul în pipeline și publică lista derivată; clienții o primesc ca managed content.

## Autentificare

Pagina `/sign-in` este publică și acceptă trei căi: email + parolă, OIDC (Google,
Microsoft, GitHub sau un provider generic) și link pe email ca alternativă.

- Conturile locale stau în `data/users.json`, cu hash `scrypt` și sare per cont. O instalare
  nouă nu are conturi: pagina de sign-in afișează formularul de setup, iar primul cont creat
  devine `admin`; conturile ulterioare sunt `member`. Instalatorul de producție nu creează
  conturi. Pentru demo se pot folosi `COMPLY_SEED_EMAIL` / `COMPLY_SEED_PASSWORD`; în
  dezvoltare există `adrian@comply.ro` / `comply-demo`.
- `POST /api/auth/register` acceptă primul cont și returnează o sesiune; după setup răspunde
  403. `POST /api/auth/login` verifică parola și returnează o sesiune HMAC de 8 ore. Sesiunea
  stă în `localStorage`; ieșirea din cont o șterge.
- OIDC folosește authorization code + PKCE, `state` semnat și `nonce`. Callback-ul schimbă
  codul, verifică semnătura RS256 a `id_token` prin JWKS, apoi redirecționează în aplicație
  cu un cod de o singură folosință, schimbat prin `POST /api/auth/exchange`.
- GitHub este OAuth2: profilul și emailul verificat se citesc din API-ul GitHub.
- Providerii apar pe pagina de sign-in doar când există client id și secret. Lista și modul
  de deployment sunt expuse de `GET /api/runtime`.
- Linkul pe email rămâne disponibil; în dezvoltare răspunsul include tokenul, în producție
  livrarea trece prin `COMPLY_MAIL_WEBHOOK_URL`, altfel API-ul răspunde 503.
- Autentificarea nu blochează încă rutele din portal; ecranele demonstrative rămân accesibile.

## Flux

Intent → Scope → Sources → Gaps → Execution → Review → Export.

Fiecare răspuns de unealtă întoarce `state`, `blocked_by`, `next_actions`, `revision`. Harness-ul nu are nevoie de memorie între apeluri.

## Model de date

| Entitate           | Rol                                                                         |
| ------------------ | --------------------------------------------------------------------------- |
| `Tenant`           | firma client, izolare și cheie de criptare                                  |
| `Assessment`       | evaluare pe framework, perioadă și scope                                    |
| `FrameworkVersion` | versiunea de conținut aplicabilă                                            |
| `Requirement`      | articol sau control, cu text și sursă                                       |
| `Question`         | traducerea cerinței în ceva verificabil                                     |
| `Evidence`         | artefact: tip, sursă, timestamp, hash                                       |
| `EvidenceArtifact` | dovada deschisă din planșă: titlu, tip, sursă, hash, review și corp lizibil |
| `Finding`          | rezultatul verificării, cu dovezi legate                                    |
| `Comment`          | context uman pe element                                                     |
| `Review`           | acceptat, respins cu motiv, necesită om                                     |
| `InputRequest`     | acces, document, atestare sau decizie cerută clientului                     |
| `AuditEvent`       | jurnal append-only, cu lanț de hash                                         |

Schemele complete, cheile de partiție și regulile de criptare sunt în `data-model.md`.

## Contract MCP

- `create_assessment` — scope, framework, perioadă
- `get_assessment_state` — stare, progres, blocaje
- `get_brief` — maximum cinci acțiuni prioritare
- `list_items` / `get_item` — paginare și filtre
- `register_source` — metadată despre sursă, fără credențiale
- `submit_finding` — dovadă obligatorie
- `add_comment`
- `validate_item` — acceptat, respins, sau review uman
- `search_requirements` / `get_requirement` — graful de cunoștințe
- `export_package` — arhivă cu manifest și hash-uri

## Conținut

- Structură: `content/<framework>/<version>/` cu `framework.json`, `requirements/`, `questions/`, `changelog.md`.
- Distribuție: căi imutabile pe versiune, alias `latest` doar pentru manifest, semnătură cu identificator de cheie.
- Mapări cross-framework în `content/mappings/`, ca o dovadă să satisfacă mai multe cerințe.
- NIS2 și AI Act: text public, redistribuibil cu atribuire.
- ISO 27001 și SOC 2: formulări proprii și referințe la identificatori; textul standardului îl aduce clientul.

## Securitate

- OAuth 2.1 cu PKCE pentru MCP; Entra ca authorization server, APIM în față dacă lipsesc resource indicators.
- Izolare strictă pe tenant, cheie de date per tenant, criptare la nivel de câmp pentru text liber.
- Jurnal append-only cu lanț de hash; export verificabil.
- Retenție configurabilă, export și ștergere la cerere.
- Acces intern prin break-glass aprobat și jurnalizat.

## Stack

Angular, .NET 10 (ASP.NET Core cu adaptor Azure Functions), Azure Functions Flex Consumption, Cosmos DB serverless, Blob Storage, Key Vault, Entra ID, CDN.

Portabilitate: aplicația ca container ASP.NET Core, interfață de repository cu implementare Cosmos DB (NoSQL, serverless), OIDC, S3-compatible.

## Non-obiective v1

- Self-host complet pe AWS și GCP.
- Harness propriu de chat.
- Semnătură calificată.
- Facturare și abonamente.
- Mai mult de un framework implementat.

## Primul fir vertical

Un tenant, NIS2, zece cerințe, conector Entra, validator de citări, export de pachet, ecran de review.
