import { describe, expect, it } from "vitest";
import {
  analyzeDiff,
  canonicalizeContent,
  parseNoteReference,
  sha256,
} from "../../src/core/content.js";
import { ScribeSealError } from "../../src/core/errors.js";

describe("note references", () => {
  it.each([
    ["note_123", { noteId: "note_123", noteUrl: "https://hackmd.io/note_123" }],
    [
      "https://hackmd.io/note_123/edit",
      { noteId: "note_123", noteUrl: "https://hackmd.io/note_123" },
    ],
    [
      "https://hackmd.io/note_123/view",
      { noteId: "note_123", noteUrl: "https://hackmd.io/note_123" },
    ],
    [
      "https://hackmd.io/@workspace/note_123/edit",
      {
        noteId: "note_123",
        noteUrl: "https://hackmd.io/@workspace/note_123",
        workspace: "workspace",
      },
    ],
  ])("parses %s", (input, expected) => {
    expect(parseNoteReference(input)).toEqual(expected);
  });

  it.each([
    "http://hackmd.io/note",
    "https://evil.example/note",
    "https://hackmd.io/note/../../other",
    "https://hackmd.io/note?x=1",
    "bad id",
  ])("rejects %s", (input) => {
    expect(() => parseNoteReference(input)).toThrow(ScribeSealError);
  });
});

describe("content", () => {
  it("canonicalizes only BOM and line endings", () => {
    expect(canonicalizeContent("\uFEFFa\r\nb\rc\n")).toBe("a\nb\nc\n");
    expect(canonicalizeContent("a")).toBe("a");
  });

  it("uses stable SHA-256", () => {
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("flags empty and destructive targets as high risk", () => {
    const base = Array.from({ length: 20 }, (_, index) => `line ${index}`).join("\n");
    const analysis = analyzeDiff(base, "");
    expect(analysis.riskLevel).toBe("high");
    expect(analysis.riskFlags).toContain("empty_target");
    expect(analysis.riskFlags).toContain("deletes_at_least_half_of_base_lines");
  });
});
