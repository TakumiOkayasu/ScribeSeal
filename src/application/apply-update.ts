import { randomUUID } from "node:crypto";
import {
  assertAllowedNote,
  assertWorkspaceMatches,
  canonicalizeContent,
  createUnifiedDiff,
  parseNoteReference,
  sha256,
} from "../core/content.js";
import { ScribeSealError } from "../core/errors.js";
import type {
  ApplyUpdateOutput,
  ReceiptStatus,
  RemoteNote,
  StoredPlan,
  UpdateReceipt,
} from "../core/models.js";
import type { HackMdGateway, StateStore } from "../ports.js";

type ApplyUpdateDependencies = {
  gateway: HackMdGateway;
  store: StateStore;
  allowedNoteIds: ReadonlySet<string>;
  now?: () => Date;
  createId?: () => string;
};

export interface ApplyUpdateInput {
  planId: string;
  expectedTargetSha256: string;
  expectedDiffSha256: string;
}

function nowIso(dependencies: ApplyUpdateDependencies): string {
  return (dependencies.now ?? (() => new Date()))().toISOString();
}

function assertExpectedHashes(stored: StoredPlan, input: ApplyUpdateInput): void {
  if (
    stored.plan.target_sha256 !== input.expectedTargetSha256 ||
    stored.plan.diff_sha256 !== input.expectedDiffSha256
  ) {
    throw new ScribeSealError(
      "TARGET_MISMATCH",
      "The approved target or diff hash does not match the stored update plan.",
    );
  }
}

function assertArtifacts(stored: StoredPlan): void {
  if (
    sha256(stored.base) !== stored.plan.base_sha256 ||
    sha256(stored.target) !== stored.plan.target_sha256 ||
    sha256(stored.diff) !== stored.plan.diff_sha256 ||
    createUnifiedDiff(stored.base, stored.target) !== stored.diff
  ) {
    throw new ScribeSealError("PLAN_TAMPERED", "The update plan artifacts are inconsistent.");
  }
}

function remoteBaseChanged(stored: StoredPlan, remote: RemoteNote): boolean {
  const contentChanged = sha256(canonicalizeContent(remote.content)) !== stored.plan.base_sha256;
  const etagChanged = stored.plan.base_etag !== undefined && remote.etag !== stored.plan.base_etag;
  const timestampChanged =
    stored.plan.base_last_changed_at !== undefined &&
    remote.lastChangedAt !== stored.plan.base_last_changed_at;
  return contentChanged || etagChanged || timestampChanged;
}

function createReceipt(
  dependencies: ApplyUpdateDependencies,
  stored: StoredPlan,
  status: ReceiptStatus,
  values: {
    updatedAt?: string;
    verifiedSha256?: string;
    observedSha256?: string;
  } = {},
): UpdateReceipt {
  return {
    schema_version: 1,
    receipt_id: (dependencies.createId ?? randomUUID)(),
    plan_id: stored.plan.plan_id,
    status,
    note_id: stored.plan.note_id,
    base_sha256: stored.plan.base_sha256,
    target_sha256: stored.plan.target_sha256,
    ...(values.verifiedSha256 === undefined ? {} : { verified_sha256: values.verifiedSha256 }),
    ...(values.observedSha256 === undefined ? {} : { observed_sha256: values.observedSha256 }),
    concurrency_guarantee: "preflight-best-effort",
    ...(values.updatedAt === undefined ? {} : { updated_at: values.updatedAt }),
    verified_at: nowIso(dependencies),
  };
}

function receiptToOutput(receipt: UpdateReceipt): ApplyUpdateOutput {
  if (receipt.status === "failed") {
    throw new ScribeSealError("PLAN_STATE_INCONSISTENT", "The update plan previously failed.");
  }
  return {
    status: receipt.status,
    receipt_id: receipt.receipt_id,
    note_id: receipt.note_id,
    base_sha256: receipt.base_sha256,
    target_sha256: receipt.target_sha256,
    verified_sha256: receipt.verified_sha256 ?? null,
    concurrency_guarantee: receipt.concurrency_guarantee,
    updated_at: receipt.updated_at ?? null,
    verified_at: receipt.verified_at,
  };
}

async function persistTerminal(
  store: StateStore,
  receipt: UpdateReceipt,
  status: ReceiptStatus,
): Promise<void> {
  await store.saveReceipt(receipt);
  await store.updatePlanStatus(receipt.plan_id, status);
}

function assertReusableOrReturn(
  stored: StoredPlan,
  input: ApplyUpdateInput,
): ApplyUpdateOutput | null {
  assertExpectedHashes(stored, input);
  if (stored.plan.status === "prepared") {
    return null;
  }
  if (
    stored.plan.status === "applied" ||
    stored.plan.status === "conflict" ||
    stored.plan.status === "verification_uncertain"
  ) {
    if (stored.receipt === undefined || stored.receipt.status !== stored.plan.status) {
      throw new ScribeSealError(
        "PLAN_STATE_INCONSISTENT",
        "The update plan terminal state has no matching receipt.",
      );
    }
    return receiptToOutput(stored.receipt);
  }
  throw new ScribeSealError(
    "APPLY_STATE_UNCERTAIN",
    "The update plan cannot be safely applied again.",
  );
}

export async function applyUpdate(
  dependencies: ApplyUpdateDependencies,
  input: ApplyUpdateInput,
): Promise<ApplyUpdateOutput> {
  let stored = await dependencies.store.getPlan(input.planId);
  const previousResult = assertReusableOrReturn(stored, input);
  if (previousResult !== null) {
    return previousResult;
  }

  const expiresAt = Date.parse(stored.plan.expires_at);
  const currentTime = (dependencies.now ?? (() => new Date()))().getTime();
  if (!Number.isFinite(expiresAt) || currentTime >= expiresAt) {
    throw new ScribeSealError("PLAN_EXPIRED", "The update plan has expired.");
  }

  const applyLock = await dependencies.store.acquireApplyLock(input.planId);
  let terminalPersisted = false;
  let applyingPersisted = false;
  let patchAttempted = false;

  try {
    stored = await dependencies.store.getPlan(input.planId);
    const resultAfterLock = assertReusableOrReturn(stored, input);
    if (resultAfterLock !== null) {
      terminalPersisted = true;
      return resultAfterLock;
    }
    assertArtifacts(stored);
    const reference = parseNoteReference(stored.plan.note_url);
    if (reference.noteId !== stored.plan.note_id) {
      throw new ScribeSealError("PLAN_TAMPERED", "The update plan note reference is inconsistent.");
    }
    assertAllowedNote(reference.noteId, dependencies.allowedNoteIds);

    await dependencies.store.updatePlanStatus(input.planId, "applying");
    applyingPersisted = true;
    const current = await dependencies.gateway.getNote(reference.noteId);
    assertWorkspaceMatches(reference, current);
    if (remoteBaseChanged(stored, current)) {
      const receipt = createReceipt(dependencies, stored, "conflict", {
        observedSha256: sha256(canonicalizeContent(current.content)),
      });
      await persistTerminal(dependencies.store, receipt, "conflict");
      terminalPersisted = true;
      return receiptToOutput(receipt);
    }

    let updatedAt: string | undefined;
    try {
      patchAttempted = true;
      const update = await dependencies.gateway.updateNoteContent(reference.noteId, stored.target, {
        type: "preflight-best-effort",
      });
      updatedAt = update.updatedAt;
    } catch (error) {
      if (!(error instanceof ScribeSealError && error.code === "PATCH_OUTCOME_UNKNOWN")) {
        const receipt = createReceipt(dependencies, stored, "failed");
        await persistTerminal(dependencies.store, receipt, "failed");
        terminalPersisted = true;
        throw error;
      }

      let observedSha256: string | undefined;
      try {
        const observed = await dependencies.gateway.getNote(reference.noteId);
        assertWorkspaceMatches(reference, observed);
        observedSha256 = sha256(canonicalizeContent(observed.content));
      } catch {
        // The receipt intentionally records no content or raw error details.
      }
      if (observedSha256 === stored.plan.target_sha256) {
        const receipt = createReceipt(dependencies, stored, "applied", {
          verifiedSha256: observedSha256,
        });
        await persistTerminal(dependencies.store, receipt, "applied");
        terminalPersisted = true;
        return receiptToOutput(receipt);
      }

      const receipt = createReceipt(dependencies, stored, "verification_uncertain", {
        ...(observedSha256 === undefined ? {} : { observedSha256 }),
      });
      await persistTerminal(dependencies.store, receipt, "verification_uncertain");
      terminalPersisted = true;
      return receiptToOutput(receipt);
    }

    let observedSha256: string | undefined;
    try {
      const observed = await dependencies.gateway.getNote(reference.noteId);
      assertWorkspaceMatches(reference, observed);
      observedSha256 = sha256(canonicalizeContent(observed.content));
    } catch {
      // Verification failure is persisted without serializing the underlying error.
    }

    if (observedSha256 === stored.plan.target_sha256) {
      const receipt = createReceipt(dependencies, stored, "applied", {
        ...(updatedAt === undefined ? {} : { updatedAt }),
        verifiedSha256: observedSha256,
      });
      await persistTerminal(dependencies.store, receipt, "applied");
      terminalPersisted = true;
      return receiptToOutput(receipt);
    }

    const receipt = createReceipt(dependencies, stored, "verification_uncertain", {
      ...(updatedAt === undefined ? {} : { updatedAt }),
      ...(observedSha256 === undefined ? {} : { observedSha256 }),
    });
    await persistTerminal(dependencies.store, receipt, "verification_uncertain");
    terminalPersisted = true;
    return receiptToOutput(receipt);
  } catch (error) {
    if (applyingPersisted && !patchAttempted && !terminalPersisted) {
      try {
        const receipt = createReceipt(dependencies, stored, "failed");
        await persistTerminal(dependencies.store, receipt, "failed");
        terminalPersisted = true;
      } catch {
        // Leave the local apply guard in place when terminal persistence fails.
      }
    }
    throw error;
  } finally {
    if (terminalPersisted) {
      await applyLock.release();
    }
  }
}
