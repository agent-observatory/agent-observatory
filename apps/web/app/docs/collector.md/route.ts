import { collectorGuideMarkdown } from "../../../lib/collector-guide";
export function GET(request: Request) {
  const language =
    new URL(request.url).searchParams.get("lang") === "en" ? "en" : "ko";
  return new Response(collectorGuideMarkdown(language), {
    headers: { "content-type": "text/markdown; charset=utf-8" },
  });
}
