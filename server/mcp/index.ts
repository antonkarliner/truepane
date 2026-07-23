#!/usr/bin/env node
// Truepane MCP server — local stdio server that lets an AI agent create App
// Store / Play Store screenshot projects from local PNGs, style them, and
// render final PNGs to disk. Run with: npm run mcp (or tsx server/mcp/index.ts).
//
// IMPORTANT: this is a stdio server — stdout is the JSON-RPC channel. All
// logging must go to stderr (console.error).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import "./canvas"; // installs the @napi-rs/canvas factory into the core
import { registerDefaultFonts } from "./fonts";
import { registerTools } from "./tools";

async function main(): Promise<void> {
  registerDefaultFonts();
  const server = new McpServer({ name: "truepane", version: "0.1.8" });
  registerTools(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[truepane-mcp] server running on stdio");
}

main().catch((e) => {
  console.error("[truepane-mcp] fatal:", e);
  process.exit(1);
});
