import { defineConfig } from "tsup";
export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node22",
  removeNodeProtocol: false,
  splitting: false,
  clean: true,
  noExternal: ["@agent-observatory/contracts", "zod"],
});
