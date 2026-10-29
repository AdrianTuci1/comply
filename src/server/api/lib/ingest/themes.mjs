const NIS2_RULES = [
  [
    "organizational",
    [
      "risk",
      "governance",
      "management body",
      "policy",
      "supply chain",
      "supplier",
    ],
  ],
  [
    "procedures",
    [
      "incident",
      "continuity",
      "backup",
      "disaster",
      "crisis",
      "report",
      "audit",
    ],
  ],
  [
    "infrastructure",
    [
      "network",
      "system",
      "vulnerability",
      "patch",
      "access",
      "cryptograph",
      "authentication",
      "logging",
    ],
  ],
  [
    "product",
    ["acquisition", "development", "maintenance", "testing", "certification"],
  ],
  ["data_privacy", ["data", "privacy", "confidential", "personal"]],
];

export function nis2Theme(text) {
  const haystack = text.toLowerCase();
  for (const [theme, keywords] of NIS2_RULES) {
    if (keywords.some((keyword) => haystack.includes(keyword))) return theme;
  }
  return "organizational";
}

const AI_ACT_RANGES = [
  [5, 5, "organizational"],
  [6, 7, "organizational"],
  [8, 15, "product"],
  [16, 27, "organizational"],
  [28, 39, "procedures"],
  [40, 49, "organizational"],
  [50, 50, "data_privacy"],
  [51, 56, "organizational"],
  [57, 63, "procedures"],
  [64, 68, "organizational"],
  [69, 70, "organizational"],
  [71, 72, "procedures"],
  [73, 79, "organizational"],
  [80, 84, "procedures"],
  [85, 95, "organizational"],
  [96, 101, "organizational"],
  [102, 110, "organizational"],
  [111, 113, "organizational"],
];

export function aiActTheme(articleNumber) {
  const number = Number.parseInt(articleNumber, 10);
  if (!Number.isFinite(number)) return "organizational";
  const range = AI_ACT_RANGES.find(
    ([from, to]) => number >= from && number <= to,
  );
  return range?.[2] ?? "organizational";
}
