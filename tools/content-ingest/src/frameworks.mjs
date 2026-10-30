/**
 * Per-framework rules used by the extractor and the promoter.
 *
 * A framework is data, so adding a fourth standard means adding an entry here,
 * not changing the parser. Every entry declares:
 *  - how headings look (article, clause or annex control),
 *  - how sub-items look (letters / numbered paragraphs),
 *  - which licence the source carries,
 *  - defaults for the generated evidence question.
 */

const NIS2_THEMES = [
  ['Guvernanță și risc', ['politic', 'risc', 'guvernan', 'conducere', 'responsabil', 'strateg']],
  ['Gestionarea incidentelor', ['incident', 'notificare', 'răspuns', 'criză', 'alerte']],
  ['Continuitate', ['continuitate', 'backup', 'recuperare', 'rezilien', 'disponibil']],
  ['Lanțul de aprovizionare', ['furnizor', 'aprovizion', 'terț', 'contract', 'partener']],
  ['Vulnerabilități', ['vulnerabilit', 'patch', 'actualiz', 'testare', 'penetrare']],
  ['Identitate și acces', ['acces', 'identitate', 'autentific', 'privilegi', 'parol']],
  ['Criptografie', ['cript', 'chei', 'certificat', 'tls']],
  ['Securitatea operațiunilor', ['monitoriz', 'jurnal', 'log', 'configura', 'rețea']],
  ['Instruire', ['instruire', 'formare', 'conștientiz', 'personal', 'angaja']],
];

const ISO_THEMES = {
  4: 'Contextul organizației',
  5: 'Conducere',
  6: 'Planificare',
  7: 'Suport',
  8: 'Operare',
  9: 'Evaluarea performanței',
  10: 'Îmbunătățire',
  A5: 'Controale organizaționale',
  A6: 'Controale pentru oameni',
  A7: 'Controale fizice',
  A8: 'Controale tehnologice',
};

const AI_ACT_THEMES = [
  [5, 'Practici interzise'],
  [6, 'Clasificare și risc'],
  [9, 'Managementul riscului'],
  [10, 'Date și guvernanța datelor'],
  [11, 'Documentație tehnică'],
  [12, 'Jurnalizare'],
  [13, 'Transparență și instrucțiuni'],
  [14, 'Supraveghere umană'],
  [15, 'Acuratețe, robustețe și securitate'],
  [26, 'Obligațiile implementatorilor'],
  [27, 'Evaluarea conformității'],
  [50, 'Obligații de transparență'],
  [72, 'Monitorizare post-comercializare'],
];

function firstTheme(rules, fallback, haystack) {
  const text = haystack.toLowerCase();
  for (const [theme, keywords] of rules) {
    if (keywords.some((keyword) => text.includes(keyword))) return theme;
  }
  return fallback;
}

function isoTheme(ref) {
  const annex = /^A\.(\d{1,2})/.exec(ref);
  if (annex) return ISO_THEMES[`A${annex[1]}`] ?? 'Controale Anexa A';
  const clause = /^(\d{1,2})/.exec(ref);
  return ISO_THEMES[Number(clause?.[1])] ?? 'Sistem de management';
}

function aiActTheme(ref) {
  const article = Number(/^Art\.\s*(\d{1,3})/.exec(ref)?.[1]);
  const exact = AI_ACT_THEMES.find(([number]) => number === article);
  if (exact) return exact[1];
  if (article >= 8 && article <= 15) return 'Cerințe pentru sisteme cu risc ridicat';
  if (article >= 16 && article <= 27) return 'Obligațiile operatorilor';
  return 'Guvernanța AI';
}

function soc2Theme(ref) {
  if (/^CC/.test(ref)) return 'Guvernanță și risc';
  if (/^A/.test(ref)) return 'Disponibilitate';
  if (/^PI/.test(ref)) return 'Integritatea procesării';
  if (/^C/.test(ref)) return 'Confidențialitate';
  if (/^P/.test(ref)) return 'Confidențialitate și date personale';
  return 'Criterii SOC 2';
}

/** Common shape of a heading rule. */
const articleHeading = (prefixes) => ({
  kind: 'article',
  pattern: new RegExp(
    `^(?:${prefixes.join('|')})\\s+(\\d{1,3})(?:\\s*[–—:-]\\s*(.{3,}))?$`,
    'i',
  ),
  ref: (match) => `Art. ${match[1]}`,
  title: (match) => match[2]?.trim(),
});

export const FRAMEWORKS = {
  nis2: {
    id: 'nis2',
    label: 'NIS2',
    dir: 'nis2',
    defaultVersion: '2024.1.0',
    license: 'public',
    defaultSource: 'Directiva (UE) 2022/2555',
    headings: [articleHeading(['Articolul', 'Article', 'Art\\.?'])],
    paragraphPattern: /^(\d{1,2})\.\s+(.+)$/,
    letterPattern: /^\(([a-z])\)\s+(.+)$/i,
    themeFor: ({ ref, title, text }) => firstTheme(NIS2_THEMES, 'Guvernanță și risc', `${title} ${text} ${ref}`),
    defaultEvidence: 'document',
    defaultCadence: 'annual',
    minText: 20,
    maxText: 2000,
  },

  iso27001: {
    id: 'iso27001',
    label: 'ISO/IEC 27001',
    dir: 'iso27001',
    defaultVersion: '2022.1.0',
    license: 'proprietary',
    defaultSource: 'ISO/IEC 27001:2022',
    headings: [
      {
        kind: 'annex',
        pattern: /^A\.(\d{1,2}\.\d{1,2})\s+(\S.{2,})$/i,
        ref: (match) => `A.${match[1]}`,
        title: (match) => match[2].trim(),
      },
      {
        kind: 'clause',
        pattern: /^(\d{1,2}(?:\.\d{1,2}){0,3})\s+([A-ZĂÂÎȘȚ].{2,})$/u,
        ref: (match) => match[1],
        title: (match) => match[2].trim(),
      },
    ],
    paragraphPattern: null,
    letterPattern: null,
    themeFor: ({ ref }) => isoTheme(ref),
    defaultEvidence: 'document',
    defaultCadence: 'annual',
    minText: 20,
    maxText: 2000,
  },

  'ai-act': {
    id: 'ai-act',
    label: 'EU AI Act',
    dir: 'ai-act',
    defaultVersion: '2026.1.0',
    license: 'public',
    defaultSource: 'Regulamentul (UE) 2024/1689',
    headings: [articleHeading(['Articolul', 'Article', 'Art\\.?'])],
    paragraphPattern: /^(\d{1,2})\.\s+(.+)$/,
    letterPattern: /^\(([a-z])\)\s+(.+)$/i,
    themeFor: ({ ref }) => aiActTheme(ref),
    defaultEvidence: 'document',
    defaultCadence: 'annual',
    minText: 20,
    maxText: 2000,
  },

  soc2: {
    id: 'soc2',
    label: 'SOC 2',
    dir: 'soc2',
    defaultVersion: '2022.1.0',
    license: 'proprietary',
    defaultSource: 'AICPA Trust Services Criteria (2017, revised 2022)',
    headings: [
      {
        kind: 'criterion',
        pattern: /^(CC\d{1,2}\.\d{1,2}|PI\d{1,2}\.\d{1,2}|A\d{1,2}\.\d{1,2}|C\d{1,2}\.\d{1,2}|P\d{1,2}\.\d{1,2})\s+(\S.{2,})$/i,
        ref: (match) => match[1].toUpperCase(),
        title: (match) => match[2].trim(),
      },
    ],
    paragraphPattern: null,
    letterPattern: null,
    themeFor: ({ ref }) => soc2Theme(ref),
    defaultEvidence: 'document',
    defaultCadence: 'annual',
    minText: 20,
    maxText: 2000,
  },
};

export const FRAMEWORK_IDS = Object.keys(FRAMEWORKS);

export function frameworkConfig(frameworkId) {
  const config = FRAMEWORKS[frameworkId];
  if (!config) {
    throw new Error(
      `Framework necunoscut: ${frameworkId}. Valori acceptate: ${FRAMEWORK_IDS.join(', ')}.`,
    );
  }
  return config;
}

/** Lowercase, no diacritics, single dashes. Used for ids and file names. */
export function slugify(value, maxLength = 64) {
  const slug = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return slug.slice(0, maxLength).replace(/-+$/g, '');
}
