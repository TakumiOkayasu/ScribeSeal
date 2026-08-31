import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { applyUpdate } from "../application/apply-update.js";
import { prepareUpdate } from "../application/prepare-update.js";
import { readNote } from "../application/read-note.js";
import { readPlanDiff } from "../application/read-plan-diff.js";
import { MAX_DIFF_CHUNK_CHARS } from "../core/content.js";
import { toSafeError } from "../core/errors.js";
import type { HackMdGateway, StateStore } from "../ports.js";

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const riskFlagSchema = z.enum([
  "empty_target",
  "deletes_at_least_half_of_base_lines",
  "target_at_most_quarter_of_base_bytes",
]);

export const readNoteInputSchema = z.strictObject({
  note_ref: z.string().min(1).max(2_048),
});

export const readNoteOutputSchema = z.strictObject({
  note_id: z.string(),
  title: z.string(),
  content: z.string(),
  content_sha256: sha256Schema,
  etag: z.string().nullable(),
  last_changed_at: z.string().nullable(),
  concurrency_capability: z.literal("preflight-best-effort"),
});

export const prepareUpdateInputSchema = z.strictObject({
  note_ref: z.string().min(1).max(2_048),
  expected_base_sha256: sha256Schema,
  replacement_content: z.string().max(5_000_000),
  reason: z.string().min(1).max(2_000),
  allow_large_rewrite: z.boolean().default(false),
});

export const prepareUpdateOutputSchema = z.strictObject({
  plan_id: z.uuid(),
  note_id: z.string(),
  base_sha256: sha256Schema,
  target_sha256: sha256Schema,
  diff_sha256: sha256Schema,
  added_lines: z.number().int().nonnegative(),
  deleted_lines: z.number().int().nonnegative(),
  risk_level: z.enum(["low", "medium", "high"]),
  risk_flags: z.array(riskFlagSchema),
  diff_preview: z.string(),
  diff_truncated: z.boolean(),
  expires_at: z.iso.datetime(),
});

export const readPlanDiffInputSchema = z.strictObject({
  plan_id: z.uuid(),
  offset: z.number().int().nonnegative().default(0),
  max_chars: z.number().int().min(1).max(MAX_DIFF_CHUNK_CHARS).default(12_000),
});

export const readPlanDiffOutputSchema = z.strictObject({
  plan_id: z.uuid(),
  diff_sha256: sha256Schema,
  offset: z.number().int().nonnegative(),
  next_offset: z.number().int().nonnegative(),
  complete: z.boolean(),
  content: z.string(),
});

export const applyUpdateInputSchema = z.strictObject({
  plan_id: z.uuid(),
  expected_target_sha256: sha256Schema,
  expected_diff_sha256: sha256Schema,
});

export const applyUpdateOutputSchema = z.strictObject({
  status: z.enum(["applied", "conflict", "verification_uncertain"]),
  receipt_id: z.uuid(),
  note_id: z.string(),
  base_sha256: sha256Schema,
  target_sha256: sha256Schema,
  verified_sha256: sha256Schema.nullable(),
  concurrency_guarantee: z.literal("preflight-best-effort"),
  updated_at: z.iso.datetime().nullable(),
  verified_at: z.iso.datetime(),
});

type ToolDependencies = {
  gateway: HackMdGateway;
  store: StateStore;
  allowedNoteIds: ReadonlySet<string>;
  planTtlMinutes: number;
  now?: () => Date;
  createId?: () => string;
};

function result<T extends object>(structuredContent: T, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }],
    structuredContent: structuredContent as Record<string, unknown>,
    isError,
  };
}

function errorResult(error: unknown) {
  const safe = toSafeError(error);
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ error: { code: safe.code, message: safe.message } }),
      },
    ],
    isError: true,
  };
}

export function registerTools(server: McpServer, dependencies: ToolDependencies): void {
  server.registerTool(
    "read_note",
    {
      title: "Read allowlisted HackMD note",
      description: "Read one allowlisted HackMD note and return its canonical content hash.",
      inputSchema: readNoteInputSchema,
      outputSchema: readNoteOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ note_ref }) => {
      try {
        await dependencies.store.pruneExpired();
        return result(await readNote(dependencies, note_ref));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "prepare_update",
    {
      title: "Prepare HackMD update",
      description:
        "Re-read an allowlisted note, fix a reviewable update plan locally, and return its diff and risk.",
      inputSchema: prepareUpdateInputSchema,
      outputSchema: prepareUpdateOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({
      note_ref,
      expected_base_sha256,
      replacement_content,
      reason,
      allow_large_rewrite,
    }) => {
      try {
        await dependencies.store.pruneExpired();
        return result(
          await prepareUpdate(dependencies, {
            noteRef: note_ref,
            expectedBaseSha256: expected_base_sha256,
            replacementContent: replacement_content,
            reason,
            allowLargeRewrite: allow_large_rewrite,
          }),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "read_plan_diff",
    {
      title: "Read update plan diff",
      description: "Read a bounded chunk of a prepared update plan diff.",
      inputSchema: readPlanDiffInputSchema,
      outputSchema: readPlanDiffOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ plan_id, offset, max_chars }) => {
      try {
        await dependencies.store.pruneExpired();
        return result(await readPlanDiff(dependencies, plan_id, offset, max_chars));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "apply_update",
    {
      title: "Apply approved HackMD update",
      description:
        "Apply one approved update plan after rechecking its artifacts and remote base, then verify the written hash.",
      inputSchema: applyUpdateInputSchema,
      outputSchema: applyUpdateOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ plan_id, expected_target_sha256, expected_diff_sha256 }) => {
      try {
        await dependencies.store.pruneExpired();
        const output = await applyUpdate(dependencies, {
          planId: plan_id,
          expectedTargetSha256: expected_target_sha256,
          expectedDiffSha256: expected_diff_sha256,
        });
        return result(output, output.status !== "applied");
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
