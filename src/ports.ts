import type {
  ApplyLock,
  CreatePlanInput,
  PlanStatus,
  RemoteNote,
  StoredPlan,
  UpdateCondition,
  UpdatePlan,
  UpdateReceipt,
  UpdateResponse,
} from "./core/models.js";

export interface HackMdGateway {
  getNote(noteId: string): Promise<RemoteNote>;
  updateNoteContent(
    noteId: string,
    content: string,
    condition?: UpdateCondition,
  ): Promise<UpdateResponse>;
}

export interface StateStore {
  createPlan(input: CreatePlanInput): Promise<UpdatePlan>;
  getPlan(planId: string): Promise<StoredPlan>;
  acquireApplyLock(planId: string): Promise<ApplyLock>;
  updatePlanStatus(planId: string, status: PlanStatus): Promise<void>;
  saveReceipt(receipt: UpdateReceipt): Promise<void>;
  pruneExpired(): Promise<void>;
}
