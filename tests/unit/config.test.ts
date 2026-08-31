import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";

describe("configuration", () => {
  const base = {
    HMD_API_ACCESS_TOKEN: "token",
    SCRIBESEAL_ALLOWED_NOTE_IDS: "one,two",
  };

  it("requires the token and allowlist", () => {
    expect(() => loadConfig({ SCRIBESEAL_ALLOWED_NOTE_IDS: "one" })).toThrow(
      "HMD_API_ACCESS_TOKEN",
    );
    expect(() => loadConfig({ HMD_API_ACCESS_TOKEN: "token" })).toThrow(
      "SCRIBESEAL_ALLOWED_NOTE_IDS",
    );
  });

  it("validates retention bounds", () => {
    expect(() => loadConfig({ ...base, SCRIBESEAL_PLAN_TTL_MINUTES: "0" })).toThrow(
      "SCRIBESEAL_PLAN_TTL_MINUTES",
    );
    expect(() =>
      loadConfig({ ...base, SCRIBESEAL_PLAN_TTL_MINUTES: "120", SCRIBESEAL_RETENTION_HOURS: "1" }),
    ).toThrow("RETENTION");
  });

  it("uses only the documented allowlist entries", () => {
    expect(loadConfig(base).allowedNoteIds).toEqual(new Set(["one", "two"]));
  });
});
