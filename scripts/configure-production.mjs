import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
for (const p of [".env.remote.local", ".env.local"])
  try {
    process.loadEnvFile(p);
  } catch {}
const ops = JSON.parse(readFileSync("ops/production.json", "utf8"));
const auth = JSON.parse(
  readFileSync(
    path.join(
      os.homedir(),
      "Library/Application Support/com.vercel.cli/auth.json",
    ),
    "utf8",
  ),
);
const response = await fetch(
  `https://api.vercel.com/v9/projects/${ops.vercel.projectId}?teamId=${ops.vercel.teamId}`,
  {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${auth.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      framework: "nextjs",
      rootDirectory: "apps/web",
      buildCommand: "pnpm build",
      installCommand: "pnpm install --frozen-lockfile",
      outputDirectory: null,
      nodeVersion: "22.x",
    }),
  },
);
if (!response.ok)
  throw new Error("Project configuration failed " + response.status);
console.log("Vercel project configured: Next.js, apps/web, Node 22, Seoul");
for (const name of [
  "AUTH_GITHUB_ID",
  "AUTH_GITHUB_SECRET",
  "AUTH_SECRET",
  "SCHEDULER_SECRET",
  "BYOK_ENCRYPTION_KEY",
  "ZAI_API_KEY",
  "APP_URL",
]) {
  if (!process.env[name]) throw new Error("Missing " + name);
  execFileSync("vercel", ["env", "add", name, "production", "--force"], {
    input: process.env[name],
    stdio: ["pipe", "pipe", "pipe"],
  });
  console.log("Configured production variable:", name);
}
for (const name of ["NVIDIA_API_KEY", "OPENROUTER_API_KEY"]) {
  if (!process.env[name]) continue;
  execFileSync(
    "vercel",
    ["env", "add", name, "production", "--force", "--sensitive"],
    {
      input: process.env[name],
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  console.log("Configured optional free provider:", name);
}
