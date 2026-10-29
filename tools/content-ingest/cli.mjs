#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildBundles } from './src/build.mjs';
import { extractToDrafts } from './src/extract-drafts.mjs';
import { FRAMEWORK_IDS, frameworkConfig } from './src/frameworks.mjs';
import { promoteDraft } from './src/promote.mjs';
import { listBundles, loadBundle, validateAll } from './src/validate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');
const CONTENT_ROOT = resolve(process.env.CONTENT_ROOT ?? join(REPO_ROOT, 'content'));
const CONTRACTS_ROOT = resolve(process.env.CONTRACTS_ROOT ?? join(REPO_ROOT, 'contracts'));

const HELP = `content-ingest — extrage cerințe din documente oficiale, cu revizuire umană.

Utilizare:
  node tools/content-ingest/cli.mjs <comandă> [opțiuni]

Comenzi:
  extract    Extrage un document în drafturi pentru revizuire.
  promote    Transformă un draft revizuit în cerință și întrebare.
  validate   Validează schemele, referințele și regulile de licențiere.
  build      Copiază conținutul promovat într-un bundle cu manifest SHA-256.
  list       Arată bundle-urile, numărul de cerințe și drafturile.

Opțiuni comune:
  --content <dir>       rădăcina content/ (implicit: ./content)
  --contracts <dir>     rădăcina contracts/ (implicit: ./contracts)
  --framework <id>      ${FRAMEWORK_IDS.join(' | ')}
  --version <ver>       versiunea bundle-ului (implicit: cea din framework)
  --json                rezultat pentru automatizare

extract:
  --source <fișier>     PDF, DOCX, TXT, MD sau HTML
  --document <nume>     numele afișat în sourceRef
  --dry-run             afișează drafturile fără să scrie fișiere
  --force               suprascrie drafturile existente

promote:
  --draft <id>          id-ul draftului din content/<framework>/<versiune>/drafts/
  --reviewer <nume>     recenzorul care își asumă textul (obligatoriu)
  --text <text>         textul revizuit (alternativă la reviewedText din draft)
  --text-file <fișier>  textul revizuit dintr-un fișier
  --title <titlu>       suprascrie titlul
  --ref <referință>     suprascrie referința
  --theme <temă>        suprascrie tema
  --id <slug>           suprascrie id-ul generat
  --question <text>     întrebarea de dovezi
  --evidence <tip>      api | document | attestation
  --cadence <ritm>      continuous | monthly | quarterly | annual | per_event
  --reformulated        confirmă rescrierea (obligatoriu la surse licențiate)
  --no-question         nu genera întrebarea de dovezi

validate:
  --all                 validează toate bundle-urile (implicit)

build:
  --out <dir>           directorul de ieșire (implicit: ./dist/content)
  --published-at <iso>  data din manifest (implicit: acum)
`;

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (token === '--') {
      args._.push(...argv.slice(index + 1));
      break;
    }
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const [rawKey, inline] = token.slice(2).split('=');
    const key = rawKey.trim();
    if (inline !== undefined) {
      args[key] = inline;
      continue;
    }
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      args[key] = next;
      index++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function required(args, key, hint) {
  const value = args[key];
  if (!value || value === true) throw new Error(`Lipsește --${key}${hint ? ` (${hint})` : ''}.`);
  return String(value);
}

async function countDrafts(contentRoot, frameworkId, version) {
  const dir = join(contentRoot, frameworkConfig(frameworkId).dir, version, 'drafts');
  try {
    return (await readdir(dir)).filter((file) => file.endsWith('.json')).length;
  } catch {
    return 0;
  }
}

async function commandExtract(args) {
  const frameworkId = required(args, 'framework', FRAMEWORK_IDS.join(' | '));
  const source = required(args, 'source', 'PDF, DOCX, TXT, MD sau HTML');
  const result = await extractToDrafts({
    contentRoot: resolve(args.content ?? CONTENT_ROOT),
    frameworkId,
    sourcePath: resolve(source),
    document: args.document,
    version: args.version,
    force: Boolean(args.force),
    dryRun: Boolean(args['dry-run']),
  });

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          framework: frameworkId,
          version: result.version,
          document: result.documentLabel,
          candidates: result.candidateCount,
          written: result.written.map((entry) => entry.id),
          skipped: result.skipped.map((entry) => entry.id),
          warnings: result.warnings,
          drafts: args['dry-run'] ? result.drafts : undefined,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (args['dry-run']) {
    console.log(JSON.stringify(result.drafts, null, 2));
    return;
  }

  console.log(
    `${result.framework.label} ${result.version}: ${result.candidateCount} candidați, ${result.written.length} drafturi scrise.`,
  );
  console.log(`Drafturi: ${result.draftsRoot}`);
  if (result.skipped.length > 0) {
    console.log(`${result.skipped.length} drafturi existau deja și au fost păstrate (folosește --force pentru suprascriere).`);
  }
  for (const warning of result.warnings) console.log(`avertisment: ${warning}`);
  console.log('Următorul pas: completează reviewedText în drafturi, apoi rulează promote.');
}

async function commandPromote(args) {
  const frameworkId = required(args, 'framework');
  const draftId = required(args, 'draft', 'id-ul din drafts/');
  const reviewer = required(args, 'reviewer', 'numele recenzorului');
  let text = args.text === true ? undefined : args.text;
  if (args['text-file']) text = await readFile(resolve(String(args['text-file'])), 'utf8');
  if (text) text = String(text).trim();

  const result = await promoteDraft({
    contentRoot: resolve(args.content ?? CONTENT_ROOT),
    frameworkId,
    draftId: String(draftId),
    reviewer: String(reviewer),
    version: args.version,
    overrides: {
      text,
      title: args.title === true ? undefined : args.title,
      ref: args.ref === true ? undefined : args.ref,
      theme: args.theme === true ? undefined : args.theme,
      id: args.id === true ? undefined : args.id,
      question: args.question === true ? undefined : args.question,
      evidence: args.evidence,
      cadence: args.cadence,
      reformulated: Boolean(args.reformulated),
      noQuestion: Boolean(args['no-question']),
    },
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Promovat: ${result.requirement.id} (${result.requirement.ref})`);
  console.log(`Cerință:  ${result.requirementPath}`);
  console.log(`Întrebare: ${result.questionPath ?? '—'}`);
  console.log('Rulează validate înainte de build.');
}

async function commandValidate(args) {
  const result = await validateAll({
    contentRoot: resolve(args.content ?? CONTENT_ROOT),
    contractsRoot: resolve(args.contracts ?? CONTRACTS_ROOT),
    frameworkId: args.framework,
    version: args.version,
    log: args.json ? () => {} : (message) => console.log(message),
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const bundle of result.results) {
      const status = bundle.errors.length === 0 ? 'OK' : 'EȘEC';
      console.log(
        `${status} ${bundle.source}: ${bundle.counts.requirements} cerințe, ${bundle.counts.questions} întrebări.`,
      );
    }
    console.log(
      `Total: ${result.errors.length} erori, ${result.warnings.length} avertismente.`,
    );
  }

  if (result.errors.length > 0) process.exitCode = 1;
}

async function commandBuild(args) {
  const outRoot = resolve(args.out ?? join(REPO_ROOT, 'dist/content'));
  const result = await buildBundles({
    contentRoot: resolve(args.content ?? CONTENT_ROOT),
    contractsRoot: resolve(args.contracts ?? CONTRACTS_ROOT),
    outRoot,
    frameworkId: args.framework,
    version: args.version,
    publishedAt:
      typeof args['published-at'] === 'string' ? args['published-at'] : undefined,
    log: args.json ? () => {} : (message) => console.log(message),
  });

  if (args.json) {
    console.log(JSON.stringify({ outRoot, built: result.built, skipped: result.skipped }, null, 2));
    return;
  }

  console.log(`Bundle-uri construite în ${outRoot}.`);
  if (result.skipped.length > 0) {
    console.log(`Sar peste (fără cerințe): ${result.skipped.join(', ')}.`);
  }
  console.log('Manifestele nu sunt semnate. Semnarea se face la publicare, cu cheia din afara repo-ului.');
}

async function commandList(args) {
  const contentRoot = resolve(args.content ?? CONTENT_ROOT);
  const bundles = await listBundles(contentRoot);
  const rows = [];
  for (const descriptor of bundles) {
    const bundle = await loadBundle(descriptor);
    const drafts = await countDrafts(contentRoot, descriptor.frameworkId, descriptor.version);
    rows.push({
      id: `${descriptor.frameworkId}/${descriptor.version}`,
      title: bundle.framework.title,
      license: bundle.framework.license,
      requirements: bundle.requirements.length,
      questions: bundle.questions.length,
      drafts,
    });
  }

  if (args.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (rows.length === 0) {
    console.log('Nu există bundle-uri de conținut.');
    return;
  }
  for (const row of rows) {
    console.log(
      `${row.id}  ${row.title}  [${row.license}]  ${row.requirements} cerințe, ${row.questions} întrebări, ${row.drafts} drafturi`,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];

  if (!command || command === 'help' || args.help) {
    console.log(HELP);
    return;
  }

  switch (command) {
    case 'extract':
      await commandExtract(args);
      break;
    case 'promote':
      await commandPromote(args);
      break;
    case 'validate':
      await commandValidate(args);
      break;
    case 'build':
      await commandBuild(args);
      break;
    case 'list':
      await commandList(args);
      break;
    default:
      throw new Error(`Comandă necunoscută: ${command}. Rulează cu --help.`);
  }
}

main().catch((error) => {
  console.error(`Eroare: ${error.message}`);
  process.exitCode = 1;
});
