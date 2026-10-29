# Documente sursă

Aici se pun documentele oficiale folosite pentru extragere (PDF, DOCX, TXT, MD, HTML).
Fișierele sunt ignorate de git: conținutul licențiat (de exemplu ISO/IEC 27001) nu se
distribuie prin repository.

Fluxul este:

```bash
node tools/content-ingest/cli.mjs extract \
  --framework nis2 \
  --source content/_sources/nis2/directiva-2022-2555.pdf \
  --document "Directiva (UE) 2022/2555"
```

Drafturile ajung în `content/<framework>/<versiune>/drafts/` și sunt ignorate de git.
Un recenzor completează `reviewedText` în formulare proprie, apoi rulează:

```bash
node tools/content-ingest/cli.mjs promote \
  --framework nis2 \
  --draft nis2-art-21-2-a \
  --reviewer "Nume Recenzor"
```

Doar cerințele promovate ajung în bundle-ul public. Fluxul complet, inclusiv regulile
pentru surse licențiate și testul cu Docker, este în `.agents/content-pipeline.md`.
