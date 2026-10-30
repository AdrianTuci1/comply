import assert from "node:assert/strict";
import { test } from "node:test";

import { parseAiActArticle } from "../lib/ingest/ai-act.mjs";
import { parseNis2Article } from "../lib/ingest/nis2.mjs";

const NIS2_ARTICLE = `
<h1>The NIS 2 Directive | Article 21</h1>
<p class="text-left"><b>Article 21, Cybersecurity risk-management measures</b></p>
<p class="text-left">1. Entities shall take appropriate measures to manage risks.</p>
<p class="text-left">2. The measures shall include at least the following:</p>
<p class="text-left">(a) policies on risk analysis and information system security;</p>
<p class="text-left">(b) incident handling;</p>
<p class="text-left">(c) business continuity and crisis management.</p>
<p class="text-left">3. Entities shall take corrective measures without undue delay.</p>
<p class="text-left"><b>Understanding Article 21 of the NIS 2 Directive | Analysis</b></p>
<p class="text-left">This analysis is not part of the directive.</p>
`;

test("extracts NIS2 paragraphs and lettered measures without analysis", () => {
  const article = parseNis2Article(NIS2_ARTICLE, {
    number: "21",
    url: "https://example.test/21",
  });

  assert.equal(article.title, "Cybersecurity risk-management measures");
  assert.deepEqual(
    article.requirements.map((requirement) => requirement.ref),
    [
      "Art. 21(1)",
      "Art. 21(2)",
      "Art. 21(2)(a)",
      "Art. 21(2)(b)",
      "Art. 21(2)(c)",
      "Art. 21(3)",
    ],
  );
  assert.equal(
    article.requirements[4].text,
    "business continuity and crisis management.",
  );
  assert.ok(!article.text.includes("not part of the directive"));
});

const AI_ARTICLE = `
<section id="article-13">
  <h2 class="item-heading">
    <span class="heading-label">Article 13</span>
    <span class="heading-title">: Transparency and Provision of Information to Deployers</span>
  </h2>
  <div class="para depth-0" id="p-article-13-1">
    <span class="para-label">1.</span>
    <span class="para-text">Systems shall be transparent to <span class="term-ref">deployers<span class="term-tip"><span class="term-tip-body">definition noise</span></span></span>.</span>
  </div>
  <div class="para depth-0 om-amended" id="p-article-13-2">
    <span class="para-label">2.</span>
    <span class="para-text">Systems shall be accompanied by instructions for use.</span>
  </div>
  <div class="para depth-1" id="p-article-13-2.a">
    <span class="para-label">(a)</span>
    <span class="para-text">the identity and contact details of the provider;</span>
  </div>
  <div class="para depth-1" id="p-article-13-2.b">
    <span class="para-label">(b)</span>
    <span class="para-text">the characteristics and limitations of performance.</span>
  </div>
</section>
`;

test("extracts AI Act paragraphs and strips inline definitions", () => {
  const article = parseAiActArticle(AI_ARTICLE, {
    number: "13",
    url: "https://example.test/13",
  });

  assert.equal(
    article.title,
    "Transparency and Provision of Information to Deployers",
  );
  assert.deepEqual(
    article.requirements.map((requirement) => requirement.ref),
    ["Art. 13(1)", "Art. 13(2)", "Art. 13(2)(a)", "Art. 13(2)(b)"],
  );
  assert.ok(!article.text.includes("definition noise"));
  assert.equal(article.requirements[3].theme, "product");
});
