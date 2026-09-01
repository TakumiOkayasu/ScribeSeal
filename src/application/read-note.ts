import {
  assertAllowedNote,
  assertWorkspaceMatches,
  canonicalizeContent,
  parseNoteReference,
  sha256,
} from "../core/content.js";
import type { ReadNoteOutput } from "../core/models.js";
import type { HackMdGateway } from "../ports.js";

type ReadNoteDependencies = {
  gateway: HackMdGateway;
  allowedNoteIds: ReadonlySet<string>;
};

export async function readNote(
  dependencies: ReadNoteDependencies,
  noteRef: string,
): Promise<ReadNoteOutput> {
  const reference = parseNoteReference(noteRef);
  assertAllowedNote(reference.noteId, dependencies.allowedNoteIds);
  const note = await dependencies.gateway.getNote(reference.noteId);
  assertWorkspaceMatches(reference, note);
  const content = canonicalizeContent(note.content);

  return {
    note_id: reference.noteId,
    title: note.title,
    content,
    content_sha256: sha256(content),
    etag: note.etag ?? null,
    last_changed_at: note.lastChangedAt ?? null,
    concurrency_capability: "preflight-best-effort",
  };
}
