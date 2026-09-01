import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { FileStateStore } from "./adapters/file-state-store.js";
import { HackMdApiGateway } from "./adapters/hackmd-api.js";
import { loadConfig } from "./config.js";
import { toSafeError } from "./core/errors.js";
import { createScribeSealServer } from "./mcp/server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const store = new FileStateStore(config.stateDirectory, {
    retentionHours: config.retentionHours,
  });
  await store.pruneExpired();
  const gateway = new HackMdApiGateway(config.token);
  const server = createScribeSealServer({
    gateway,
    store,
    allowedNoteIds: config.allowedNoteIds,
    planTtlMinutes: config.planTtlMinutes,
  });
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  const safe = toSafeError(error);
  process.stderr.write(`${safe.code}: ${safe.message}\n`);
  process.exitCode = 1;
});
