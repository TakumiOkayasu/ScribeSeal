# ScribeSeal

ScribeSeal is a local MCP server and Plugin for reviewable updates to existing HackMD notes. It fixes the proposed replacement content and unified diff in a local plan, checks that the remote base is still current immediately before writing, requires the client workflow to obtain explicit approval, and verifies the content hash after writing.

It is not a HackMD editor, a general API client, or a remote locking service. In version 0.1.0 the concurrency guarantee is `preflight-best-effort`: another client can still write between ScribeSeal's final GET and PATCH because HackMD's published API contract does not document a conditional PATCH. ScribeSeal does not claim atomicity, tamper-proof storage, or automatic rollback.

## Requirements

- Node.js 24.20.0
- pnpm 11.19.0
- A HackMD API token
- An explicit allowlist of note IDs

The Node version is pinned consistently in `.nvmrc`, `package.json`, and CI. Dependency versions and the reasons for the concurrency choice are recorded in [docs/api-spike.md](docs/api-spike.md).

## Configure

Create a token using HackMD's [official token instructions](https://hackmd.io/@docs/how-to-issue-an-api-token). Export it only through the documented environment variable:

```sh
export HMD_API_ACCESS_TOKEN='your-token'
export SCRIBESEAL_ALLOWED_NOTE_IDS='note-id,another-note-id'
```

Do not put the token in tool arguments, Plugin files, source control, or logs. `.env*` is ignored, but an environment variable or external secret manager is preferred. ScribeSeal refuses all reads and writes when the allowlist is missing, and rejects team-scoped notes in this MVP.

Optional settings:

```sh
export SCRIBESEAL_STATE_DIR='/absolute/private/path'
export SCRIBESEAL_PLAN_TTL_MINUTES='60'
export SCRIBESEAL_RETENTION_HOURS='24'
```

State directory priority is `SCRIBESEAL_STATE_DIR`, then `$PLUGIN_DATA/scribeseal`, then `~/.local/state/scribeseal`. Unix directories use mode `0700` and files use `0600`. Prepared plans expire after 60 minutes by default; terminal artifacts are pruned after 24 hours. Receipts contain hashes and metadata, not note content.

## Build and test

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The live test is opt-in and must use a dedicated disposable test note. It never uses the interview note:

```sh
export SCRIBESEAL_TEST_NOTE_ID='dedicated-test-note-id'
export SCRIBESEAL_ALLOWED_NOTE_IDS="$SCRIBESEAL_TEST_NOTE_ID"
export SCRIBESEAL_RUN_LIVE_TESTS='1'
pnpm test:live
```

If restoration fails, the test stops and reports failure; it does not repeatedly overwrite the note.

## Install as a local Plugin

Build first, then install this repository as a local marketplace source using the current Codex Plugin workflow. The package contains `.codex-plugin/plugin.json`, `.mcp.json`, the bundled `dist/scribeseal.mjs`, and `skills/hackmd-safe-edit/SKILL.md`; installation does not run `pnpm install` in the Plugin cache.

The MCP server starts with `node ./dist/scribeseal.mjs`, forwards only the documented environment variables, and does not depend on the user's project working directory. [examples/marketplace.json](examples/marketplace.json) is a catalog example for a marketplace root where this repository has been copied to `plugins/scribeseal`.

For Codex tool approvals, use the verified Plugin-scoped example in [examples/codex-config.toml](examples/codex-config.toml). Its selector matches the example marketplace; replace only the marketplace suffix when installing from a differently named catalog. ScribeSeal never modifies global Codex, ChatGPT, marketplace, or dotfile configuration.

## Tool workflow

1. `read_note` reads one allowlisted note and returns canonical content plus its SHA-256.
2. Edit the Markdown locally.
3. `prepare_update` re-reads the note, rejects a stale base or unacknowledged high-risk rewrite, and saves a fixed plan without writing to HackMD.
4. Read the entire diff with `read_plan_diff` when preview truncation occurs.
5. Present the complete diff and risk to the user and obtain explicit approval.
6. `apply_update` rechecks plan artifacts and the remote base, performs one PATCH, and verifies with a GET.
7. Report success only when the post-write hash matches the approved target hash.

Example conversation:

> User: Update this allowlisted note and show me the diff first.
>
> Agent: I read the note, prepared plan `…`, and reviewed all diff chunks. Risk is low. Here is the exact diff. Apply this plan?
>
> User: Approve that exact diff.
>
> Agent: ScribeSeal applied the plan once. Receipt `…` verifies target hash `…` with `preflight-best-effort` concurrency.

High-risk means an empty target, deletion of at least half the lines from a base of 20 or more lines, or a target no larger than one quarter of the base bytes. This is a safety heuristic, not a correctness judgment.

## Failure behavior

- A changed base returns a conflict and does not PATCH.
- An expired, malformed, tampered, or unexpectedly guarded plan is rejected.
- An applied plan returns its existing receipt and is never PATCHed again.
- PATCH is never automatically retried.
- If a PATCH response is lost, one GET determines whether the target is present. Any other observation is `verification_uncertain`.
- A post-write mismatch is uncertain; ScribeSeal does not roll back or PATCH again.
- Diagnostics go to stderr and contain only safe identifiers, hashes, and status. MCP protocol data alone uses stdout.

See [docs/security.md](docs/security.md) for the threat boundary and incident response, and [docs/architecture.md](docs/architecture.md) for state transitions and design decisions.

## ChatGPT and remote access

The MVP is a bundled local STDIO Plugin for Codex CLI, Codex IDE, and compatible local ChatGPT Desktop Plugin support. A public Remote Plugin is deliberately excluded: ChatGPT cannot safely accept a user's HackMD personal token as a public custom API key, so a public service would need OAuth 2.1 plus a secure token broker. Secure MCP Tunnel guidance is documented separately in [docs/secure-mcp-tunnel.md](docs/secure-mcp-tunnel.md) and remains unverified without account access.

## Troubleshooting

- `CONFIG_INVALID`: set the token and a comma-separated allowlist; verify numeric bounds and absolute state paths.
- `NOTE_NOT_ALLOWED`: add the exact note ID to the allowlist before restarting.
- `BASE_CHANGED`: call `read_note` again and create a new plan.
- `HIGH_RISK_REWRITE`: inspect the complete deletion and explicitly choose whether to prepare with acknowledgement.
- `APPLY_STATE_UNCERTAIN`: inspect the local plan and remote note manually. Do not delete the apply guard merely to retry.
- `VERIFICATION_UNCERTAIN`: compare the receipt hashes with a fresh read and decide manually; do not assume success.

## License

MIT
