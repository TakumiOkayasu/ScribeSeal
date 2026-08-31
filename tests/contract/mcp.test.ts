import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { createScribeSealServer, SERVER_INSTRUCTIONS } from "../../src/mcp/server.js";
import type { StateStore } from "../../src/ports.js";
import { FakeGateway } from "../helpers.js";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function connect() {
  const gateway = new FakeGateway();
  const store = {
    pruneExpired: async () => undefined,
  } as unknown as StateStore;
  const server = createScribeSealServer({
    gateway,
    store,
    allowedNoteIds: new Set(["note-id"]),
    planTtlMinutes: 60,
  });
  const client = new Client({ name: "contract-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  closers.push(
    () => client.close(),
    () => server.close(),
  );
  return { client, gateway };
}

describe("MCP contract", () => {
  it("advertises exactly four tools, annotations, and safety instructions", async () => {
    const { client } = await connect();
    const tools = (await client.listTools()).tools;
    expect(tools.map((tool) => tool.name)).toEqual([
      "read_note",
      "prepare_update",
      "read_plan_diff",
      "apply_update",
    ]);
    expect(tools.find((tool) => tool.name === "read_note")?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
    expect(tools.find((tool) => tool.name === "apply_update")?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    });
    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
    expect(SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(512);
  });

  it("returns validated structured content and safe errors", async () => {
    const { client, gateway } = await connect();
    const success = await client.callTool({
      name: "read_note",
      arguments: { note_ref: "note-id" },
    });
    expect(success.isError).not.toBe(true);
    expect(success.structuredContent).toMatchObject({
      note_id: "note-id",
      title: "Test note",
      concurrency_capability: "preflight-best-effort",
    });
    const denied = await client.callTool({ name: "read_note", arguments: { note_ref: "other" } });
    expect(denied.isError).toBe(true);
    expect(JSON.stringify(denied)).not.toContain(gateway.note.content);
    expect(JSON.stringify(denied)).toContain("NOTE_NOT_ALLOWED");
  });
});
