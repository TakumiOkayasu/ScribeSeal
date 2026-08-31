import {
  analyzeDiff,
  assertAllowedNote,
  assertWorkspaceMatches,
  canonicalizeContent,
  DEFAULT_DIFF_PREVIEW_CHARS,
  parseNoteReference,
  sha256,
} from "../core/content.js";
import { ScribeSealError } from "../core/errors.js";
import type { PrepareUpdateOutput } from "../core/models.js";
import type { HackMdGateway, StateStore } from "../ports.js";

type PrepareUpdateDependencies = {
  gateway: HackMdGateway;
  store: StateStore;
  allowedNoteIds: ReadonlySet<string>;
  planTtlMinutes: number;
  now?: () => Date;
};

export interface PrepareUpdateInput {
  noteRef: string;
  expectedBaseSha256: string;
  replacementContent: string;
  reason: string;
  allowLargeRewrite: boolean;
}

export async function prepareUpdate(
  dependencies: PrepareUpdateDependencies,
  input: PrepareUpdateInput,
): Promise<PrepareUpdateOutput> {
  const reference = parseNoteReference(input.noteRef);
  assertAllowedNote(reference.noteId, dependencies.allowedNoteIds);
  const remote = await dependencies.gateway.getNote(reference.noteId);
  assertWorkspaceMatches(reference, remote);

  const base = canonicalizeContent(remote.content);
  const baseSha256 = sha256(base);
  if (baseSha256 !== input.expectedBaseSha256) {
    throw new ScribeSealError(
      "BASE_CHANGED",
      "The HackMD note changed after it was read. Prepare a new update from a fresh read.",
    );
  }

  const target = canonicalizeContent(input.replacementContent);
  const targetSha256 = sha256(target);
  if (targetSha256 === baseSha256) {
    throw new ScribeSealError("NO_CHANGES", "The replacement content does not change the note.");
  }

  const analysis = analyzeDiff(base, target);
  if (analysis.riskLevel === "high" && !input.allowLargeRewrite) {
    throw new ScribeSealError(
      "HIGH_RISK_REWRITE",
      "The proposed update is high risk and requires allow_large_rewrite=true.",
    );
  }

  const now = (dependencies.now ?? (() => new Date()))();
  const expiresAt = new Date(now.getTime() + dependencies.planTtlMinutes * 60_000);
  const plan = await dependencies.store.createPlan({
    noteId: reference.noteId,
    noteUrl: reference.noteUrl,
    reason: input.reason,
    base,
    target,
    diff: analysis.diff,
    baseSha256,
    targetSha256,
    diffSha256: analysis.diffSha256,
    ...(remote.etag === undefined ? {} : { baseEtag: remote.etag }),
    ...(remote.lastChangedAt === undefined ? {} : { baseLastChangedAt: remote.lastChangedAt }),
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });

  const diffPreview = analysis.diff.slice(0, DEFAULT_DIFF_PREVIEW_CHARS);
  return {
    plan_id: plan.plan_id,
    note_id: plan.note_id,
    base_sha256: plan.base_sha256,
    target_sha256: plan.target_sha256,
    diff_sha256: plan.diff_sha256,
    added_lines: analysis.addedLines,
    deleted_lines: analysis.deletedLines,
    risk_level: analysis.riskLevel,
    risk_flags: analysis.riskFlags,
    diff_preview: diffPreview,
    diff_truncated: diffPreview.length < analysis.diff.length,
    expires_at: plan.expires_at,
  };
}
