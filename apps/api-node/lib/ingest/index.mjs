import { ingestAiAct } from "./ai-act.mjs";
import { ingestNis2 } from "./nis2.mjs";

export const INGESTORS = {
  "ai-act": ingestAiAct,
  nis2: ingestNis2,
};

export const INGESTABLE_FRAMEWORKS = Object.keys(INGESTORS);

export const SOURCE_REGISTRY = [
  {
    frameworkId: "ai-act",
    title: "Regulation (EU) 2024/1689 (AI Act)",
    publisher: "European Union",
    version: "2026.1.0",
    license: "public",
    indexUrl: "https://artificialintelligenceact.eu/ai-act-explorer/",
    officialUrl: "https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng",
    connector: "ai-act",
  },
  {
    frameworkId: "nis2",
    title: "Directive (EU) 2022/2555 (NIS2)",
    publisher: "European Union",
    version: "2024.1.0",
    license: "public",
    indexUrl: "https://www.nis-2-directive.com/NIS_2_Directive_Articles.html",
    officialUrl: "https://eur-lex.europa.eu/eli/dir/2022/2555/oj/eng",
    connector: "nis2",
  },
  {
    frameworkId: "iso27001",
    title: "ISO/IEC 27001:2022",
    publisher: "ISO/IEC",
    version: "2022.1.0",
    license: "proprietary",
    indexUrl: null,
    officialUrl: "https://www.iso.org/standard/27001",
    connector: null,
  },
  {
    frameworkId: "soc2",
    title: "SOC 2",
    publisher: "AICPA",
    version: "2022.1.0",
    license: "proprietary",
    indexUrl: null,
    officialUrl: "https://www.aicpa-cima.com/topic/audit-assurance/audit-and-assurance-greater-than-soc-2",
    connector: null,
  },
];

function dedupeRequirements(requirements) {
  const byRef = new Map();
  for (const requirement of requirements) {
    const key = requirement.ref.toLowerCase();
    if (!byRef.has(key)) byRef.set(key, requirement);
  }
  return [...byRef.values()];
}

export async function runIngest(frameworkId, options = {}) {
  const ingest = INGESTORS[frameworkId];
  if (!ingest) {
    throw new Error(
      `Framework ${frameworkId} has no downloadable document. Accepted: ${INGESTABLE_FRAMEWORKS.join(", ")}.`,
    );
  }

  const result = await ingest(options);
  return {
    ...result,
    requirements: dedupeRequirements(result.requirements),
  };
}
