import { chmod, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileStateStore } from "../../src/adapters/file-state-store.js";
import { createUnifiedDiff, sha256 } from "../../src/core/content.js";
import { ATTEMPT_ID, PLAN_ID } from "../helpers.js";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true }));
  }
});

async function createStore() {
  const root = await mkdtemp(join(tmpdir(), "scribeseal-state-"));
  roots.push(root);
  const ids = [PLAN_ID, ATTEMPT_ID, ATTEMPT_ID, ATTEMPT_ID];
  const store = new FileStateStore(root, { createId: () => ids.shift() ?? ATTEMPT_ID });
  const base = "# Base\n";
  const target = "# Target\n";
  const diff = createUnifiedDiff(base, target);
  const plan = await store.createPlan({
    noteId: "note-id",
    noteUrl: "https://hackmd.io/note-id",
    reason: "test",
    base,
    target,
    diff,
    baseSha256: sha256(base),
    targetSha256: sha256(target),
    diffSha256: sha256(diff),
    createdAt: "2026-08-31T00:00:00.000Z",
    expiresAt: "2026-08-31T01:00:00.000Z",
  });
  return { root, store, plan };
}

describe("file state store", () => {
  it("creates private artifacts and rejects lock contention", async () => {
    const { root, store, plan } = await createStore();
    const mode = (await import("node:fs/promises")).stat;
    if (process.platform !== "win32") {
      expect((await mode(join(root, "plans", plan.plan_id))).mode & 0o777).toBe(0o700);
      expect((await mode(join(root, "plans", plan.plan_id, "base.md"))).mode & 0o777).toBe(0o600);
    }
    const lock = await store.acquireApplyLock(plan.plan_id);
    await expect(store.acquireApplyLock(plan.plan_id)).rejects.toMatchObject({
      code: "APPLY_STATE_UNCERTAIN",
    });
    await lock.release();
  });

  it("exposes artifact tampering for application-level hash validation", async () => {
    const { root, store, plan } = await createStore();
    const path = join(root, "plans", plan.plan_id, "target.md");
    await writeFile(path, "changed", { mode: 0o600 });
    await chmod(path, 0o600);
    expect((await store.getPlan(plan.plan_id)).target).toBe("changed");
  });

  it("rejects symlinked artifacts", async () => {
    if (process.platform === "win32") return;
    const { root, store, plan } = await createStore();
    const path = join(root, "plans", plan.plan_id, "target.md");
    const original = await readFile(path, "utf8");
    await import("node:fs/promises").then(({ unlink }) => unlink(path));
    await symlink("base.md", path);
    expect(original).not.toBe("# Base\n");
    await expect(store.getPlan(plan.plan_id)).rejects.toMatchObject({ code: "PLAN_TAMPERED" });
  });
});
