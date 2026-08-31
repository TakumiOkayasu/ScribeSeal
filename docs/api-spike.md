# HackMD API behavior spike

## Status

Static official-source review completed on 2026-08-31. Live requests are deferred because `HMD_API_ACCESS_TOKEN` and `SCRIBESEAL_TEST_NOTE_ID` were intentionally not provided during implementation. No existing or interview note was read or written.

## Versions

- Node.js: 24.20.0 (pinned current LTS compatible with both dependencies and Plugin host target)
- `@hackmd/api`: 2.7.0
- `@modelcontextprotocol/sdk`: 1.30.0
- `zod`: 4.5.4
- `diff`: 9.0.0

## Static findings

| Question | Official-source result |
|---|---|
| GET status/body | `GET /notes/{noteId}` documents 200 and a note object. |
| GET ETag | Not declared in the OpenAPI response schema. The official client can return raw response headers. |
| `lastChangedAt` | Present on the note model; live mutation behavior is unverified. |
| PATCH | `PATCH /notes/{noteId}` documents 202 for content updates. |
| PATCH body/ETag | Response and ETag behavior require live verification. |
| `If-Match` | No request parameter or 412 response is declared for PATCH. The typed client update method has no arbitrary-header parameter. |
| Read-after-write | Requires live verification. |
| Line endings/trailing newline | Requires live verification. |
| Rate limit body | Requires live verification; raw errors are converted to safe internal errors regardless of shape. |
| Client retry | ScribeSeal supplies no retry configuration and performs no application-level PATCH retry. |

Primary sources: [HackMD API getting started](https://hackmd.io/@docs/Getting-Started-with-the-HackMD-API), [live API docs](https://api.hackmd.io/v1/docs), [OpenAPI document](https://api.hackmd.io/v1/docs/swagger.json), [official API client](https://github.com/hackmdio/api-client), and [official CLI](https://github.com/hackmdio/hackmd-cli).

## Decision

Until the dedicated live spike proves otherwise, the concurrency guarantee is `preflight-best-effort`. ScribeSeal performs a final GET, compares canonical SHA-256 and any observed ETag/`lastChangedAt`, sends one PATCH through the official client, and performs a verification GET. This cannot close the GET-to-PATCH race window.

## Deferred live matrix

Using only the dedicated test note, record sanitized status/body shape, GET/PATCH ETag, `lastChangedAt`, immediate read-after-write behavior, CRLF/CR/LF and trailing newline preservation, stale and current `If-Match`, whether the server ignores the header, and rate-limit response shape. Never record the token, content, authorization header, or private URL. If stale `If-Match` prevents a write, add an integration test before upgrading the guarantee to `etag-conditional`.
