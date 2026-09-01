export type ConcurrencyCapability = "preflight-best-effort";
export type ConcurrencyGuarantee = "preflight-best-effort";

export interface NoteReference {
  noteId: string;
  noteUrl: string;
  workspace?: string;
}

export interface RemoteNote {
  noteId: string;
  title: string;
  content: string;
  etag?: string;
  lastChangedAt?: string;
  userPath?: string;
  teamPath?: string;
}

export interface UpdateCondition {
  type: "preflight-best-effort";
}

export interface UpdateResponse {
  statusCode: number;
  etag?: string;
  updatedAt: string;
}

export type RiskLevel = "low" | "medium" | "high";
export type RiskFlag =
  | "empty_target"
  | "deletes_at_least_half_of_base_lines"
  | "target_at_most_quarter_of_base_bytes";

export interface DiffAnalysis {
  diff: string;
  diffSha256: string;
  addedLines: number;
  deletedLines: number;
  riskLevel: RiskLevel;
  riskFlags: RiskFlag[];
}

export type PlanStatus =
  | "prepared"
  | "applying"
  | "applied"
  | "conflict"
  | "failed"
  | "verification_uncertain";

export interface UpdatePlan {
  schema_version: 1;
  plan_id: string;
  note_id: string;
  note_url: string;
  reason: string;
  base_sha256: string;
  target_sha256: string;
  diff_sha256: string;
  base_etag?: string;
  base_last_changed_at?: string;
  created_at: string;
  expires_at: string;
  status: PlanStatus;
  terminal_at?: string;
}

export interface CreatePlanInput {
  noteId: string;
  noteUrl: string;
  reason: string;
  base: string;
  target: string;
  diff: string;
  baseSha256: string;
  targetSha256: string;
  diffSha256: string;
  baseEtag?: string;
  baseLastChangedAt?: string;
  createdAt: string;
  expiresAt: string;
}

export type ReceiptStatus = "applied" | "conflict" | "failed" | "verification_uncertain";

export interface UpdateReceipt {
  schema_version: 1;
  receipt_id: string;
  plan_id: string;
  status: ReceiptStatus;
  note_id: string;
  base_sha256: string;
  target_sha256: string;
  verified_sha256?: string;
  observed_sha256?: string;
  concurrency_guarantee: ConcurrencyGuarantee;
  updated_at?: string;
  verified_at: string;
}

export interface StoredPlan {
  plan: UpdatePlan;
  base: string;
  target: string;
  diff: string;
  receipt?: UpdateReceipt;
}

export interface ApplyLock {
  attemptId: string;
  release(): Promise<void>;
}

export interface ReadNoteOutput {
  note_id: string;
  title: string;
  content: string;
  content_sha256: string;
  etag: string | null;
  last_changed_at: string | null;
  concurrency_capability: ConcurrencyCapability;
}

export interface PrepareUpdateOutput {
  plan_id: string;
  note_id: string;
  base_sha256: string;
  target_sha256: string;
  diff_sha256: string;
  added_lines: number;
  deleted_lines: number;
  risk_level: RiskLevel;
  risk_flags: RiskFlag[];
  diff_preview: string;
  diff_truncated: boolean;
  expires_at: string;
}

export interface ReadPlanDiffOutput {
  plan_id: string;
  diff_sha256: string;
  offset: number;
  next_offset: number;
  complete: boolean;
  content: string;
}

export interface ApplyUpdateOutput {
  status: "applied" | "conflict" | "verification_uncertain";
  receipt_id: string;
  note_id: string;
  base_sha256: string;
  target_sha256: string;
  verified_sha256: string | null;
  concurrency_guarantee: ConcurrencyGuarantee;
  updated_at: string | null;
  verified_at: string;
}
