#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const VERSION = "0.1.0";
const DEFAULT_IMAGE = "ghcr.io/comply/comply:latest";

const args = process.argv.slice(2);
const flags = new Map();
const positional = [];

for (let index = 0; index < args.length; index += 1) {
  const value = args[index];
  if (value.startsWith("--")) {
    const [name, inline] = value.slice(2).split("=");
    if (inline !== undefined) {
      flags.set(name, inline);
    } else if (args[index + 1] && !args[index + 1].startsWith("--")) {
      flags.set(name, args[index + 1]);
      index += 1;
    } else {
      flags.set(name, "true");
    }
  } else if (value === "-h") {
    flags.set("help", "true");
  } else if (value === "-v") {
    flags.set("version", "true");
  } else {
    positional.push(value);
  }
}

if (flags.has("help")) {
  console.log(`Comply ${VERSION}

Usage:
  npx comply start [options]

Options:
  --port <port>       Host port for the web interface and API (default 8080)
  --data <dir>        Host directory mounted at /app/data (default ./comply-data)
  --image <image>     Container image (default ${DEFAULT_IMAGE})
  --detach            Run the container in the background
  --help              Show this help
  --version           Show the version

Environment:
  COMPLY_AUTH_SECRET  Session signing secret. Required for a public deployment.
  COMPLY_APP_URL      Public origin, for example https://comply.example.com
  COMPLY_PUBLIC_URL   Origin used to build OIDC callback URLs
  COMPLY_OIDC_GOOGLE_CLIENT_ID / COMPLY_OIDC_GOOGLE_CLIENT_SECRET
  COMPLY_OIDC_MICROSOFT_CLIENT_ID / COMPLY_OIDC_MICROSOFT_CLIENT_SECRET
  COMPLY_OIDC_GITHUB_CLIENT_ID / COMPLY_OIDC_GITHUB_CLIENT_SECRET

All COMPLY_* variables in the current shell are forwarded to the container.`);
  process.exit(0);
}

if (flags.has("version")) {
  console.log(VERSION);
  process.exit(0);
}

const command = positional[0] ?? "start";
if (command !== "start") {
  console.error(`Unknown command: ${command}. Run npx comply --help.`);
  process.exit(2);
}

const docker = spawnSync("docker", ["--version"], { stdio: "ignore" });
if (docker.status !== 0) {
  console.error(
    "Docker is not available. Install Docker Desktop or run the image on a server with Docker.",
  );
  process.exit(1);
}

const port = flags.get("port") || process.env.PORT || "8080";
const dataDir = resolve(flags.get("data") || process.env.COMPLY_DATA_DIR_HOST || "comply-data");
const image = flags.get("image") || process.env.COMPLY_IMAGE || DEFAULT_IMAGE;
mkdirSync(dataDir, { recursive: true });

const dockerArgs = [
  "run",
  "--rm",
  ...(flags.has("detach") ? ["-d"] : ["-it"]),
  "-p",
  `${port}:8080`,
  "-v",
  `${join(dataDir, "")}:/app/data`,
  "-e",
  "COMPLY_DATA_DIR=/app/data",
  "-e",
  `COMPLY_APP_URL=${process.env.COMPLY_APP_URL ?? `http://localhost:${port}`}`,
];

for (const [key, value] of Object.entries(process.env)) {
  if (!key.startsWith("COMPLY_") || key === "COMPLY_DATA_DIR") continue;
  dockerArgs.push("-e", `${key}=${value}`);
}

dockerArgs.push(image);
console.log(`Starting Comply on http://localhost:${port} with data in ${dataDir}`);
const run = spawnSync("docker", dockerArgs, { stdio: "inherit" });
process.exit(run.status ?? 1);
