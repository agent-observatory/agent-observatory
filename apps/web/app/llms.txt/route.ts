export function GET() {
  return new Response(
    `# AgentSession Atlas

Coding-agent session collection and analysis.

## Documentation
- [Collector guide (Korean)](https://agent-session-atlas.vercel.app/docs/collector.md): installation, project/time/source filters, sync, residency, retention, agent workflow.
- [Collector guide (English)](https://agent-session-atlas.vercel.app/docs/collector.md?lang=en)
- [Web guide](https://agent-session-atlas.vercel.app/docs)

The web guide and Markdown share one content source. A Skill, plugin, and MCP server are not currently released.
`,
    { headers: { "content-type": "text/plain; charset=utf-8" } },
  );
}
