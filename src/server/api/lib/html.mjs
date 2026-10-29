const ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  middot: "·",
  bull: "•",
  copy: "©",
  reg: "®",
};

export function decodeEntities(value) {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === "#") {
      const hex = entity[1].toLowerCase() === "x";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** Removes a tag and everything nested inside it, using span depth. */
export function removeElementsByClass(html, className, tag = "span") {
  let output = html;
  const opener = new RegExp(
    `<${tag}\\b[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>`,
    "i",
  );

  for (;;) {
    const start = opener.exec(output);
    if (!start) return output;

    const close = findMatchingClose(output, start.index, tag);
    if (close < 0) return output;
    output = output.slice(0, start.index) + output.slice(close);
  }
}

/** Index just past the matching closing tag, or -1. */
export function findMatchingClose(html, startIndex, tag) {
  const token = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  token.lastIndex = startIndex;
  let depth = 0;

  for (;;) {
    const match = token.exec(html);
    if (!match) return -1;
    if (match[1] === "/") {
      depth -= 1;
      if (depth === 0) return token.lastIndex;
    } else {
      depth += 1;
    }
  }
}

/** Inner HTML of the first element carrying the class. */
export function elementByClass(html, className, tag = "span") {
  const opener = new RegExp(
    `<${tag}\\b[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>`,
    "i",
  );
  const start = opener.exec(html);
  if (!start) return null;

  const close = findMatchingClose(html, start.index, tag);
  if (close < 0) return null;
  const innerEnd = html.lastIndexOf(`</${tag}>`, close - 1);
  return html.slice(
    start.index + start[0].length,
    innerEnd >= 0 ? innerEnd : close,
  );
}

export function stripTags(html) {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  );
}

export function normalizeText(value) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n+ */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function plainText(html) {
  return normalizeText(stripTags(html));
}

export function paragraphs(html) {
  return [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => plainText(match[1]))
    .filter(Boolean);
}

/** Short readable title from a legal sentence. */
export function shortTitle(text, maxLength = 96) {
  const clean = text.replace(/\s+/g, " ").trim();
  const clause = clean.split(/(?:;|\.\s|:\s)/)[0] ?? clean;
  const words = clause.split(" ");
  let title = "";
  for (const word of words) {
    if (`${title} ${word}`.trim().length > maxLength) break;
    title = `${title} ${word}`.trim();
  }
  const trimmed = (title || clean.slice(0, maxLength)).replace(
    /[\s,;:.]+$/,
    "",
  );
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function slugify(value, maxLength = 64) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, maxLength)
    .replace(/-+$/g, "");
}
