import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const pluginRoot = resolve(process.env.SCRIBESEAL_SMOKE_PLUGIN_ROOT ?? ".");
const outsideCwd = resolve(process.env.SCRIBESEAL_SMOKE_CWD ?? process.cwd());
const transport = new StdioClientTransport({
  command: "node",
  args: [resolve(pluginRoot, "dist/scribeseal.mjs")],
  cwd: outsideCwd,
  env: {
    PATH: process.env.PATH ?? "",
    HMD_API_ACCESS_TOKEN: "smoke-not-a-real-token",
    SCRIBESEAL_ALLOWED_NOTE_IDS: "note-id",
  },
  stderr: "pipe",
});
const client = new Client({ name: "bundled-smoke", version: "1.0.0" });

try {
  await client.connect(transport);
  const names = (await client.listTools()).tools.map((tool) => tool.name);
  const expected = ["read_note", "prepare_update", "read_plan_diff", "apply_update"];
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected bundled tool list: ${JSON.stringify(names)}`);
  }
  const denied = await client.callTool({ name: "read_note", arguments: { note_ref: "other" } });
  if (denied.isError !== true || !JSON.stringify(denied).includes("NOTE_NOT_ALLOWED")) {
    throw new Error("Bundled server did not return the expected safe allowlist error.");
  }
} finally {
  await client.close();
}
