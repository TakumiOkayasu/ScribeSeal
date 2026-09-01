# Security model

## Boundary

ScribeSeal reduces accidental wrong-note writes, stale-base overwrites, unreviewed large deletions, plan artifact changes, duplicate apply attempts, false success reports, and ordinary token/content logging. It does not protect a compromised local account or token, a user who approves a harmful diff, HackMD service defects, or the race between the final GET and PATCH.

The current guarantee is `preflight-best-effort`, not an exclusive remote lock or atomic conditional write. A local exclusive-create apply guard prevents two local attempts for one plan; it does not coordinate other HackMD clients. Unexpected guards are retained for manual investigation rather than automatically cleared.

## Controls

- `HMD_API_ACCESS_TOKEN` is the only token source. It is never accepted as a tool argument or stored in artifacts.
- `SCRIBESEAL_ALLOWED_NOTE_IDS` is mandatory for reads and writes. No unrestricted mode exists.
- Only HTTPS references on `hackmd.io` are accepted. Ports, credentials, queries, fragments, encoded paths, traversal segments, and unknown URL shapes are rejected.
- Workspace URLs are matched against returned metadata. Team-scoped notes fail closed in version 0.1.0 because the official client exposes a different team route.
- Content is canonicalized only by removing a leading BOM and converting CRLF/CR to LF. Trailing newlines and other whitespace remain significant.
- SHA-256 fixes base, target, and diff artifacts. Apply recomputes all hashes and regenerates the diff.
- State writes use create-only or temporary-file, flush, rename, and directory flush operations. Reads reject symlinks, non-regular files, missing files, and unsafe Unix permissions.
- PATCH has no automatic retry. A lost response leads to one verification GET. A target match is verified success; any other result is uncertain.
- No automatic rollback or second PATCH occurs after uncertainty.

## Retention and logs

Prepared plans expire after the configured TTL, 60 minutes by default. Terminal artifacts are pruned after 24 hours by default. Pruning operates only within the fixed plans directory on UUID directories and recognized filenames. Receipts contain hashes and timing metadata, never content or the token.

stdout is reserved for MCP protocol traffic. stderr diagnostics do not include note content, diffs, tokens, authorization headers, process environment, or raw client error objects.

## Incident response

1. Stop the local server without retrying an uncertain plan.
2. Revoke a possibly exposed token in HackMD and issue a replacement.
3. Inspect the remote note, HackMD revision history, plan metadata, receipt hashes, and timestamps.
4. Preserve an unresolved apply guard and hashes for diagnosis, but do not share note content publicly.
5. If remote state differs from base and target, prepare any corrective change as a new reviewed plan. Never reuse the old plan or automatically roll back.
