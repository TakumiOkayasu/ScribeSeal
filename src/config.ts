import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { NOTE_ID_PATTERN } from "./core/content.js";
import { ScribeSealError } from "./core/errors.js";

export interface ScribeSealConfig {
  token: string;
  allowedNoteIds: ReadonlySet<string>;
  stateDirectory: string;
  planTtlMinutes: number;
  retentionHours: number;
}

function requireSecret(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.length === 0) {
    throw new ScribeSealError("CONFIG_INVALID", `${name} is required.`);
  }
  return value;
}

function parseInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value.length === 0) {
    return fallback;
  }
  if (!/^\d+$/.test(value)) {
    throw new ScribeSealError("CONFIG_INVALID", `${name} must be an integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ScribeSealError(
      "CONFIG_INVALID",
      `${name} must be between ${minimum} and ${maximum}.`,
    );
  }
  return parsed;
}

function resolveStateDirectory(env: NodeJS.ProcessEnv): string {
  const configured = env.SCRIBESEAL_STATE_DIR;
  if (configured !== undefined && configured.length > 0) {
    if (!isAbsolute(configured)) {
      throw new ScribeSealError("CONFIG_INVALID", "SCRIBESEAL_STATE_DIR must be absolute.");
    }
    return resolve(configured);
  }

  const pluginData = env.PLUGIN_DATA;
  if (pluginData !== undefined && pluginData.length > 0) {
    if (!isAbsolute(pluginData)) {
      throw new ScribeSealError("CONFIG_INVALID", "PLUGIN_DATA must be absolute.");
    }
    return join(resolve(pluginData), "scribeseal");
  }

  return join(homedir(), ".local", "state", "scribeseal");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ScribeSealConfig {
  const token = requireSecret(env, "HMD_API_ACCESS_TOKEN");
  const allowlist = requireSecret(env, "SCRIBESEAL_ALLOWED_NOTE_IDS")
    .split(",")
    .map((value) => value.trim());

  if (allowlist.some((value) => !NOTE_ID_PATTERN.test(value))) {
    throw new ScribeSealError(
      "CONFIG_INVALID",
      "SCRIBESEAL_ALLOWED_NOTE_IDS contains an invalid note ID.",
    );
  }

  const allowedNoteIds = new Set(allowlist);
  if (allowedNoteIds.size === 0) {
    throw new ScribeSealError("CONFIG_INVALID", "SCRIBESEAL_ALLOWED_NOTE_IDS is required.");
  }

  const planTtlMinutes = parseInteger(
    env.SCRIBESEAL_PLAN_TTL_MINUTES,
    60,
    "SCRIBESEAL_PLAN_TTL_MINUTES",
    1,
    1_440,
  );
  const retentionHours = parseInteger(
    env.SCRIBESEAL_RETENTION_HOURS,
    24,
    "SCRIBESEAL_RETENTION_HOURS",
    1,
    720,
  );
  if (retentionHours * 60 < planTtlMinutes) {
    throw new ScribeSealError(
      "CONFIG_INVALID",
      "SCRIBESEAL_RETENTION_HOURS must not be shorter than the plan TTL.",
    );
  }

  return {
    token,
    allowedNoteIds,
    stateDirectory: resolveStateDirectory(env),
    planTtlMinutes,
    retentionHours,
  };
}
