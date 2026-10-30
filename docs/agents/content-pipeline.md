# Pipeline de conținut

Cerințele nu se scriu de mână în cod. Se extrag din documentele oficiale, trec printr-o
poartă de revizuire umană și abia apoi devin conținut public, versionat și cu manifest.

```
document oficial          drafti locali            conținut public
PDF / DOCX / HTML   →   extract → review → promote → validate → build → bundle + manifest
```

Există două intrări în pipeline:

| Intrare                 | Rol                                                                 | Ieșire                                 |
| ----------------------- | ------------------------------------------------------------------- | -------------------------------------- |
| `apps/api-node/`       | descarcă documente publice, extrage cerințe, le servește interfeței | `data/library.json`, `data/documents/` |
| `tools/content-ingest/` | extrage din fișiere aduse manual, cu poartă de revizuire            | drafturi, cerințe, bundle-uri          |

API-ul este sursa citită de `/workspace/sources` și de modalul de document. Seed-ul din
`apps/api-node/seed/` este conținutul livrat inițial; `data/` este runtime și nu se commit.

## Pipeline servit de backend

`apps/api-node/` rulează cu Node 22+ și nu are dependențe npm.

```bash
cd apps/api-node
npm run list
npm run ingest -- --framework nis2
npm run ingest -- --framework ai-act
npm run ingest:seed
npm start
```

Conectorii descarcă indexul, apoi fiecare articol, cu concurență limitată și retry.
Rezultatul păstrează:

- snapshot-ul textului pe articole, cu SHA-256 și număr de bytes;
- linkul oficial EUR-Lex în metadate, chiar dacă textul a fost citit dintr-o oglindă;
- câte o cerință pentru paragrafele numerotate și literele relevante;
- tema de afișare, derivată determinist din articol și cuvinte-cheie;
- statusul `draft`; publicarea cere un recenzor numit.

| Framework     | Conector | Sursă                                               | Observație                     |
| ------------- | -------- | --------------------------------------------------- | ------------------------------ |
| EU AI Act     | `ai-act` | `artificialintelligenceact.eu/ai-act-explorer/`     | 119 pagini, ~1.000 cerințe     |
| NIS2          | `nis2`   | `nis-2-directive.com/NIS_2_Directive_Articles.html` | 46 pagini, ~400 cerințe        |
| ISO/IEC 27001 | —        | document adus de client                             | text licențiat, nu se descarcă |
| SOC 2         | —        | document adus de client                             | text licențiat, nu se descarcă |

EUR-Lex folosește AWS WAF și răspunde cu challenge la cereri automate. De aceea conectorii
citesc oglinda publică a textului oficial și păstrează linkul EUR-Lex pentru verificare.
Snapshot-ul și hash-ul fac diferența dintre „am citit un site” și „am un document versionat”.

Rutele API sunt documentate în `README.md`. `POST /api/ingest` creează un job în memorie;
`GET /api/ingest/:id` întoarce logul și rezultatul. Scrierile în bibliotecă sunt serializate,
ca două actualizări simultane să nu rupă fișierul JSON.

Instrumentul local stă în `tools/content-ingest/`. Nu are dependențe de Azure și rulează cu Node 22+.

## 1. Pregătește sursa

Documentele intră în `content/_sources/` și sunt ignorate de git. Conținutul licențiat
(ISO/IEC 27001, SOC 2) nu se distribuie prin repository. Pentru NIS2 și EU AI Act textul
este public, dar tot se păstrează local, ca să nu amestecăm sursa cu bundle-ul livrat.

```bash
mkdir -p content/_sources/nis2
cp ~/Downloads/directiva-2022-2555.pdf content/_sources/nis2/
```

Sunt acceptate PDF cu text selectabil, DOCX, TXT, Markdown și HTML. PDF-urile scanate au
nevoie de OCR înainte; extractorul nu inventează text.

## 2. Extrage drafturile

```bash
node tools/content-ingest/cli.mjs extract \
  --framework nis2 \
  --source content/_sources/nis2/directiva-2022-2555.pdf \
  --document "Directiva (UE) 2022/2555"
```

Rezultatul ajunge în `content/<framework>/<versiune>/drafts/`. Drafturile sunt ignorate
de git: conțin textul brut extras, inclusiv pentru sursele licențiate.

Fiecare draft are:

| Câmp              | Rol                                                   |
| ----------------- | ----------------------------------------------------- |
| `ref`             | referința oficială: `Art. 21(2)(a)`, `A.5.1`, `4.1`   |
| `title`           | titlu propus, editabil                                |
| `text`, `rawText` | textul extras, păstrat pentru comparație              |
| `reviewedText`    | textul rescris de recenzor; **acesta** devine cerința |
| `sourceRef`       | document, pagină și linie, pentru audit               |
| `theme`           | tema de afișare în planșe                             |
| `warnings`        | ce trebuie verificat înainte de promovare             |

Extractorul recunoaște structura fiecărui framework:

| Framework     | Titluri                    | Sub-elemente                   |
| ------------- | -------------------------- | ------------------------------ |
| NIS2          | `Articolul 21`, `Art. 21`  | paragrafe `1.` și litere `(a)` |
| ISO/IEC 27001 | clauze `4.1`, `A.5.1`      | —                              |
| EU AI Act     | `Articolul 9`, `Article 9` | paragrafe `1.` și litere `(a)` |

Dacă un document nu are titluri recunoscute, comanda se oprește cu un mesaj clar. Nu
generează o cerință uriașă din tot documentul.

## 3. Revizuire umană

Recenzorul deschide draftul, completează `reviewedText` în formulare proprie și corectează
`title`, `ref` sau `theme` dacă e nevoie. Pentru ISO, textul standardului nu se copiază.

```bash
node tools/content-ingest/cli.mjs promote \
  --framework nis2 \
  --draft nis2-art-21-2-a \
  --reviewer "Ana Popescu"
```

Pentru sursele licențiate, promovarea cere confirmarea explicită și trece printr-un test
de suprapunere: nicio secvență de 10 cuvinte din sursă și cel mult 60% din cuvinte
refolosite.

```bash
node tools/content-ingest/cli.mjs promote \
  --framework iso27001 \
  --draft iso-a-5-1 \
  --reviewer "Ana Popescu" \
  --reformulated
```

Testul este o plasă de siguranță, nu o opinie juridică. Răspunderea pentru formulare
rămâne la recenzor, iar numele și data intră în câmpul `review` al cerinței.

Promovarea scrie:

- `content/<framework>/<versiune>/requirements/<id>.json`
- `content/<framework>/<versiune>/questions/<id>.json`
- în draft, `review.status = "promoted"` și `review.requirementId`

Draftul nu se șterge: păstrează proveniența.

## 4. Validează

```bash
node tools/content-ingest/cli.mjs validate --all
```

Verificări:

- schema JSON pentru framework, cerință, întrebare și manifest;
- `id`-ul din fișier corespunde numelui fișierului;
- `frameworkId` și `version` corespund folderului;
- referințele sunt unice, iar textele nu sunt duplicate;
- fiecare întrebare indică o cerință existentă;
- sursele licențiate au `review.reformulated = true`;
- bundle-urile fără cerințe sau fără întrebări produc avertismente.

Comanda întoarce cod 1 la erori, ca să poată rula în CI.

## 5. Construiește bundle-ul

```bash
node tools/content-ingest/cli.mjs build --all
```

Ieșirea implicită este `dist/content/<framework>/<versiune>/`. Conține numai fișierele
promovate, plus `manifest.json` cu SHA-256 pentru fiecare fișier și un hash agregat al
listei. Manifestul nu se semnează aici: cheia de semnare stă în afara repo-ului, la pasul
de publicare.

Bundle-urile fără cerințe sunt sărite. Dacă niciun bundle nu are conținut, comanda eșuează.

## Test local cu Docker

```bash
docker compose --profile tools build
docker compose up -d comply
curl -fsS http://localhost:8080/healthz
curl -fsS http://localhost:8080/workspace/boards | head
```

Profilul `tools` este necesar doar pentru imaginea validatorului.

Containerul `comply` servește build-ul de producție, API-ul și `/mcp` din același proces
Node, cu fallback pentru rutele Angular. Nu rulează `ng serve`.

Validatorul rulează într-un container separat, cu `content/` montat:

```bash
docker compose run --rm content validate --all
docker compose run --rm content list
docker compose run --rm content build --all
```

Comenzile de mai sus folosesc `content/` și `contracts/` montate din repo. Pentru un bundle
temporar, rulează imaginea direct cu alte volume:

```bash
docker run --rm \
  -v /tmp/content:/app/content \
  -v "$PWD/contracts:/app/contracts:ro" \
  -v /tmp/dist:/app/dist/content \
  comply/content-ingest:local build --all
```

`build` scrie în `dist/content/` pe host, prin volumul montat. Imaginile sunt locale:
`comply/web:local` și `comply/content-ingest:local`.

Oprire:

```bash
docker compose down
```

## Limitări cunoscute

- Extragerea depinde de structura textului. Documentele reformatate sau scanate cer OCR și
  pot produce drafturi incomplete; poarta de revizuire prinde aceste cazuri.
- Verificarea de reformulare este euristică.
- API-ul servește biblioteca extrasă, nu bundle-urile semnate din `dist/content`. Următorul pas
  este ca publicarea să genereze bundle-ul și ca fiecare assessment să fixeze `contentVersion`.
- Extragerea depinde de structura HTML a oglinzilor. Dacă pagina se schimbă, conectorul
  trebuie actualizat; testele de parser prind regresiile de structură.
- Joburile de ingest stau în memoria procesului. Un restart API pierde progresul, dar
  biblioteca deja scrisă rămâne în `data/`.
