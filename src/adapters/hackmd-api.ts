import API from "@hackmd/api";
import { ScribeSealError } from "../core/errors.js";
import type { RemoteNote, UpdateCondition, UpdateResponse } from "../core/models.js";
import type { HackMdGateway } from "../ports.js";

interface HackMdApiGatewayOptions {
  timeoutMilliseconds?: number;
  now?: () => Date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractStatus(error: unknown): number | undefined {
  if (!isRecord(error)) {
    return undefined;
  }
  if (typeof error.code === "number") {
    return error.code;
  }
  if (isRecord(error.response) && typeof error.response.status === "number") {
    return error.response.status;
  }
  return undefined;
}

function normalizeHeader(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === "string" && value[0].length > 0) {
    return value[0];
  }
  return undefined;
}

function mapRemoteError(error: unknown): ScribeSealError {
  const status = extractStatus(error);
  if (status === 401 || status === 403) {
    return new ScribeSealError(
      "REMOTE_AUTH_FAILED",
      "HackMD rejected the configured credentials or note permission.",
      { httpStatus: status },
    );
  }
  if (status === 404) {
    return new ScribeSealError("REMOTE_NOT_FOUND", "The HackMD note was not found.", {
      httpStatus: status,
    });
  }
  if (status === 429) {
    return new ScribeSealError("REMOTE_RATE_LIMITED", "HackMD rate-limited the request.", {
      httpStatus: status,
    });
  }
  return new ScribeSealError("REMOTE_REQUEST_FAILED", "The HackMD request failed.", {
    ...(status === undefined ? {} : { httpStatus: status }),
  });
}

export class HackMdApiGateway implements HackMdGateway {
  private readonly client: API;
  private readonly now: () => Date;

  constructor(token: string, options: HackMdApiGatewayOptions = {}) {
    this.client = new API(token, "https://api.hackmd.io/v1", {
      wrapResponseErrors: false,
      timeout: options.timeoutMilliseconds ?? 30_000,
    });
    this.now = options.now ?? (() => new Date());
  }

  async getNote(noteId: string): Promise<RemoteNote> {
    try {
      const response = await this.client.getNote(noteId, { unwrapData: false });
      const note = response.data;
      if (note.teamPath !== null) {
        throw new ScribeSealError(
          "UNSUPPORTED_NOTE_SCOPE",
          "Team notes are not supported by the ScribeSeal MVP.",
        );
      }
      const etag = normalizeHeader(response.headers.etag);
      return {
        noteId,
        title: note.title,
        content: note.content,
        ...(etag === undefined ? {} : { etag }),
        ...(note.lastChangedAt === undefined ? {} : { lastChangedAt: String(note.lastChangedAt) }),
        ...(note.userPath === null ? {} : { userPath: note.userPath }),
      };
    } catch (error) {
      if (error instanceof ScribeSealError) {
        throw error;
      }
      throw mapRemoteError(error);
    }
  }

  async updateNoteContent(
    noteId: string,
    content: string,
    condition: UpdateCondition = { type: "preflight-best-effort" },
  ): Promise<UpdateResponse> {
    if (condition.type !== "preflight-best-effort") {
      throw new ScribeSealError(
        "REMOTE_REQUEST_FAILED",
        "The configured concurrency condition is unsupported.",
      );
    }

    try {
      const response = await this.client.updateNoteContent(noteId, content, {
        unwrapData: false,
      });
      const etag = normalizeHeader(response.headers.etag);
      return {
        statusCode: response.status,
        ...(etag === undefined ? {} : { etag }),
        updatedAt: this.now().toISOString(),
      };
    } catch (error) {
      const status = extractStatus(error);
      if (status === undefined || status >= 500) {
        throw new ScribeSealError(
          "PATCH_OUTCOME_UNKNOWN",
          "The HackMD update outcome could not be determined from the response.",
          { ...(status === undefined ? {} : { httpStatus: status }) },
        );
      }
      throw mapRemoteError(error);
    }
  }
}
