import { createHash } from "node:crypto";
import { createTwoFilesPatch } from "diff";
import { ScribeSealError } from "./errors.js";
import type { DiffAnalysis, NoteReference, RiskFlag, RiskLevel } from "./models.js";

export const NOTE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
export const PLAN_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const DEFAULT_DIFF_PREVIEW_CHARS = 12_000;
export const MAX_DIFF_CHUNK_CHARS = 50_000;

function assertNoteId(value: string): void {
  if (!NOTE_ID_PATTERN.test(value)) {
    throw new ScribeSealError("INVALID_NOTE_REFERENCE", "The HackMD note reference is invalid.");
  }
}

export function parseNoteReference(input: string): NoteReference {
  if (NOTE_ID_PATTERN.test(input)) {
    return {
      noteId: input,
      noteUrl: `https://hackmd.io/${input}`,
    };
  }

  if (/\/(?:\.{1,2})(?:\/|$)/.test(input) || input.includes("\\")) {
    throw new ScribeSealError("INVALID_NOTE_REFERENCE", "The HackMD note reference is invalid.");
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ScribeSealError("INVALID_NOTE_REFERENCE", "The HackMD note reference is invalid.");
  }

  if (
    url.protocol !== "https:" ||
    url.hostname !== "hackmd.io" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.pathname.includes("%") ||
    url.pathname.includes("//")
  ) {
    throw new ScribeSealError("INVALID_NOTE_REFERENCE", "The HackMD note reference is invalid.");
  }

  const segments = url.pathname.split("/").slice(1);
  if (segments.some((segment) => segment.length === 0)) {
    throw new ScribeSealError("INVALID_NOTE_REFERENCE", "The HackMD note reference is invalid.");
  }

  if (segments.length === 2 || segments.length === 3) {
    const [workspaceSegment, noteId, suffix] = segments;
    if (workspaceSegment?.startsWith("@")) {
      if (
        workspaceSegment.length === 1 ||
        noteId === undefined ||
        (suffix !== undefined && suffix !== "edit")
      ) {
        throw new ScribeSealError(
          "INVALID_NOTE_REFERENCE",
          "The HackMD note reference is invalid.",
        );
      }
      const workspace = workspaceSegment.slice(1);
      assertNoteId(workspace);
      assertNoteId(noteId);
      return {
        noteId,
        noteUrl: `https://hackmd.io/@${workspace}/${noteId}`,
        workspace,
      };
    }
  }

  if (segments.length === 1 || segments.length === 2) {
    const [noteId, suffix] = segments;
    if (noteId === undefined || (suffix !== undefined && suffix !== "edit" && suffix !== "view")) {
      throw new ScribeSealError("INVALID_NOTE_REFERENCE", "The HackMD note reference is invalid.");
    }
    assertNoteId(noteId);
    return {
      noteId,
      noteUrl: `https://hackmd.io/${noteId}`,
    };
  }

  throw new ScribeSealError("INVALID_NOTE_REFERENCE", "The HackMD note reference is invalid.");
}

export function assertAllowedNote(noteId: string, allowedNoteIds: ReadonlySet<string>): void {
  if (!allowedNoteIds.has(noteId)) {
    throw new ScribeSealError("NOTE_NOT_ALLOWED", "The HackMD note is not allowlisted.");
  }
}

export function canonicalizeContent(content: string): string {
  const withoutBom = content.startsWith("\uFEFF") ? content.slice(1) : content;
  return withoutBom.replace(/\r\n?/g, "\n");
}

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function countContentLines(content: string): number {
  return content.length === 0 ? 0 : content.split("\n").length;
}

export function createUnifiedDiff(base: string, target: string): string {
  return createTwoFilesPatch("base.md", "target.md", base, target, "base", "target", {
    context: 3,
  });
}

export function analyzeDiff(base: string, target: string): DiffAnalysis {
  const diff = createUnifiedDiff(base, target);
  let addedLines = 0;
  let deletedLines = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      addedLines += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      deletedLines += 1;
    }
  }

  const riskFlags: RiskFlag[] = [];
  const baseLines = countContentLines(base);
  const baseBytes = Buffer.byteLength(base, "utf8");
  const targetBytes = Buffer.byteLength(target, "utf8");

  if (target.length === 0) {
    riskFlags.push("empty_target");
  }
  if (baseLines >= 20 && deletedLines >= Math.ceil(baseLines / 2)) {
    riskFlags.push("deletes_at_least_half_of_base_lines");
  }
  if (baseBytes > 0 && targetBytes <= baseBytes * 0.25) {
    riskFlags.push("target_at_most_quarter_of_base_bytes");
  }

  let riskLevel: RiskLevel = "low";
  if (riskFlags.length > 0) {
    riskLevel = "high";
  } else if (deletedLines > 0 || targetBytes < baseBytes) {
    riskLevel = "medium";
  }

  return {
    diff,
    diffSha256: sha256(diff),
    addedLines,
    deletedLines,
    riskLevel,
    riskFlags,
  };
}

export function assertWorkspaceMatches(
  reference: NoteReference,
  note: { userPath?: string },
): void {
  if (reference.workspace !== undefined && reference.workspace !== note.userPath) {
    throw new ScribeSealError(
      "NOTE_REFERENCE_MISMATCH",
      "The HackMD note metadata does not match the requested workspace.",
    );
  }
}

export function assertPlanId(planId: string): void {
  if (!PLAN_ID_PATTERN.test(planId)) {
    throw new ScribeSealError("INVALID_PLAN_ID", "The update plan ID is invalid.");
  }
}
