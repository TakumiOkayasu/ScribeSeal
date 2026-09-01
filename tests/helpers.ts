import type { RemoteNote, UpdateCondition, UpdateResponse } from "../src/core/models.js";
import type { HackMdGateway } from "../src/ports.js";

export const PLAN_ID = "11111111-1111-4111-8111-111111111111";
export const ATTEMPT_ID = "22222222-2222-4222-8222-222222222222";
export const RECEIPT_ID = "33333333-3333-4333-8333-333333333333";

export class FakeGateway implements HackMdGateway {
  note: RemoteNote;
  getCount = 0;
  patchCount = 0;
  patchError: unknown;
  patchErrorAfterWrite: unknown;
  afterPatchContent?: string;

  constructor(content = "# Base\n") {
    this.note = {
      noteId: "note-id",
      title: "Test note",
      content,
      etag: '"v1"',
      lastChangedAt: "2026-08-31T00:00:00.000Z",
    };
  }

  async getNote(noteId: string): Promise<RemoteNote> {
    this.getCount += 1;
    return { ...this.note, noteId };
  }

  async updateNoteContent(
    noteId: string,
    content: string,
    _condition?: UpdateCondition,
  ): Promise<UpdateResponse> {
    this.patchCount += 1;
    if (this.patchError !== undefined) {
      throw this.patchError;
    }
    this.note = {
      ...this.note,
      noteId,
      content: this.afterPatchContent ?? content,
      etag: '"v2"',
      lastChangedAt: "2026-08-31T00:01:00.000Z",
    };
    if (this.patchErrorAfterWrite !== undefined) {
      throw this.patchErrorAfterWrite;
    }
    return { statusCode: 202, updatedAt: "2026-08-31T00:01:00.000Z" };
  }
}
