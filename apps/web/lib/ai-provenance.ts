export type AiLanguage = "ko" | "en";
export type AiTier = "free" | "byok";

export type AiProvenance = {
  tier?: AiTier | string | null;
  provider?: string | null;
  model?: string | null;
  requestedModel?: string | null;
  endpoint?: string | null;
  upstreamProvider?: string | null;
};

export function normalizedProvider(provider?: string | null) {
  return provider === "zai" ? "free" : provider;
}

function hostname(endpoint?: string | null) {
  if (!endpoint) return "";
  try {
    return new URL(
      endpoint.includes("://") ? endpoint : `https://${endpoint}`,
    ).hostname.replace(/^www\./, "");
  } catch {
    return endpoint.replace(/^https?:\/\//, "").split("/")[0];
  }
}

function providerName(provider?: string | null, endpoint?: string | null) {
  const value = (provider || "").toLowerCase();
  const host = hostname(endpoint).toLowerCase();
  if (value === "openrouter") return "OpenRouter";
  if (value === "nvidia") return "NVIDIA";
  if (value === "zai") return "Z.ai";
  const trustedHost = (domain: string) =>
    host === domain || host.endsWith(`.${domain}`);
  if (value === "custom" || !value) {
    if (trustedHost("openrouter.ai")) return "OpenRouter";
    if (trustedHost("nvidia.com")) return "NVIDIA";
    if (trustedHost("z.ai")) return "Z.ai";
  }
  if (value === "custom") return hostname(endpoint) || "Custom";
  if (value) return provider || "AI";
  return hostname(endpoint) || "AI";
}

function inferredTier(provider?: string | null): AiTier | undefined {
  if (provider === "zai") return "free";
  if (provider === "openrouter" || provider === "custom") return "byok";
  return undefined;
}

export function aiPendingLabel(language: AiLanguage) {
  return language === "ko" ? "AI 설명 대기 중" : "Waiting for AI explanation";
}

export function formatAiProvenance(
  provenance: AiProvenance,
  language: AiLanguage,
) {
  const tier =
    provenance.tier === "free" || provenance.tier === "byok"
      ? provenance.tier
      : inferredTier(provenance.provider);
  const tierLabel =
    tier === "free"
      ? language === "ko"
        ? "무료 티어"
        : "Free tier"
      : tier === "byok"
        ? "BYOK"
        : undefined;
  // The configured gateway is the user-visible provider. An upstream host is
  // routing detail and must not replace it in the main provenance label.
  const provider = providerName(provenance.provider, provenance.endpoint);
  const model = provenance.model || provenance.requestedModel || "—";
  return [...(tierLabel ? [tierLabel] : []), provider, model].join(" · ");
}
