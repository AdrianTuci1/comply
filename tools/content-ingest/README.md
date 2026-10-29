# content-ingest

Extrage cerințe din documente oficiale, le supune revizuirii umane și construiește
bundle-uri versionate cu manifest SHA-256.

Documentația completă, inclusiv regulile de licențiere și testul cu Docker, este în
[`.agents/content-pipeline.md`](../../.agents/content-pipeline.md).

## Comenzi rapide

```bash
npm install

# 1. Extrage un document în drafts/
node cli.mjs extract --framework nis2 --source ../../content/_sources/nis2/directiva.pdf

# 2. Completează reviewedText în draft, apoi promovează
node cli.mjs promote --framework nis2 --draft nis2-art-21-2-a --reviewer "Ana Popescu"

# 3. Validează și construiește
node cli.mjs validate --all
node cli.mjs build --all

# 4. Inspectează starea
node cli.mjs list
```

Teste:

```bash
npm test
```
