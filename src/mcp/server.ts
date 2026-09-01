import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HackMdGateway, StateStore } from "../ports.js";
import { registerTools } from "./tools.js";

export const SERVER_INSTRUCTIONS =
  "Always call read_note before preparing an update. Use prepare_update with the returned base hash. Show the exact diff to the user, reading all chunks when truncated. Call apply_update only after the user explicitly approves that diff. Never claim ScribeSeal holds an exclusive lock. A stale or changed base must abort the write. Report update success only after post-write hash verification.";

type ServerDependencies = {
  gateway: HackMdGateway;
  store: StateStore;
  allowedNoteIds: ReadonlySet<string>;
  planTtlMinutes: number;
  now?: () => Date;
  createId?: () => string;
};

export function createScribeSealServer(dependencies: ServerDependencies): McpServer {
  const server = new McpServer(
    {
      name: "scribeseal",
      version: "0.1.0",
    },
    {
      instructions: SERVER_INSTRUCTIONS,
    },
  );
  registerTools(server, dependencies);
  return server;
}
