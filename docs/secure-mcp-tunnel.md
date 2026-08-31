# Secure MCP Tunnel

OpenAI's [Secure MCP Tunnels guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) describes private connectivity for eligible environments. ScribeSeal does not create a tunnel, public endpoint, OAuth server, token broker, or remote credential store.

This repository's tunnel connection is **documented but unverified** because the required account capability and private deployment environment were not available during implementation. Before use, deploy the bundled server in an account-owned private environment, expose only the ScribeSeal MCP interface through the official tunnel flow, keep `HMD_API_ACCESS_TOKEN` in that environment's secret store, forward the mandatory allowlist, and verify that `apply_update` remains approval-gated. Do not expose STDIO directly to the public internet.

Public Plugin distribution remains out of scope. It would require a separate OAuth 2.1 service and secure HackMD-token broker rather than asking ChatGPT users to provide personal tokens directly.
