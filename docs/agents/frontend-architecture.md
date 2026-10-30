# Arhitectura frontend

Aplicația Angular este împărțită pe bounded contexts. Fiecare context are aceleași patru layere, iar dependențele merg într-o singură direcție: `presentation → application → domain`; infrastructura implementează porturile din domain.

```
src/app/
├─ shared-kernel/            # Entity, ValueObject, Result, DomainError
├─ domain/                   # reguli de business, fără Angular
│  ├─ organization/          # Organization, TrustCenterSettings, ContactPerson
│  ├─ team/                  # Member, Role
│  ├─ compliance/            # AssessmentBoard, ChecklistItem, BoardProgress,
│  │                         # ItemWorkflow, FrameworkRef, AssessmentPeriod,
│  │                         # EvidenceArtifact
│  ├─ access/                # McpAccess, McpApiKey, DomainVerification
│  ├─ content/               # ContentSource, ContentRequirement
│  └─ trust/                 # TrustClaim, resurse, subprocesatori, actualizări,
│                             # profiluri de conformitate
├─ application/              # use case-uri și read model cu signals
│  ├─ organization.store.ts
│  ├─ member.store.ts
│  ├─ compliance.facade.ts
│  ├─ content-library.facade.ts
│  ├─ mcp-access.facade.ts
│  ├─ session.store.ts       # sesiunea semnată, persistată în localStorage
│  ├─ trust-center.facade.ts
│  └─ ports/                 # serializare, fișiere, auth, documente sursă, storage
├─ infrastructure/           # adapters
│  ├─ in-memory/             # repository-uri + fixtures pentru teste
│  ├─ http/                  # bibliotecă, documente sursă și auth prin /api
│  └─ browser/               # JSON codec, download, FileReader, localStorage
├─ features/                 # presentation, pe suprafețe de produs
│  ├─ auth/sign-in           # pagină publică: parolă, OIDC, link pe email
│  ├─ portal/{dashboard,users,website,settings}
│  ├─ workspace/{boards,board-detail,sources}
│  └─ trust/                 # shell + taburi: overview, resources, controls,
│                             # subprocessors, updates, dialog de acces
├─ shared/                   # UI kit + i18n + formatare
└─ layout/                   # shell autentificat, stare pentru drawer-ul mobil
```

## Reguli

| Regulă                                                               | Motiv                                                        |
| -------------------------------------------------------------------- | ------------------------------------------------------------ |
| `domain/` nu importă Angular, DOM sau `infrastructure/`              | regulile pot fi testate fără browser și refolosite pe server |
| componentele nu accesează repository-uri                             | UI-ul depinde doar de application services                   |
| un aggregate se modifică doar prin metodele lui                      | contoarele și statusurile rămân consistente                  |
| porturile stau în `application/ports`, adapters în `infrastructure/` | schimbarea persistentei nu atinge UI-ul                      |
| legăturile se fac în `app.providers.ts`                              | un singur composition root                                   |
| etichetele în română stau în `shared/i18n`                           | domeniul rămâne independent de limbă                         |

## Pattern-uri folosite

| Pattern                | Unde                                                                                                                      | Efect                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Aggregate root         | `AssessmentBoard`                                                                                                         | checklist, status și progres se schimbă atomic                   |
| Entity                 | `ChecklistItem`, `EvidenceArtifact`, `McpApiKey`, `Member`, `Organization`, `TrustClaim`                                  | identitate stabilă, mutatoare imutabile                          |
| Value Object           | `AssessmentPeriod`, `BoardProgress`, `FrameworkRef`, `TrustCenterSettings`, `DomainVerification`, `ContactPerson`         | validare la creare, egalitate prin valoare                       |
| Factory                | `AssessmentBoard.create`, `AssessmentBoard.importCopy`, `Member.invite`                                                   | regulile de creare într-un singur loc                            |
| State machine          | `ItemWorkflow`                                                                                                            | tranzițiile permise sunt un tabel, verificat de domeniu și de UI |
| Strategy / catalog     | `FRAMEWORK_CATALOG`                                                                                                       | versiune și număr de cerințe per framework                       |
| Repository             | `*Repository` + `InMemory*Repository` + `HttpContentLibraryRepository`                                                    | domeniul nu știe de Cosmos sau HTTP                              |
| Port & Adapter         | `BoardSerializer`, `FileDownloader`, `FileTextReader`, `AuthGateway`, `SourceDocumentGateway`, `ContentLibraryRepository` | browserul și backendul sunt detalii înlocuibile                  |
| Cache hidratat la boot | `HttpContentLibraryRepository.hydrate` + `provideAppInitializer`                                                          | facade-ul rămâne sincron, iar UI-ul nu pornește cu date goale    |
| Facade                 | `ComplianceFacade`, `McpAccessFacade`, `TrustCenterFacade`                                                                | use case-uri simple pentru componente                            |
| Result                 | import, invitații, tranziții respinse                                                                                     | erorile așteptate sunt explicite, fără excepții în UI            |
| Read model cu signals  | stores și facade-uri                                                                                                      | actualizare reactivă fără stare duplicată                        |

## Conținut și autentificare

- `app.config.ts` înlocuiește adaptorul in-memory cu `HttpContentLibraryRepository` și
  `HttpSourceDocumentGateway`; testele folosesc `APP_PROVIDERS` cu adaptoarele in-memory.
- Un `provideAppInitializer` așteaptă `hydrate()` înainte de prima randare. Dacă API-ul nu
  răspunde, adaptorul revine la fixtures și scrie un avertisment în consolă.
- Modificările din review se aplică optimist în UI și se trimit prin `POST`/`PUT`; backendul
  serialează scrierile.
- `SessionStore` ține tokenul și utilizatorul în `localStorage`; topbarul citește sesiunea, iar
  ieșirea din cont revine la `/sign-in`.

## Fluxul unei acțiuni

1. Componenta apelează un use case (`compliance.changeItemStatus`).
2. Facade-ul încarcă aggregate-ul din repository și aplică metoda de domeniu.
3. Domeniul validează tranziția, regula de dovezi și actualizează progresul.
4. Facade-ul salvează agregatul și înlocuiește valoarea din signal.
5. Toate suprafețele care citesc signal-ul se actualizează.

Erorile de business (de exemplu acceptarea fără dovezi) se întorc ca `Result` și sunt afișate lângă acțiune.
