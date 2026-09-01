import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { FileStateStore } from "../../src/adapters/file-state-store.js";
import { HackMdApiGateway } from "../../src/adapters/hackmd-api.js";
import { applyUpdate } from "../../src/application/apply-update.js";
import { prepareUpdate } from "../../src/application/prepare-update.js";
import { readNote } from "../../src/application/read-note.js";

const enabled = process.env.SCRIBESEAL_RUN_LIVE_TESTS === "1";
const roots: string[] = [];
afterAll(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe.skipIf(!enabled)("live HackMD integration", () => {
  it("updates only the dedicated test note, detects stale content, and restores once", async () => {
    const token = process.env.HMD_API_ACCESS_TOKEN;
    const noteId = process.env.SCRIBESEAL_TEST_NOTE_ID;
    const allowlist = new Set((process.env.SCRIBESEAL_ALLOWED_NOTE_IDS ?? "").split(","));
    if (!token || !noteId || !allowlist.has(noteId)) {
      throw new Error("Live tests require the token and an explicitly allowlisted test note.");
    }
    const root = await mkdtemp(join(tmpdir(), "scribeseal-live-"));
    roots.push(root);
    const gateway = new HackMdApiGateway(token);
    const store = new FileStateStore(root);
    const dependencies = { gateway, store, allowedNoteIds: new Set([noteId]), planTtlMinutes: 60 };
    const original = await readNote(dependencies, noteId);
    const marker = `\n<!-- scribeseal-live-${crypto.randomUUID()} -->`;

    const stalePlan = await prepareUpdate(dependencies, {
      noteRef: noteId,
      expectedBaseSha256: original.content_sha256,
      replacementContent: `${original.content}\n<!-- scribeseal-stale-${crypto.randomUUID()} -->`,
      reason: "ScribeSeal stale-base integration test",
      allowLargeRewrite: false,
    });
    const updatePlan = await prepareUpdate(dependencies, {
      noteRef: noteId,
      expectedBaseSha256: original.content_sha256,
      replacementContent: original.content + marker,
      reason: "ScribeSeal opt-in integration test",
      allowLargeRewrite: false,
    });
    try {
      const applied = await applyUpdate(dependencies, {
        planId: updatePlan.plan_id,
        expectedTargetSha256: updatePlan.target_sha256,
        expectedDiffSha256: updatePlan.diff_sha256,
      });
      expect(applied.status).toBe("applied");

      const stale = await applyUpdate(dependencies, {
        planId: stalePlan.plan_id,
        expectedTargetSha256: stalePlan.target_sha256,
        expectedDiffSha256: stalePlan.diff_sha256,
      });
      expect(stale.status).toBe("conflict");
    } finally {
      const current = await readNote(dependencies, noteId);
      if (current.content_sha256 !== original.content_sha256) {
        const restorePlan = await prepareUpdate(dependencies, {
          noteRef: noteId,
          expectedBaseSha256: current.content_sha256,
          replacementContent: original.content,
          reason: "Restore ScribeSeal integration test note",
          allowLargeRewrite: true,
        });
        const restored = await applyUpdate(dependencies, {
          planId: restorePlan.plan_id,
          expectedTargetSha256: restorePlan.target_sha256,
          expectedDiffSha256: restorePlan.diff_sha256,
        });
        expect(restored.status).toBe("applied");
        expect((await readNote(dependencies, noteId)).content_sha256).toBe(original.content_sha256);
      }
    }
  });
});
