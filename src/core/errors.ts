export type ErrorCode =
  | "ALREADY_APPLIED"
  | "APPLY_STATE_UNCERTAIN"
  | "BASE_CHANGED"
  | "CONFIG_INVALID"
  | "HIGH_RISK_REWRITE"
  | "INTERNAL_ERROR"
  | "INVALID_NOTE_REFERENCE"
  | "INVALID_PLAN_ID"
  | "INVALID_PLAN_STATUS"
  | "NO_CHANGES"
  | "NOTE_NOT_ALLOWED"
  | "NOTE_REFERENCE_MISMATCH"
  | "PATCH_OUTCOME_UNKNOWN"
  | "PLAN_EXPIRED"
  | "PLAN_NOT_FOUND"
  | "PLAN_STATE_INCONSISTENT"
  | "PLAN_TAMPERED"
  | "REMOTE_AUTH_FAILED"
  | "REMOTE_NOT_FOUND"
  | "REMOTE_RATE_LIMITED"
  | "REMOTE_REQUEST_FAILED"
  | "TARGET_MISMATCH"
  | "UNSUPPORTED_NOTE_SCOPE";

export class ScribeSealError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus?: number;

  constructor(code: ErrorCode, message: string, options?: { httpStatus?: number }) {
    super(message);
    this.name = "ScribeSealError";
    this.code = code;
    if (options?.httpStatus !== undefined) {
      this.httpStatus = options.httpStatus;
    }
  }
}

export interface SafeError {
  code: ErrorCode;
  message: string;
}

export function toSafeError(error: unknown): SafeError {
  if (error instanceof ScribeSealError) {
    return { code: error.code, message: error.message };
  }

  return {
    code: "INTERNAL_ERROR",
    message: "ScribeSeal encountered an internal error.",
  };
}
