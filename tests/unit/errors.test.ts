import { describe, expect, it } from "vitest";
import { ScribeSealError, toSafeError } from "../../src/core/errors.js";

describe("safe errors", () => {
  it("does not serialize unexpected error messages, tokens, headers, or content", () => {
    const secret = "secret-token Authorization: Bearer private-note-content";
    const output = toSafeError(new Error(secret));
    expect(JSON.stringify(output)).not.toContain(secret);
    expect(output).toEqual({
      code: "INTERNAL_ERROR",
      message: "ScribeSeal encountered an internal error.",
    });
  });

  it("keeps only an intentional typed message", () => {
    expect(
      toSafeError(new ScribeSealError("NOTE_NOT_ALLOWED", "The note is not allowlisted.")),
    ).toEqual({ code: "NOTE_NOT_ALLOWED", message: "The note is not allowlisted." });
  });
});
