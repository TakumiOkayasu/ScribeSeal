---
name: hackmd-safe-edit
description: Safely update an allowlisted HackMD note through ScribeSeal's read, fixed-plan diff review, explicit approval, apply, and post-write verification workflow. Use when a user asks to change an existing HackMD note with ScribeSeal.
---

# HackMD safe edit

Use only the `scribeseal` MCP server for HackMD reads and writes in this workflow.

1. Call `read_note` with the requested note reference.
2. Edit the returned Markdown without automatic reformatting.
3. Call `prepare_update` with the returned `content_sha256`, the complete replacement content, a concise reason, and `allow_large_rewrite=false` unless the user explicitly accepts a high-risk rewrite.
4. Review `diff_preview`. If `diff_truncated` is true, call `read_plan_diff` repeatedly from `offset=0`, following `next_offset`, until `complete=true`. Review every chunk and confirm the assembled `diff_sha256` matches the plan.
5. Show the exact complete diff, hashes, expiry, risk level, and risk flags to the user. Ask for explicit approval of that exact plan.
6. Call `apply_update` only after the user explicitly approves, passing the exact `plan_id`, `target_sha256`, and `diff_sha256`.
7. Report the receipt, concurrency guarantee, and verification result. Claim success only for `status=applied` with a matching `verified_sha256`.

Never apply before approval, apply an unreviewed or stale plan, use another HackMD write tool to bypass ScribeSeal, retry or roll back automatically, create notes, or delete notes. Never describe the local apply guard as a remote exclusive lock. If the base changed, prepare a new plan from a fresh read.
