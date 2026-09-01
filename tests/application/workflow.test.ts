import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileStateStore } from "../../src/adapters/file-state-store.js";
import { applyUpdate } from "../../src/application/apply-update.js";
import { prepareUpdate } from "../../src/application/prepare-update.js";
import { readNote } from "../../src/application/read-note.js";
import { ScribeSealError } from "../../src/core/errors.js";
import { ATTEMPT_ID, FakeGateway, PLAN_ID, RECEIPT_ID } from "../helpers.js";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "scribeseal-app-"));
  roots.push(root);
  const ids = [PLAN_ID, ATTEMPT_ID, ATTEMPT_ID, RECEIPT_ID, ATTEMPT_ID, RECEIPT_ID];
  const store = new FileStateStore(root, {
    createId: () => ids.shift() ?? ATTEMPT_ID,
    now: () => new Date("2026-08-31T00:00:00.000Z"),
  });
  const gateway = new FakeGateway();
  const dependencies = {
    gateway,
    store,
    allowedNoteIds: new Set(["note-id"]),
    planTtlMinutes: 60,
    now: () => new Date("2026-08-31T00:00:00.000Z"),
    createId: () => RECEIPT_ID,
  };
  const read = await readNote(dependencies, "note-id");
  return { root, gateway, store, dependencies, read };
}

async function prepare() {
  const context = await setup();
  const plan = await prepareUpdate(context.dependencies, {
    noteRef: "note-id",
    expectedBaseSha256: context.read.content_sha256,
    replacementContent: "# Target\n",
    reason: "test",
    allowLargeRewrite: false,
  });
  return { ...context, plan };
}

describe("application workflow", () => {
  it("reads, prepares, applies, verifies, and never patches twice", async () => {
    const { dependencies, gateway, plan } = await prepare();
    const input = {
      planId: plan.plan_id,
      expectedTargetSha256: plan.target_sha256,
      expectedDiffSha256: plan.diff_sha256,
    };
    expect((await applyUpdate(dependencies, input)).status).toBe("applied");
    expect((await applyUpdate(dependencies, input)).status).toBe("applied");
    expect(gateway.patchCount).toBe(1);
  });

  it("rejects a changed base before patching", async () => {
    const { dependencies, gateway, plan } = await prepare();
    gateway.note.content = "someone else changed it\n";
    const output = await applyUpdate(dependencies, {
      planId: plan.plan_id,
      expectedTargetSha256: plan.target_sha256,
      expectedDiffSha256: plan.diff_sha256,
    });
    expect(output.status).toBe("conflict");
    expect(gateway.patchCount).toBe(0);
  });

  it("does not retry an uncertain PATCH and records an uncertain base observation", async () => {
    const { dependencies, gateway, plan } = await prepare();
    gateway.patchError = new ScribeSealError("PATCH_OUTCOME_UNKNOWN", "Patch outcome is unknown.");
    const output = await applyUpdate(dependencies, {
      planId: plan.plan_id,
      expectedTargetSha256: plan.target_sha256,
      expectedDiffSha256: plan.diff_sha256,
    });
    expect(output.status).toBe("verification_uncertain");
    expect(gateway.patchCount).toBe(1);
  });

  it("accepts a target hash observed after a lost PATCH response", async () => {
    const { dependencies, gateway, plan } = await prepare();
    gateway.patchErrorAfterWrite = new ScribeSealError(
      "PATCH_OUTCOME_UNKNOWN",
      "Patch outcome is unknown.",
    );
    const output = await applyUpdate(dependencies, {
      planId: plan.plan_id,
      expectedTargetSha256: plan.target_sha256,
      expectedDiffSha256: plan.diff_sha256,
    });
    expect(output.status).toBe("applied");
    expect(output.verified_sha256).toBe(plan.target_sha256);
    expect(gateway.patchCount).toBe(1);
  });

  it("does not retry or roll back a post-write mismatch", async () => {
    const { dependencies, gateway, plan } = await prepare();
    gateway.afterPatchContent = "third-party content\n";
    const output = await applyUpdate(dependencies, {
      planId: plan.plan_id,
      expectedTargetSha256: plan.target_sha256,
      expectedDiffSha256: plan.diff_sha256,
    });
    expect(output.status).toBe("verification_uncertain");
    expect(gateway.patchCount).toBe(1);
    expect(gateway.note.content).toBe("third-party content\n");
  });

  it("rejects a tampered target before remote access", async () => {
    const { root, dependencies, gateway, plan } = await prepare();
    await writeFile(join(root, "plans", plan.plan_id, "target.md"), "tampered", { mode: 0o600 });
    await expect(
      applyUpdate(dependencies, {
        planId: plan.plan_id,
        expectedTargetSha256: plan.target_sha256,
        expectedDiffSha256: plan.diff_sha256,
      }),
    ).rejects.toMatchObject({ code: "PLAN_TAMPERED" });
    expect(gateway.patchCount).toBe(0);
  });

  it("blocks high-risk rewrites without explicit acknowledgement", async () => {
    const context = await setup();
    context.gateway.note.content = Array.from({ length: 20 }, (_, index) => `line ${index}`).join(
      "\n",
    );
    const fresh = await readNote(context.dependencies, "note-id");
    await expect(
      prepareUpdate(context.dependencies, {
        noteRef: "note-id",
        expectedBaseSha256: fresh.content_sha256,
        replacementContent: "",
        reason: "test",
        allowLargeRewrite: false,
      }),
    ).rejects.toMatchObject({ code: "HIGH_RISK_REWRITE" });
  });

  it("allows a high-risk plan only with explicit acknowledgement", async () => {
    const context = await setup();
    context.gateway.note.content = Array.from({ length: 20 }, (_, index) => `line ${index}`).join(
      "\n",
    );
    const fresh = await readNote(context.dependencies, "note-id");
    const output = await prepareUpdate(context.dependencies, {
      noteRef: "note-id",
      expectedBaseSha256: fresh.content_sha256,
      replacementContent: "",
      reason: "test",
      allowLargeRewrite: true,
    });
    expect(output.risk_level).toBe("high");
  });

  it("creates no plan for a no-op", async () => {
    const context = await setup();
    await expect(
      prepareUpdate(context.dependencies, {
        noteRef: "note-id",
        expectedBaseSha256: context.read.content_sha256,
        replacementContent: context.read.content,
        reason: "test",
        allowLargeRewrite: false,
      }),
    ).rejects.toMatchObject({ code: "NO_CHANGES" });
  });
});
