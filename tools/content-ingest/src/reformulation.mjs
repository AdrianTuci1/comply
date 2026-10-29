/**
 * Heuristic guard for licensed sources.
 *
 * It does not replace legal review. It catches the common failure mode:
 * an extracted paragraph pasted into a requirement with a new title.
 */

const VERBATIM_WINDOW = 10;
const MAX_COMPARE_TOKENS = 1500;

export function tokenise(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** Longest shared contiguous token run, capped for predictable cost. */
export function longestSharedRun(left, right) {
  const a = left.slice(0, MAX_COMPARE_TOKENS);
  const b = right.slice(0, MAX_COMPARE_TOKENS);
  let best = 0;
  let previous = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    const current = new Uint16Array(b.length + 1);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        current[j] = previous[j - 1] + 1;
        if (current[j] > best) best = current[j];
      }
    }
    previous = current;
  }
  return best;
}

/** Share of the reviewed text's tokens that also occur in the source. */
export function tokenOverlap(reviewed, source) {
  if (reviewed.length === 0) return 0;
  const sourceCounts = new Map();
  for (const token of source) sourceCounts.set(token, (sourceCounts.get(token) ?? 0) + 1);
  let matched = 0;
  for (const token of reviewed) {
    const count = sourceCounts.get(token) ?? 0;
    if (count > 0) {
      matched++;
      sourceCounts.set(token, count - 1);
    }
  }
  return matched / reviewed.length;
}

/**
 * @returns {{ok: boolean, longestRun: number, overlap: number, reason?: string}}
 */
export function compareForReformulation(reviewedText, sourceText) {
  const reviewed = tokenise(reviewedText);
  const source = tokenise(sourceText);
  const longestRun = longestSharedRun(reviewed, source);
  const overlap = tokenOverlap(reviewed, source);

  if (longestRun >= VERBATIM_WINDOW) {
    return {
      ok: false,
      longestRun,
      overlap,
      reason: `Textul păstrează o secvență de ${longestRun} cuvinte din sursă. Reformulează.`,
    };
  }
  if (overlap > 0.6) {
    return {
      ok: false,
      longestRun,
      overlap,
      reason: `Textul refolosește ${Math.round(overlap * 100)}% din cuvintele sursei. Reformulează.`,
    };
  }
  return { ok: true, longestRun, overlap };
}
