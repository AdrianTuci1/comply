/**
 * Turns extracted lines into reviewable requirement candidates.
 *
 * Segmentation is deliberately conservative: a candidate only starts at a
 * heading that the framework recognises. Everything after it, until the next
 * heading, belongs to the same block. A human then decides whether the block
 * is a requirement, merges it with another, or drops it.
 */

const MAX_TITLE = 110;

function normalise(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function shorten(text, max = MAX_TITLE) {
  const clean = normalise(text).replace(/[.;:,]+$/, '');
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const boundary = cut.lastIndexOf(' ');
  return `${cut.slice(0, boundary > 40 ? boundary : max).trim()}…`;
}

function titleCase(text) {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function detectHeading(line, framework) {
  if (line.length > 180) return null;
  for (const rule of framework.headings) {
    const match = rule.pattern.exec(line);
    if (!match) continue;
    return {
      kind: rule.kind,
      ref: rule.ref(match),
      title: rule.title?.(match)?.trim() || undefined,
    };
  }
  return null;
}

/**
 * @param {{text: string, line: number, page: number|null}[]} entries
 * @param {ReturnType<import('./frameworks.mjs').frameworkConfig>} framework
 * @param {{document?: string}} options
 */
export function segment(entries, framework, options = {}) {
  const document = options.document ?? framework.defaultSource;
  const blocks = [];
  let current = null;

  for (const entry of entries) {
    const heading = detectHeading(entry.text, framework);
    if (heading) {
      if (current) blocks.push(current);
      current = {
        ref: heading.ref,
        kind: heading.kind,
        title: heading.title,
        lines: [],
        page: entry.page,
        line: entry.line,
        endPage: entry.page,
      };
      continue;
    }
    if (!current) continue;
    current.lines.push(entry);
    current.endPage = entry.page;
  }
  if (current) blocks.push(current);

  if (blocks.length === 0) {
    return {
      candidates: [],
      warnings: [
        `Nu am găsit titluri de tip ${framework.label} în document. Verifică dacă textul este selectabil (nu scanat) și dacă folosește numerotarea standard.`,
      ],
    };
  }

  const warnings = [];
  const candidates = [];

  for (const block of blocks) {
    const produced = splitBlock(block, framework, document);
    if (produced.length === 0) {
      warnings.push(`Secțiunea ${block.ref} nu are text suficient și a fost ignorată.`);
      continue;
    }
    candidates.push(...produced);
  }

  return { candidates, warnings };
}

function splitBlock(block, framework, document) {
  const letters = framework.letterPattern
    ? block.lines.filter((entry) => framework.letterPattern.test(entry.text))
    : [];

  if (letters.length > 0) {
    const segments = [];
    let paragraph = null;
    let current = null;

    for (const entry of block.lines) {
      const paragraphMatch = framework.paragraphPattern?.exec(entry.text);
      if (paragraphMatch && !framework.letterPattern.test(entry.text)) {
        paragraph = paragraphMatch[1];
        if (current) {
          segments.push(current);
          current = null;
        }
        continue;
      }

      const letterMatch = framework.letterPattern.exec(entry.text);
      if (letterMatch) {
        if (current) segments.push(current);
        current = {
          paragraph,
          letter: letterMatch[1].toLowerCase(),
          lines: [letterMatch[2]],
          page: entry.page,
          line: entry.line,
          endPage: entry.page,
        };
        continue;
      }

      if (current) {
        current.lines.push(entry.text);
        if (entry.page != null) current.endPage = entry.page;
      }
    }
    if (current) segments.push(current);

    return segments
      .map((segment) => {
        const ref = `${block.ref}${segment.paragraph ? `(${segment.paragraph})` : ''}(${segment.letter})`;
        return toCandidate({
          framework,
          document,
          ref,
          title: shorten(segment.lines[0] ?? '', 90),
          lines: segment.lines,
          page: segment.page,
          line: segment.line,
          endPage: segment.endPage,
          headingTitle: undefined,
        });
      })
      .filter(Boolean);
  }

  const lines = block.lines.map((entry) => entry.text);
  return [
    toCandidate({
      framework,
      document,
      ref: block.ref,
      title: shorten(block.title ?? lines[0] ?? '', 90),
      lines,
      page: block.page,
      line: block.line,
      endPage: block.endPage,
      headingTitle: block.title,
    }),
  ].filter(Boolean);
}

function toCandidate({
  framework,
  document,
  ref,
  title,
  lines,
  page,
  line,
  endPage,
  headingTitle,
}) {
  const body = normalise(lines.join(' '));
  if (body.length < framework.minText) return null;

  const truncated = body.length > framework.maxText;
  const text = truncated ? `${body.slice(0, framework.maxText).trim()}…` : body;
  const parts = [document];
  if (page != null) {
    parts[0] = endPage && endPage !== page ? `${document}, p. ${page}–${endPage}` : `${document}, p. ${page}`;
  }
  parts.push(`l. ${line}`);
  const finalTitle = titleCase(shorten(headingTitle ?? title ?? body, 90));

  const warnings = [
    'Text extras automat. Rescrie cerința în formulare proprie și verifică referința înainte de promovare.',
  ];
  if (!headingTitle && !title) {
    warnings.push('Titlul a fost derivat din corpul textului; verifică-l.');
  }
  if (truncated) {
    warnings.push(`Textul a fost limitat la ${framework.maxText} caractere; verifică finalul.`);
  }
  if (framework.license === 'proprietary') {
    warnings.push(
      'Sursă licențiată: nu publica textul extras. Promovarea cere reformulare și indicatorul --reformulated.',
    );
  }

  return {
    frameworkId: framework.id,
    version: framework.defaultVersion,
    ref,
    title: finalTitle,
    text,
    rawText: body,
    sourceRef: parts.join(', '),
    page,
    line,
    theme: framework.themeFor({ ref, title: finalTitle, text }),
    warnings,
  };
}
