// Read-only file inventory. Never loads values into process.env or prints values/hashes.
import { readFileSync, existsSync } from "node:fs";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

try {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const names = [
    ".env.local",
    "apps/web/.env.local",
    ".env.remote.local",
    ".env.supabase.local",
  ];
  const read = (name) => {
    const file = path.join(root, name);
    return existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : null;
  };
  const files = names.map((name) => ({ name, values: read(name) }));
  const template = read(".env.example");
  if (!template) throw new Error("Missing template");
  const keys = Object.keys(template);
  const providers = ["NVIDIA_API_KEY", "OPENROUTER_API_KEY", "ZAI_API_KEY"];
  const present = (value) =>
    typeof value === "string" && value.trim().length > 0;
  const required = keys.filter((key) => !providers.includes(key));
  const web =
    files.find((file) => file.name === "apps/web/.env.local").values || {};
  const mismatches = keys.filter(
    (key) =>
      new Set(files.map((file) => file.values?.[key]).filter(present)).size > 1,
  );
  const missing = required.filter((key) => !present(web[key]));
  const configuredProviders = providers.filter((key) => present(web[key]));
  const invalidEncryptionKeyFiles = files
    .filter(
      (file) =>
        present(file.values?.BYOK_ENCRYPTION_KEY) &&
        !/^[a-f0-9]{64}$/i.test(file.values.BYOK_ENCRYPTION_KEY),
    )
    .map((file) => file.name);
  const report = {
    scope:
      "Local files only; no remote lookup or authentication test. No values or hashes emitted.",
    files: files.map((file) => ({
      file: file.name,
      exists: file.values !== null,
      configuredNames: keys.filter((key) => present(file.values?.[key])),
    })),
    webMissingRequiredNames: missing,
    webConfiguredProviderNames: configuredProviders,
    conflictingNames: mismatches,
    invalidEncryptionKeyFiles,
  };
  console.log(JSON.stringify(report, null, 2));
  if (
    missing.length ||
    !configuredProviders.length ||
    mismatches.length ||
    invalidEncryptionKeyFiles.length
  )
    process.exitCode = 1;
} catch {
  console.error(
    "Environment inventory failed; file contents and error details suppressed.",
  );
  process.exitCode = 1;
}
