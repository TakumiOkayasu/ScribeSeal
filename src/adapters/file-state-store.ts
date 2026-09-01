import { randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import {
  chmod,
  constants,
  type FileHandle,
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rmdir,
  unlink,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { assertPlanId, NOTE_ID_PATTERN, PLAN_ID_PATTERN } from "../core/content.js";
import { ScribeSealError } from "../core/errors.js";
import type {
  ApplyLock,
  CreatePlanInput,
  PlanStatus,
  StoredPlan,
  UpdatePlan,
  UpdateReceipt,
} from "../core/models.js";
import type { StateStore } from "../ports.js";

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const PLAN_FILES = new Set([
  "base.md",
  "target.md",
  "diff.patch",
  "plan.json",
  "apply.lock",
  "receipt.json",
]);
const TERMINAL_STATUSES = new Set<PlanStatus>([
  "applied",
  "conflict",
  "failed",
  "verification_uncertain",
]);
const VALID_STATUSES = new Set<PlanStatus>([
  "prepared",
  "applying",
  "applied",
  "conflict",
  "failed",
  "verification_uncertain",
]);

interface FileStateStoreOptions {
  now?: () => Date;
  createId?: () => string;
  retentionHours?: number;
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function noFollowFlag(): number {
  return process.platform === "win32" ? 0 : constants.O_NOFOLLOW;
}

async function syncDirectory(path: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | noFollowFlag());
    await handle.sync();
  } catch (error) {
    if (
      !isNodeError(error, "EINVAL") &&
      !isNodeError(error, "ENOTSUP") &&
      !isNodeError(error, "EBADF")
    ) {
      throw error;
    }
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: DIRECTORY_MODE });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new ScribeSealError("PLAN_TAMPERED", "The state directory is not a safe directory.");
  }
  if (process.platform !== "win32") {
    await chmod(path, DIRECTORY_MODE);
  }
}

async function assertPrivateDirectory(path: string): Promise<void> {
  let info: Stats;
  try {
    info = await lstat(path);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      throw new ScribeSealError("PLAN_NOT_FOUND", "The update plan was not found.");
    }
    throw error;
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new ScribeSealError("PLAN_TAMPERED", "The update plan directory is invalid.");
  }
  if (process.platform !== "win32" && (info.mode & 0o077) !== 0) {
    throw new ScribeSealError("PLAN_TAMPERED", "The update plan directory permissions are unsafe.");
  }
}

async function writeNewPrivateFile(path: string, content: string): Promise<void> {
  const handle = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollowFlag(),
    FILE_MODE,
  );
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function replacePrivateFile(path: string, content: string, createId: () => string) {
  const temporaryPath = join(dirname(path), `.${basename(path)}.${createId()}.tmp`);
  let committed = false;
  try {
    await writeNewPrivateFile(temporaryPath, content);
    await rename(temporaryPath, path);
    committed = true;
    await syncDirectory(dirname(path));
  } finally {
    if (!committed) {
      await unlink(temporaryPath).catch(() => undefined);
    }
  }
}

async function readPrivateFile(path: string): Promise<string> {
  const before = await lstat(path).catch((error: unknown) => {
    if (isNodeError(error, "ENOENT")) {
      throw new ScribeSealError("PLAN_TAMPERED", "An update plan artifact is missing.");
    }
    throw error;
  });
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new ScribeSealError("PLAN_TAMPERED", "An update plan artifact is invalid.");
  }
  if (process.platform !== "win32" && (before.mode & 0o077) !== 0) {
    throw new ScribeSealError("PLAN_TAMPERED", "Update plan artifact permissions are unsafe.");
  }

  const handle = await open(path, constants.O_RDONLY | noFollowFlag());
  try {
    const after = await handle.stat();
    if (!after.isFile()) {
      throw new ScribeSealError("PLAN_TAMPERED", "An update plan artifact is invalid.");
    }
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function parsePlan(content: string, expectedPlanId: string): UpdatePlan {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new ScribeSealError("PLAN_TAMPERED", "The update plan metadata is invalid.");
  }

  if (
    !isRecord(value) ||
    value.schema_version !== 1 ||
    value.plan_id !== expectedPlanId ||
    typeof value.note_id !== "string" ||
    !NOTE_ID_PATTERN.test(value.note_id) ||
    typeof value.note_url !== "string" ||
    typeof value.reason !== "string" ||
    typeof value.base_sha256 !== "string" ||
    typeof value.target_sha256 !== "string" ||
    typeof value.diff_sha256 !== "string" ||
    !optionalString(value.base_etag) ||
    !optionalString(value.base_last_changed_at) ||
    typeof value.created_at !== "string" ||
    typeof value.expires_at !== "string" ||
    typeof value.status !== "string" ||
    !VALID_STATUSES.has(value.status as PlanStatus) ||
    !optionalString(value.terminal_at)
  ) {
    throw new ScribeSealError("PLAN_TAMPERED", "The update plan metadata is invalid.");
  }

  return value as unknown as UpdatePlan;
}

function parseReceipt(content: string, expectedPlanId: string): UpdateReceipt {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new ScribeSealError("PLAN_STATE_INCONSISTENT", "The update receipt is invalid.");
  }
  if (
    !isRecord(value) ||
    value.schema_version !== 1 ||
    value.plan_id !== expectedPlanId ||
    typeof value.receipt_id !== "string" ||
    typeof value.status !== "string" ||
    typeof value.note_id !== "string" ||
    typeof value.base_sha256 !== "string" ||
    typeof value.target_sha256 !== "string" ||
    !optionalString(value.verified_sha256) ||
    !optionalString(value.observed_sha256) ||
    value.concurrency_guarantee !== "preflight-best-effort" ||
    !optionalString(value.updated_at) ||
    typeof value.verified_at !== "string"
  ) {
    throw new ScribeSealError("PLAN_STATE_INCONSISTENT", "The update receipt is invalid.");
  }
  return value as unknown as UpdateReceipt;
}

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function assertTransition(current: PlanStatus, next: PlanStatus): void {
  const allowed =
    current === "prepared"
      ? new Set<PlanStatus>(["applying"])
      : current === "applying"
        ? TERMINAL_STATUSES
        : new Set<PlanStatus>();
  if (!allowed.has(next)) {
    throw new ScribeSealError(
      "INVALID_PLAN_STATUS",
      "The update plan status transition is invalid.",
    );
  }
}

export class FileStateStore implements StateStore {
  readonly rootDirectory: string;
  readonly plansDirectory: string;
  readonly retentionHours: number;
  readonly now: () => Date;
  readonly createId: () => string;

  constructor(rootDirectory: string, options: FileStateStoreOptions = {}) {
    this.rootDirectory = rootDirectory;
    this.plansDirectory = join(rootDirectory, "plans");
    this.retentionHours = options.retentionHours ?? 24;
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
  }

  private async initialize(): Promise<void> {
    await ensurePrivateDirectory(this.rootDirectory);
    await ensurePrivateDirectory(this.plansDirectory);
  }

  private planDirectory(planId: string): string {
    assertPlanId(planId);
    return join(this.plansDirectory, planId);
  }

  async createPlan(input: CreatePlanInput): Promise<UpdatePlan> {
    await this.initialize();
    const planId = this.createId();
    assertPlanId(planId);
    const stagingDirectory = join(this.plansDirectory, `.plan-${planId}-${this.createId()}.tmp`);
    const finalDirectory = this.planDirectory(planId);

    const plan: UpdatePlan = {
      schema_version: 1,
      plan_id: planId,
      note_id: input.noteId,
      note_url: input.noteUrl,
      reason: input.reason,
      base_sha256: input.baseSha256,
      target_sha256: input.targetSha256,
      diff_sha256: input.diffSha256,
      ...(input.baseEtag === undefined ? {} : { base_etag: input.baseEtag }),
      ...(input.baseLastChangedAt === undefined
        ? {}
        : { base_last_changed_at: input.baseLastChangedAt }),
      created_at: input.createdAt,
      expires_at: input.expiresAt,
      status: "prepared",
    };

    await mkdir(stagingDirectory, { mode: DIRECTORY_MODE });
    let committed = false;
    try {
      await writeNewPrivateFile(join(stagingDirectory, "base.md"), input.base);
      await writeNewPrivateFile(join(stagingDirectory, "target.md"), input.target);
      await writeNewPrivateFile(join(stagingDirectory, "diff.patch"), input.diff);
      await writeNewPrivateFile(join(stagingDirectory, "plan.json"), serialize(plan));
      await syncDirectory(stagingDirectory);
      await rename(stagingDirectory, finalDirectory);
      committed = true;
      await syncDirectory(this.plansDirectory);
      return plan;
    } finally {
      if (!committed) {
        for (const file of ["base.md", "target.md", "diff.patch", "plan.json"]) {
          await unlink(join(stagingDirectory, file)).catch(() => undefined);
        }
        await rmdir(stagingDirectory).catch(() => undefined);
      }
    }
  }

  async getPlan(planId: string): Promise<StoredPlan> {
    await this.initialize();
    const directory = this.planDirectory(planId);
    await assertPrivateDirectory(directory);
    const [planContent, base, target, diff] = await Promise.all([
      readPrivateFile(join(directory, "plan.json")),
      readPrivateFile(join(directory, "base.md")),
      readPrivateFile(join(directory, "target.md")),
      readPrivateFile(join(directory, "diff.patch")),
    ]);
    const plan = parsePlan(planContent, planId);

    let receipt: UpdateReceipt | undefined;
    const receiptPath = join(directory, "receipt.json");
    try {
      await lstat(receiptPath);
      const receiptContent = await readPrivateFile(receiptPath);
      receipt = parseReceipt(receiptContent, planId);
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) {
        throw error;
      }
    }

    return { plan, base, target, diff, ...(receipt === undefined ? {} : { receipt }) };
  }

  async acquireApplyLock(planId: string): Promise<ApplyLock> {
    await this.getPlan(planId);
    const directory = this.planDirectory(planId);
    const lockPath = join(directory, "apply.lock");
    const attemptId = this.createId();
    assertPlanId(attemptId);

    try {
      await writeNewPrivateFile(
        lockPath,
        serialize({
          schema_version: 1,
          attempt_id: attemptId,
          created_at: this.now().toISOString(),
        }),
      );
      await syncDirectory(directory);
    } catch (error) {
      if (isNodeError(error, "EEXIST")) {
        throw new ScribeSealError(
          "APPLY_STATE_UNCERTAIN",
          "This update plan already has an unresolved local apply guard.",
        );
      }
      throw error;
    }

    return {
      attemptId,
      release: async () => {
        const lockContent = await readPrivateFile(lockPath);
        let value: unknown;
        try {
          value = JSON.parse(lockContent);
        } catch {
          throw new ScribeSealError("PLAN_TAMPERED", "The local apply guard is invalid.");
        }
        if (!isRecord(value) || value.attempt_id !== attemptId) {
          throw new ScribeSealError("PLAN_TAMPERED", "The local apply guard changed unexpectedly.");
        }
        await unlink(lockPath);
        await syncDirectory(directory);
      },
    };
  }

  async updatePlanStatus(planId: string, status: PlanStatus): Promise<void> {
    const stored = await this.getPlan(planId);
    assertTransition(stored.plan.status, status);
    const updated: UpdatePlan = {
      ...stored.plan,
      status,
      ...(TERMINAL_STATUSES.has(status) ? { terminal_at: this.now().toISOString() } : {}),
    };
    await replacePrivateFile(
      join(this.planDirectory(planId), "plan.json"),
      serialize(updated),
      this.createId,
    );
  }

  async saveReceipt(receipt: UpdateReceipt): Promise<void> {
    assertPlanId(receipt.plan_id);
    await this.getPlan(receipt.plan_id);
    const receiptPath = join(this.planDirectory(receipt.plan_id), "receipt.json");
    try {
      await writeNewPrivateFile(receiptPath, serialize(receipt));
      await syncDirectory(this.planDirectory(receipt.plan_id));
    } catch (error) {
      if (isNodeError(error, "EEXIST")) {
        throw new ScribeSealError(
          "PLAN_STATE_INCONSISTENT",
          "The update plan already has a receipt.",
        );
      }
      throw error;
    }
  }

  private async canPurge(directory: string): Promise<boolean> {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries.every((entry) => entry.isFile() && PLAN_FILES.has(entry.name));
  }

  private async purgePlan(planId: string): Promise<void> {
    const directory = this.planDirectory(planId);
    if (!(await this.canPurge(directory))) {
      return;
    }
    const purgeDirectory = join(this.plansDirectory, `.purge-${planId}-${this.createId()}`);
    await rename(directory, purgeDirectory);
    await syncDirectory(this.plansDirectory);
    for (const file of PLAN_FILES) {
      await unlink(join(purgeDirectory, file)).catch((error: unknown) => {
        if (!isNodeError(error, "ENOENT")) {
          throw error;
        }
      });
    }
    await rmdir(purgeDirectory);
    await syncDirectory(this.plansDirectory);
  }

  async pruneExpired(): Promise<void> {
    await this.initialize();
    const now = this.now().getTime();
    const entries = await readdir(this.plansDirectory, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() || !PLAN_ID_PATTERN.test(entry.name)) {
        continue;
      }
      let stored: StoredPlan;
      try {
        stored = await this.getPlan(entry.name);
      } catch {
        continue;
      }

      const expiresAt = Date.parse(stored.plan.expires_at);
      const terminalAt = Date.parse(stored.plan.terminal_at ?? stored.plan.created_at);
      const hardRetentionReached =
        Number.isFinite(terminalAt) && now >= terminalAt + this.retentionHours * 3_600_000;
      const preparedExpired =
        stored.plan.status === "prepared" && Number.isFinite(expiresAt) && now >= expiresAt;
      const terminalExpired = TERMINAL_STATUSES.has(stored.plan.status) && hardRetentionReached;
      const uncertainApplyingExpired = stored.plan.status === "applying" && hardRetentionReached;

      if (!preparedExpired && !terminalExpired && !uncertainApplyingExpired) {
        continue;
      }

      const lockPath = join(this.planDirectory(entry.name), "apply.lock");
      let lockExists = false;
      try {
        const lockInfo = await lstat(lockPath);
        lockExists = lockInfo.isFile() || lockInfo.isSymbolicLink();
      } catch (error) {
        if (!isNodeError(error, "ENOENT")) {
          continue;
        }
      }

      if (lockExists && !hardRetentionReached) {
        continue;
      }
      if (!lockExists) {
        try {
          await writeNewPrivateFile(
            lockPath,
            serialize({
              schema_version: 1,
              attempt_id: this.createId(),
              created_at: this.now().toISOString(),
              purpose: "prune",
            }),
          );
        } catch {
          continue;
        }
      }

      await this.purgePlan(entry.name).catch(() => undefined);
    }
  }
}
