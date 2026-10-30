#!/usr/bin/env node
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist", "azure");

await rm(out, { recursive: true, force: true });
await mkdir(join(out, "src", "functions"), { recursive: true });

await cp(join(root, "apps", "functions-node", "host.json"), join(out, "host.json"));
await cp(
  join(root, "apps", "functions-node", "src", "functions", "comply.js"),
  join(out, "src", "functions", "comply.js"),
);
await cp(join(root, "apps", "api-node"), join(out, "server"), {
  recursive: true,
});
await rm(join(out, "server", "test"), { recursive: true, force: true });
await cp(join(root, "apps", "web", "dist", "web", "browser"), join(out, "web"), {
  recursive: true,
});

const functionsPackage = JSON.parse(
  await readFile(join(root, "apps", "functions-node", "package.json"), "utf8"),
);
await writeFile(
  join(out, "package.json"),
  `${JSON.stringify(functionsPackage, null, 2)}\n`,
);

console.log(`Azure Functions package ready at ${out}`);
console.log(
  "Next: cd dist/azure && npm install --omit=dev && func azure functionapp publish <name>",
);
