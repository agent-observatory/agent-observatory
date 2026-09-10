import { withWorkflow } from "workflow/next";
export default withWorkflow({
  transpilePackages: ["@agent-observatory/contracts"],
  serverExternalPackages: ["postgres"],
  outputFileTracingIncludes: { "/*": ["./lib/certs/supabase.crt"] },
  experimental: { serverActions: { bodySizeLimit: "1mb" } },
});
