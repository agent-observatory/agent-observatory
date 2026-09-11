export function GET() {
  return new Response(
    `# Agent Observatory

A personal portal for coding-agent work. Sessions provides collection and analysis. Wiki currently offers an empty starting page; knowledge ingestion and search are not implemented.

## Documentation
- [Collector guide (Korean)](https://agent-session-atlas.vercel.app/docs/collector.md): installation, project/time/source filters, sync, residency, retention, agent workflow.
- [Collector guide (English)](https://agent-session-atlas.vercel.app/docs/collector.md?lang=en)
- [Web guide](https://agent-session-atlas.vercel.app/docs)

The web guide and Markdown share one content source. A Skill, plugin, and MCP server are not currently released.
`,
    { headers: { "content-type": "text/plain; charset=utf-8" } },
  );
}
