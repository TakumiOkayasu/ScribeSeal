import { assertPlanId, MAX_DIFF_CHUNK_CHARS, sha256 } from "../core/content.js";
import { ScribeSealError } from "../core/errors.js";
import type { ReadPlanDiffOutput } from "../core/models.js";
import type { StateStore } from "../ports.js";

type ReadPlanDiffDependencies = {
  store: StateStore;
  now?: () => Date;
};

export async function readPlanDiff(
  dependencies: ReadPlanDiffDependencies,
  planId: string,
  offset: number,
  maxChars: number,
): Promise<ReadPlanDiffOutput> {
  assertPlanId(planId);
  const stored = await dependencies.store.getPlan(planId);
  const now = (dependencies.now ?? (() => new Date()))().getTime();
  const expiresAt = Date.parse(stored.plan.expires_at);
  if (!Number.isFinite(expiresAt) || now >= expiresAt) {
    throw new ScribeSealError("PLAN_EXPIRED", "The update plan has expired.");
  }
  if (sha256(stored.diff) !== stored.plan.diff_sha256) {
    throw new ScribeSealError("PLAN_TAMPERED", "The update plan diff no longer matches its hash.");
  }

  const boundedMaxChars = Math.min(Math.max(maxChars, 1), MAX_DIFF_CHUNK_CHARS);
  const boundedOffset = Math.min(Math.max(offset, 0), stored.diff.length);
  const nextOffset = Math.min(boundedOffset + boundedMaxChars, stored.diff.length);
  return {
    plan_id: planId,
    diff_sha256: stored.plan.diff_sha256,
    offset: boundedOffset,
    next_offset: nextOffset,
    complete: nextOffset >= stored.diff.length,
    content: stored.diff.slice(boundedOffset, nextOffset),
  };
}
