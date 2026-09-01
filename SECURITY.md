# Security policy

Do not open a public issue containing a HackMD token, note content, private note URL, state artifact, or raw HTTP response. Revoke an exposed HackMD token immediately, remove it from local environments and CI, issue a replacement, and inspect HackMD note history and ScribeSeal receipts.

Report suspected vulnerabilities privately through GitHub's private vulnerability reporting for this repository when available. Include the affected version, a minimal reproduction without secrets, expected behavior, and observed safe error code.

Version 0.1.0 receives security fixes on the latest release only. The complete operational threat model is in [docs/security.md](docs/security.md).
