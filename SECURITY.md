# Security Policy

The Tether maintainers take the security of our real-time collaboration engine, WebSocket protocols, and data persistence very seriously.

## Supported Versions

We provide security updates for the latest release on the `main` branch.

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1.0 | :x:                |

---

## Reporting a Vulnerability

If you discover a security vulnerability or potential exploit in Tether (such as session token forgery, cross-client memory leakage, CRDT desynchronization attacks, or remote code execution risks), **please do not create a public GitHub issue**.

Instead, report it responsibly via email:

- **Contact:** Hriday Singh
- **Email:** [hridaysingh2207@gmail.com](mailto:hridaysingh2207@gmail.com)
- **Subject Line:** `[SECURITY] Tether Vulnerability Report - <Brief Description>`

### Information to Include in Your Report
Please include as much detail as possible to help us reproduce and resolve the issue quickly:
- Type of vulnerability (e.g. CSRF, WebSocket spoofing, injection, auth bypass)
- Step-by-step instructions to reproduce the issue
- Affected components (`@tether/server`, `@tether/web`, `@tether/shared`, `@tether/sync-client`)
- Proof-of-concept (PoC) scripts or curl commands if available
- Impact analysis and potential mitigations

### Response Timeline
- **Initial Acknowledgement:** Within 48 hours.
- **Triage & Status Update:** Within 5 business days with an assessment of severity.
- **Patch & Advisory:** Fix released and coordinated disclosure once patched.

Thank you for helping keep Tether and its users safe.
