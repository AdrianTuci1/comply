import { createHash } from "node:crypto";

import {
  elementByClass,
  normalizeText,
  plainText,
  removeElementsByClass,
  shortTitle,
  slugify,
} from "../html.mjs";
import { fetchText, mapLimit } from "./fetch.mjs";
import { aiActTheme } from "./themes.mjs";

export const AI_ACT_SOURCE = {
  id: "src-ai-act-2024-1689",
  frameworkId: "ai-act",
  title: "Regulation (EU) 2024/1689 (AI Act)",
  publisher: "European Union",
  version: "2026.1.0",
  kind: "html",
  license: "public",
};

const INDEX_URL = "https://artificialintelligenceact.eu/ai-act-explorer/";

export function discoverAiActArticles(indexHtml) {
  const found = new Map();

  for (const match of indexHtml.matchAll(
    /href="(?:https:\/\/artificialintelligenceact\.eu)?\/article\/(\d+[a-z]?)\/?"/gi,
  )) {
    const number = match[1].toLowerCase();
    if (!found.has(number)) {
      found.set(number, {
        number,
        url: `https://artificialintelligenceact.eu/article/${number}/`,
      });
    }
  }

  return [...found.values()].sort(
    (left, right) =>
      Number.parseInt(left.number, 10) - Number.parseInt(right.number, 10) ||
      left.number.localeCompare(right.number),
  );
}

export function parseAiActArticle(html, { number, url }) {
  const heading =
    /<h[12][^>]*class="[^"]*item-heading[^"]*"[^>]*>([\s\S]*?)<\/h[12]>/i.exec(
      html,
    );
  if (!heading) throw new Error(`Article ${number} has no heading at ${url}`);

  const label = plainText(elementByClass(heading[1], "heading-label") ?? "");
  const rawTitle = plainText(elementByClass(heading[1], "heading-title") ?? "");
  const title =
    rawTitle
      .replace(/^Article\s+\d+[a-z]?:\s*/i, "")
      .replace(/^:\s*/, "")
      .trim() || `Article ${number}`;

  if (!/^Article\s+\d+/i.test(label) && !/^Article\s+\d+/i.test(title)) {
    // Some pages render the label as plain text; the number is still authoritative.
  }

  const body = removeElementsByClass(
    html.slice(heading.index + heading[0].length),
    "term-tip",
  );
  const chunks = body.split(/(?=<div class="para\b)/).slice(1);
  const blocks = [];

  for (const chunk of chunks) {
    const open = /^<div class="([^"]*)"[^>]*>/.exec(chunk);
    const depth = /(?:^|\s)depth-(\d+)(?:\s|$)/.exec(open?.[1] ?? "");
    if (!depth) continue;

    const paragraphLabel = plainText(
      /<span class="para-label">([\s\S]*?)<\/span>/.exec(chunk)?.[1] ?? "",
    );
    const text = normalizeText(
      plainText(elementByClass(chunk, "para-text") ?? ""),
    );
    if (!text) continue;

    blocks.push({
      depth: Number(depth[1]),
      label: paragraphLabel,
      text,
      anchor: /id="([^"]+)"/.exec(chunk)?.[1] ?? null,
    });
  }

  const pageText = blocks.map((block) => block.text).join("\n\n");
  if (pageText.length < 20)
    throw new Error(`Article ${number} has no readable text at ${url}`);

  const requirements = new Map();
  let parentNumber = null;

  for (const block of blocks) {
    if (block.depth > 1) continue;

    const numberMatch = /^(\d{1,2})\.$/.exec(block.label.trim());
    if (block.depth === 0 && numberMatch) parentNumber = numberMatch[1];

    if (block.depth === 0) {
      const suffix = parentNumber ? `(${parentNumber})` : "";
      const ref = `Art. ${number}${suffix}`;
      requirements.set(ref, {
        ref,
        title,
        text: block.text,
      });
      continue;
    }

    const letterMatch = /^\(([a-z0-9ivx]+)\)$/i.exec(block.label.trim());
    if (block.depth === 1 && letterMatch) {
      const parent = parentNumber ? `(${parentNumber})` : "";
      const ref = `Art. ${number}${parent}(${letterMatch[1].toLowerCase()})`;
      if (!requirements.has(ref)) {
        requirements.set(ref, {
          ref,
          title: shortTitle(block.text),
          text: block.text,
        });
      }
    }
  }

  if (requirements.size === 0) {
    requirements.set(`Art. ${number}`, {
      ref: `Art. ${number}`,
      title,
      text: pageText,
    });
  }

  return {
    number,
    url,
    title,
    text: pageText,
    requirements: [...requirements.values()].map((requirement) => ({
      ...requirement,
      theme: aiActTheme(number),
    })),
  };
}

export async function ingestAiAct({
  fetchedAt = new Date().toISOString(),
  concurrency = 4,
  log = () => {},
  fetch = fetchText,
} = {}) {
  const index = await fetch(INDEX_URL);
  const articles = discoverAiActArticles(index);
  if (articles.length === 0)
    throw new Error("AI Act explorer did not expose any article links.");

  log(`AI Act: ${articles.length} articles discovered.`);
  let completed = 0;

  const pages = await mapLimit(articles, concurrency, async (article) => {
    const html = await fetch(article.url);
    const parsed = parseAiActArticle(html, article);
    completed += 1;
    if (completed % 10 === 0 || completed === articles.length) {
      log(`AI Act: extracted ${completed}/${articles.length}.`);
    }
    return parsed;
  });

  const text = pages
    .map((page) => `Article ${page.number}: ${page.title}\n\n${page.text}`)
    .join("\n\n");
  const document = {
    id: "doc-ai-act-2024-1689",
    sourceId: AI_ACT_SOURCE.id,
    frameworkId: AI_ACT_SOURCE.frameworkId,
    title: AI_ACT_SOURCE.title,
    url: INDEX_URL,
    officialUrl: "https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng",
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
    ...AI_ACT_SOURCE,
    importedAt: fetchedAt,
    lastReviewedAt: null,
  };
  const requirements = pages.flatMap((page) =>
    page.requirements.map((requirement) => ({
      id: `req-ai-act-${slugify(requirement.ref)}`,
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
