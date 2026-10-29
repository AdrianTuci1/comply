import { createHash } from "node:crypto";

import { plainText, paragraphs, shortTitle, slugify } from "../html.mjs";
import { fetchText, mapLimit } from "./fetch.mjs";
import { nis2Theme } from "./themes.mjs";

export const NIS2_SOURCE = {
  id: "src-nis2-2022-2555",
  frameworkId: "nis2",
  title: "Directive (EU) 2022/2555 (NIS2)",
  publisher: "European Union",
  version: "2024.1.0",
  kind: "html",
  license: "public",
};

const INDEX_URL =
  "https://www.nis-2-directive.com/NIS_2_Directive_Articles.html";

export function discoverNis2Articles(indexHtml, baseUrl = INDEX_URL) {
  const found = new Map();

  for (const match of indexHtml.matchAll(
    /href="([^"]*NIS_2_Directive_Article_(\d+)\.html)"[^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const number = match[2];
    const url = new URL(match[1], baseUrl).toString();
    const title = plainText(match[3]);
    if (!found.has(number)) found.set(number, { number, url, title });
  }

  return [...found.values()].sort(
    (left, right) => Number(left.number) - Number(right.number),
  );
}

export function parseNis2Article(html, { number, url }) {
  const heading = /<b>\s*Article\s+(\d+)\s*,\s*([^<]+)<\/b>/i.exec(html);
  if (!heading) throw new Error(`Article heading missing at ${url}`);

  const title = plainText(heading[2]);
  const start = heading.index + heading[0].length;
  let body = html.slice(start);

  const stopAt = ["Understanding Article", "Note:", "Articles, Directive (EU)"]
    .map((marker) => body.indexOf(marker))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  if (stopAt !== undefined) body = body.slice(0, stopAt);

  const items = [];
  let lastNumber = null;
  let current = null;

  for (const paragraph of paragraphs(body)) {
    const numbered = /^(\d{1,2})\.\s+([\s\S]+)$/.exec(paragraph);
    const letter = /^\(([a-z])\)\s+([\s\S]+)$/i.exec(paragraph);

    if (numbered) {
      lastNumber = numbered[1];
      current = {
        kind: "number",
        number: numbered[1],
        text: numbered[2].trim(),
      };
      items.push(current);
      continue;
    }

    if (letter) {
      current = {
        kind: "letter",
        letter: letter[1].toLowerCase(),
        parent: lastNumber,
        text: letter[2].trim(),
      };
      items.push(current);
      continue;
    }

    if (current) {
      current.text = `${current.text} ${paragraph}`.trim();
    } else if (paragraph.length >= 30) {
      items.push({ kind: "intro", text: paragraph });
    }
  }

  const pageText = items.map((item) => item.text).join("\n\n");
  if (pageText.length < 20)
    throw new Error(`Article ${number} has no readable text at ${url}`);

  const requirements = items
    .filter((item) => item.text.length >= (item.kind === "letter" ? 8 : 20))
    .map((item) => {
      if (item.kind === "number") {
        return {
          ref: `Art. ${number}(${item.number})`,
          title: shortTitle(item.text),
          text: item.text,
        };
      }
      if (item.kind === "letter") {
        const parent = item.parent ? `(${item.parent})` : "";
        return {
          ref: `Art. ${number}${parent}(${item.letter})`,
          title: shortTitle(item.text),
          text: item.text,
        };
      }
      return { ref: `Art. ${number}`, title, text: item.text };
    });

  if (requirements.length === 0) {
    requirements.push({ ref: `Art. ${number}`, title, text: pageText });
  }

  return {
    number,
    url,
    title,
    text: pageText,
    requirements: requirements.map((requirement) => ({
      ...requirement,
      theme: nis2Theme(`${title} ${requirement.text}`),
    })),
  };
}

export async function ingestNis2({
  fetchedAt = new Date().toISOString(),
  concurrency = 4,
  log = () => {},
  fetch = fetchText,
} = {}) {
  const index = await fetch(INDEX_URL);
  const articles = discoverNis2Articles(index);
  if (articles.length === 0)
    throw new Error("NIS2 index did not expose any article links.");

  log(`NIS2: ${articles.length} articles discovered.`);
  let completed = 0;

  const pages = await mapLimit(articles, concurrency, async (article) => {
    const html = await fetch(article.url);
    const parsed = parseNis2Article(html, article);
    completed += 1;
    if (completed % 10 === 0 || completed === articles.length) {
      log(`NIS2: extracted ${completed}/${articles.length}.`);
    }
    return parsed;
  });

  const text = pages
    .map((page) => `Article ${page.number}, ${page.title}\n\n${page.text}`)
    .join("\n\n");
  const document = {
    id: "doc-nis2-2022-2555",
    sourceId: NIS2_SOURCE.id,
    frameworkId: NIS2_SOURCE.frameworkId,
    title: NIS2_SOURCE.title,
    url: INDEX_URL,
    officialUrl: "https://eur-lex.europa.eu/eli/dir/2022/2555/oj/eng",
    publisher: "European Union",
    license: "public",
    fetchedAt,
    sha256: createHash("sha256").update(text).digest("hex"),
    bytes: Buffer.byteLength(text),
    pages: pages.map((page) => ({
      ref: `Art. ${page.number}`,
      title: page.title,
      url: page.url,
      text: page.text,
    })),
  };

  const source = {
    ...NIS2_SOURCE,
    importedAt: fetchedAt,
    lastReviewedAt: null,
  };
  const requirements = pages.flatMap((page) =>
    page.requirements.map((requirement) => ({
      id: `req-nis2-${slugify(requirement.ref)}`,
      sourceId: source.id,
      frameworkId: source.frameworkId,
      ref: requirement.ref,
      title: requirement.title,
      text: requirement.text,
      theme: requirement.theme,
      status: "draft",
      reviewer: null,
      reviewedAt: null,
      createdAt: fetchedAt,
    })),
  );

  return { source, document, requirements };
}
